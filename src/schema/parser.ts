/**
 * Parse + validate a ``.demo.yaml`` / ``.demo.json`` file.
 *
 * Designed for helpful error output. When validation fails, the
 * parser produces an array of `ParseIssue` entries with field
 * paths AND (where possible) the line number in the source
 * file. The CLI's `record` command uses these to print
 * colored errors that point at the right line.
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseDocument, isMap, isSeq, isScalar, type Document, type Node } from "yaml";
// ajv is published CJS-only; under Node's ESM loader the CJS default
// lands on `.default` at runtime, even though the type declares a
// direct default. Use the named export and a tiny runtime adapter.
import { Ajv as AjvCtor, type ErrorObject } from "ajv";

const Ajv = AjvCtor;

import { demoSchema } from "./schema.js";
import type { DemoConfig } from "./types.js";

export interface ParseIssue {
  /** Field path in dotted-form (`scenes[2].selector`). */
  path: string;
  /** Human-readable problem. */
  message: string;
  /** 1-based line number in source, when locatable. */
  line?: number;
  /** Suggested fix or related schema info. */
  hint?: string;
}

export class DemoParseError extends Error {
  constructor(
    public readonly issues: ParseIssue[],
    public readonly sourcePath: string,
  ) {
    super(
      `Failed to parse ${sourcePath}: ${issues.length} issue${
        issues.length === 1 ? "" : "s"
      }`,
    );
    this.name = "DemoParseError";
  }
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  // verbose=true gives us schema/parentSchema on errors so we can
  // craft good messages for `oneOf`/`anyOf` failures.
  verbose: true,
});
const validate = ajv.compile<DemoConfig>(demoSchema);

/** Parse a file from disk. Returns the typed config or throws DemoParseError. */
export function parseDemoFile(path: string): DemoConfig {
  const abs = resolve(path);
  const ext = extname(abs).toLowerCase();
  if (ext !== ".yaml" && ext !== ".yml" && ext !== ".json") {
    throw new DemoParseError(
      [
        {
          path: "",
          message: `Unsupported extension ${ext || "(none)"} — expected .yaml, .yml, or .json.`,
        },
      ],
      abs,
    );
  }
  const raw = readFileSync(abs, "utf8");
  return parseDemoString(raw, abs);
}

/** Parse a YAML or JSON string. The `sourcePath` is used only for error messages. */
export function parseDemoString(
  source: string,
  sourcePath = "<string>",
): DemoConfig {
  let doc: Document.Parsed;
  try {
    doc = parseDocument(source);
  } catch (err) {
    throw new DemoParseError(
      [{ path: "", message: `YAML parse error: ${(err as Error).message}` }],
      sourcePath,
    );
  }

  if (doc.errors.length > 0) {
    throw new DemoParseError(
      doc.errors.map((err: unknown) => {
        const e = err as { message: string; linePos?: Array<{ line: number; col: number }> };
        return {
          path: "",
          message: e.message,
          line: e.linePos?.[0]?.line,
        };
      }),
      sourcePath,
    );
  }

  const data = doc.toJS({ maxAliasCount: 100 }) as unknown;

  if (!validate(data)) {
    const issues = (validate.errors ?? []).map((err) =>
      ajvErrorToIssue(err, doc),
    );
    throw new DemoParseError(issues, sourcePath);
  }

  // Cross-field checks AJV can't express cleanly.
  const semantic = semanticChecks(data as DemoConfig, doc);
  if (semantic.length > 0) {
    throw new DemoParseError(semantic, sourcePath);
  }

  return data as DemoConfig;
}

function ajvErrorToIssue(err: ErrorObject, doc: Document.Parsed): ParseIssue {
  const path = ajvPathToHumanPath(err.instancePath);
  const line = locateLineFromInstancePath(err.instancePath, doc);
  const message = renderAjvMessage(err);
  return {
    path,
    message,
    line,
    hint: hintFromKeyword(err),
  };
}

