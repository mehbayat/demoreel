#!/usr/bin/env node
/**
 * DemoReel CLI entrypoint.
 *
 * Subcommands:
 *   - init     scaffold a starter demo.yaml + assets/
 *   - record   parse → record → post-process → write MP4
 *   - preview  dry-run; print the action plan without recording
 *   - actions  list available action types
 *   - --mcp    boots the MCP stdio server (separate flag, not a subcommand)
 */

import { Command } from "commander";

import { runInit } from "./commands/init.js";
import { runPreview } from "./commands/preview.js";
import { runRecord } from "./commands/record.js";
import { DemoParseError, formatParseError } from "./schema/parser.js";
import { log, setLogLevel } from "./util/log.js";

const ACTION_DOCS: Record<string, string> = {
  goto: "Navigate to a URL. Required: `url`. Optional: `wait_for`.",
  click: "Click a CSS selector. Required: `selector`. Optional: `wait_for`.",
  type: "Type text into a selector. Required: `selector` + `text`. Optional: `speed` (ms/keystroke, default 80ms).",
  scroll: "Scroll. Required: either `selector` OR `to: {x, y}`.",
  wait_for: "Wait for a selector or URL pattern. Required: `selector` OR `url`. Optional: `timeout`.",
  pause: "Hold the camera for a duration. Required: `duration`.",
  screenshot: "Save a screenshot to disk. Required: `path`. Optional: `selector`.",
};

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("demoreel")
    .description(
      "Scriptable browser demo recorder. Compose .demo.yaml → record real browser → MP4.",
    )
    .version("0.1.0")
    .option("--mcp", "Run as MCP stdio server instead of CLI")
    .option("--verbose", "Verbose logging")
    .hook("preAction", (cmd) => {
      if (cmd.opts().verbose) setLogLevel("debug");
    });

  program
    .command("init")
    .description("Create a starter demo.yaml + assets/ in the current directory")
    .option("--force", "Overwrite existing demo.yaml")
    .action((opts: { force?: boolean }) => {
      try {
        runInit({ force: opts.force });
      } catch (err) {
        process.stderr.write(`\n✗ ${(err as Error).message}\n\n`);
        process.exit(1);
      }
    });

  program
    .command("record <demo-file>")
    .description("Record + post-process a .demo.yaml end-to-end to MP4")
    .option("--headed", "Run with browser visible")
    .option("--work-dir <path>", "Intermediate artefact directory")
    .option("-o, --output <path>", "Override the MP4 output path")
    .action(async (demoFile: string, opts: { headed?: boolean; workDir?: string; output?: string }) => {
      try {
        const result = await runRecord({
          demoPath: demoFile,
          headed: opts.headed,
          workDir: opts.workDir,
          output: opts.output,
        });
        process.stdout.write(`\n✓ ${result.outputPath}\n\n`);
      } catch (err) {
        if (!(err instanceof DemoParseError)) {
          process.stderr.write(`\n✗ ${(err as Error).message}\n\n`);
        }
        process.exit(1);
      }
    });

  program
    .command("preview <demo-file>")
    .description("Dry-run. Validate the script + print the action plan.")
    .action((demoFile: string) => {
      try {
        const result = runPreview(demoFile);
        process.stdout.write(`${result.plan}\n`);
      } catch (err) {
        if (err instanceof DemoParseError) {
          process.stderr.write(formatParseError(err));
        } else {
          process.stderr.write(`\n✗ ${(err as Error).message}\n\n`);
        }
        process.exit(1);
      }
    });

  program
    .command("actions")
    .description("List available action types")
    .action(() => {
      const out = [
        "DemoReel scene actions:",
        "",
        ...Object.entries(ACTION_DOCS).map(([name, doc]) => `  ${name.padEnd(12)} ${doc}`),
        "",
      ].join("\n");
      process.stdout.write(out + "\n");
    });

  // The `--mcp` flag short-circuits before commander parses subcommands.
  // Detect it manually for clean separation.
  if (process.argv.includes("--mcp")) {
    const { runMcpServer } = await import("./mcp.js");
    await runMcpServer();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  log.error("cli.fatal", { error: (err as Error).message });
  process.exit(1);
});
