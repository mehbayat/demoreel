/**
 * JSON Schema for ``.demo.yaml`` (and ``.demo.json``) files.
 *
 * Single source of truth at runtime: ``parser.ts`` compiles this
 * via ajv and reports the actual error path + message back to
 * the user. Keep the field set in lockstep with
 * ``./types.ts`` — TypeScript types are NOT auto-derived from
 * the schema; both are hand-maintained so they can express
 * things the other can't (e.g. type-level template literals).
 */

const durationPattern = "^[0-9]+(\\.[0-9]+)?(s|ms)$";
const resolutionPattern = "^[0-9]+x[0-9]+$";

/** Reusable: a duration literal like `"2s"` or `"500ms"`. */
const duration = {
  type: "string",
  pattern: durationPattern,
  description: "Duration literal — e.g. `2s`, `500ms`, `1.5s`.",
};

/** Reusable: typing speed accepts a duration literal OR integer 0. */
const typingSpeed = {
  anyOf: [
    duration,
    { type: "integer", const: 0, description: "0 = instant typing (no delay)." },
  ],
};

const overlay = {
  type: "object",
  additionalProperties: false,
  properties: {
    logo: { type: "string", description: "Path to a PNG/SVG logo asset." },
    dialogue: { type: "string", description: "One-line dialogue text." },
    animation: {
      type: "string",
      enum: ["fade-in", "fade-out", "slide-up", "typewriter"],
    },
    cta: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string" },
        // Note: `format: "uri"` would need ajv-formats. Keep validation
        // light here — it's a CTA URL, not a security-load-bearing field.
        url: { type: "string", minLength: 1 },
      },
      required: ["text"],
    },
  },
} as const;

const zoom = {
  type: "object",
  additionalProperties: false,
  properties: {
    selector: { type: "string", description: "CSS selector to focus the zoom on." },
    region: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["x", "y", "width", "height"],
    },
    level: {
      anyOf: [
        { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?x$" },
        { type: "number", exclusiveMinimum: 0 },
      ],
    },
    transition: {
      type: "string",
      description: "CSS-easing-style transition spec, e.g. `ease-in-out 0.5s`.",
    },
  },
  required: ["level"],
  oneOf: [{ required: ["selector"] }, { required: ["region"] }],
  errorMessage: {
    oneOf:
      "zoom requires exactly one of `selector` or `region` (got both or neither).",
  },
} as const;

const scene = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      pattern: "^[a-z0-9][a-z0-9-_]*$",
      description:
        "Short identifier — lowercase, alphanumerics + dash/underscore. Surfaces in logs and trace.json.",
    },
    action: {
      type: "string",
      enum: ["goto", "click", "type", "scroll", "wait_for", "pause", "screenshot"],
    },
    url: { type: "string", description: "Used by `goto` and as a `wait_for` URL pattern." },
    selector: { type: "string", description: "CSS selector for click/type/scroll/wait_for." },
    text: { type: "string", description: "Text typed by the `type` action." },
    speed: typingSpeed,
    to: {
      type: "object",
      additionalProperties: false,
      properties: { x: { type: "number" }, y: { type: "number" } },
    },
    wait_for: {
      type: "string",
      description: "CSS selector to wait for after the action. Applies to goto/click.",
    },
    timeout: duration,
    duration: duration,
    pause_after: duration,
    highlight_cursor: { type: "boolean" },
    path: { type: "string", description: "Output path for the `screenshot` action." },
    overlay: overlay,
    zoom: zoom,
  },
  required: ["name"],
  // Per-action field requirements enforced via oneOf below.
  // Scenes WITHOUT ``action`` are overlay-only (no enforcement).
  allOf: [
    {
      if: { properties: { action: { const: "goto" } }, required: ["action"] },
      then: { required: ["url"] },
    },
    {
      if: { properties: { action: { const: "click" } }, required: ["action"] },
      then: { required: ["selector"] },
    },
    {
      if: { properties: { action: { const: "type" } }, required: ["action"] },
      then: { required: ["selector", "text"] },
    },
    {
      if: { properties: { action: { const: "wait_for" } }, required: ["action"] },
      then: { anyOf: [{ required: ["selector"] }, { required: ["url"] }] },
    },
    {
      if: { properties: { action: { const: "pause" } }, required: ["action"] },
      then: { required: ["duration"] },
    },
    {
      if: { properties: { action: { const: "screenshot" } }, required: ["action"] },
      then: { required: ["path"] },
    },
  ],
} as const;

const introOutroCard = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1 },
    subtitle: { type: "string" },
    logo: { type: "string", description: "PNG/SVG path, relative to the demo file." },
    background: { type: "string", pattern: "^#[0-9a-fA-F]{3,8}$" },
    text_color: { type: "string", pattern: "^#[0-9a-fA-F]{3,8}$" },
    accent_color: { type: "string", pattern: "^#[0-9a-fA-F]{3,8}$" },
    cta: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1 },
        url: { type: "string", minLength: 1 },
      },
      required: ["text"],
    },
    duration_sec: { type: "number", exclusiveMinimum: 0, maximum: 30 },
  },
  required: ["title"],
} as const;

export const demoSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/mehbayat/demoreel/schema/demo.json",
  title: "DemoReel script",
  type: "object",
  additionalProperties: false,
  properties: {
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1 },
        resolution: { type: "string", pattern: resolutionPattern, default: "1920x1080" },
        fps: { type: "integer", minimum: 1, maximum: 120, default: 30 },
        output: { type: "string", description: "Output MP4 path, relative to the demo file." },
        brand_color: {
          type: "string",
          pattern: "^#[0-9a-fA-F]{3,8}$",
          description: "Brand color in CSS hex format.",
        },
        intro: introOutroCard,
        outro: introOutroCard,
      },
      required: ["title"],
    },
    scenes: {
      type: "array",
      minItems: 1,
      items: scene,
    },
    auth: {
      type: "object",
      additionalProperties: false,
      properties: {
        cookies: {
          type: "array",
          items: {
            anyOf: [
              { type: "string", description: "`name=value` cookie pair." },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  value: { type: "string" },
                  domain: { type: "string" },
                  path: { type: "string" },
                },
                required: ["name", "value"],
              },
            ],
          },
        },
        login: {
          type: "array",
          items: scene,
          description: "Pre-recording login sequence. Runs before recording starts.",
        },
      },
    },
  },
  required: ["meta", "scenes"],
} as const;