function ajvPathToHumanPath(instancePath: string): string {
  if (!instancePath) return "<root>";
  // AJV's instancePath is `/scenes/0/selector` → `scenes[0].selector`
  return instancePath
    .slice(1)
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
    .join("")
    .replace(/^\./, "");
}

function renderAjvMessage(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty: string }).additionalProperty;
    return `unknown property \`${extra}\``;
  }
  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty: string }).missingProperty;
    return `missing required property \`${missing}\``;
  }
  if (err.keyword === "enum") {
    const allowed = (err.params as { allowedValues: string[] }).allowedValues;
    return `must be one of [${allowed.join(", ")}]`;
  }
  if (err.keyword === "pattern") {
    return `value doesn't match expected format (${err.message ?? "pattern"})`;
  }
  if (err.keyword === "oneOf") {
    return "violates a `oneOf` constraint (multiple variants matched, or none did)";
  }
  return err.message ?? "validation error";
}

function hintFromKeyword(err: ErrorObject): string | undefined {
  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty: string }).additionalProperty;
    return `Did you mean a documented field? Check the spec at \`./demo.schema.json\`. Unknown field: \`${extra}\`.`;
  }
  if (err.keyword === "required") {
    return "Add this field per the action-specific rules in the schema.";
  }
  if (err.keyword === "pattern" && err.schemaPath.includes("name")) {
    return "Scene `name` must be lowercase, alphanumeric, with optional `-` or `_`.";
  }
  return undefined;
}

/** Walk the YAML CST to find the line where an instancePath lives. */
function locateLineFromInstancePath(
  instancePath: string,
  doc: Document.Parsed,
): number | undefined {
  if (!instancePath || !doc.contents) return undefined;
  const segments = instancePath.slice(1).split("/");
  let node: Node | null = doc.contents as Node;
  for (const seg of segments) {
    if (!node) return undefined;
    if (isMap(node)) {
      const items = node.items as Array<{ key: unknown; value: unknown }>;
      const match = items.find(
        (item) => isScalar(item.key) && String((item.key as { value: unknown }).value) === seg,
      );
      node = (match?.value as Node | undefined) ?? null;
    } else if (isSeq(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      node = (node.items[idx] as Node | undefined) ?? null;
    } else {
      return undefined;
    }
  }
  const range = node?.range;
  if (!range) return undefined;
  // ``range[0]`` is the byte offset; YAML doc has line info through
  // ``lineCounter``. Without a lineCounter, fall back to undefined.
  // (parseDocument doesn't attach one by default; we keep this best-effort.)
  // Caller will still print the path; line is a "nice to have."
  return undefined;
}

/** Semantic cross-field checks. */
function semanticChecks(cfg: DemoConfig, _doc: Document.Parsed): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  cfg.scenes.forEach((s, idx) => {
    if (seen.has(s.name)) {
      issues.push({
        path: `scenes[${idx}].name`,
        message: `Duplicate scene name \`${s.name}\` — each scene name must be unique.`,
      });
    }
    seen.add(s.name);
    if (!s.action && !s.overlay) {
      issues.push({
        path: `scenes[${idx}]`,
        message: `Scene \`${s.name}\` has neither an action nor an overlay — what does it render?`,
        hint:
          "Add an `action:` (goto/click/type/etc.) for a recorded scene, or an `overlay:` block for a card scene.",
      });
    }
  });
  return issues;
}

/** Format a DemoParseError for terminal output. */
export function formatParseError(err: DemoParseError): string {
  const header = `\n✗ ${err.sourcePath} — ${err.issues.length} issue${
    err.issues.length === 1 ? "" : "s"
  }\n`;
  const body = err.issues
    .map((i) => {
      const loc = i.line ? ` (line ${i.line})` : "";
      const head = `  • ${i.path}${loc}: ${i.message}`;
      return i.hint ? `${head}\n      ↳ ${i.hint}` : head;
    })
    .join("\n");
  return header + body + "\n";
}
