/**
 * MCP stdio server. Wraps the CLI commands as MCP tools so Claude
 * Code / Cursor / Codex can drive DemoReel via tool calls.
 *
 * Transport: stdio. Tools:
 *   - record_demo      → runRecord
 *   - preview_script   → runPreview
 *   - list_actions     → list available action types
 *   - render_overlay   → post-process-only pass (raw.webm + trace.json → MP4)
 *
 * The MCP server inherits its log output via stderr (see
 * util/log.ts) — stdout is reserved for JSON-RPC traffic.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { runPreview } from "./commands/preview.js";
import { runRecord } from "./commands/record.js";
import { runPostPipeline } from "./post/pipeline.js";
import { parseDemoFile } from "./schema/parser.js";

const TOOLS: Tool[] = [
  {
    name: "record_demo",
    description:
      "Record + post-process a .demo.yaml script end-to-end. Drives Playwright through the scenes, runs the FFmpeg pipeline, returns the final MP4 path. Use for full pipeline runs.",
    inputSchema: {
      type: "object",
      properties: {
        demo_path: {
          type: "string",
          description: "Absolute or cwd-relative path to the .demo.yaml file.",
        },
        headed: {
          type: "boolean",
          description: "Run with the browser visible. Default false.",
          default: false,
        },
        output: {
          type: "string",
          description: "Override the MP4 output path. Resolved relative to the demo file.",
        },
      },
      required: ["demo_path"],
    },
  },
  {
    name: "preview_script",
    description:
      "Dry-run a .demo.yaml — validates the schema, prints the action plan + estimated duration. Does NOT launch a browser. Use to verify a script parses cleanly before recording.",
    inputSchema: {
      type: "object",
      properties: {
        demo_path: {
          type: "string",
          description: "Path to the .demo.yaml file.",
        },
      },
      required: ["demo_path"],
    },
  },
  {
    name: "list_actions",
    description: "List available action types and their required fields. Useful when authoring a new demo script.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "render_overlay",
    description:
      "Post-process-only: takes an existing raw.webm + trace.json (from a previous record run) and runs the FFmpeg overlay/zoom pipeline against it. Use to re-render with updated overlays without re-recording the browser session.",
    inputSchema: {
      type: "object",
      properties: {
        demo_path: { type: "string", description: "Path to the .demo.yaml file." },
        raw_video: { type: "string", description: "Path to the raw .webm recording." },
        trace_path: { type: "string", description: "Path to the trace.json from the same record run." },
        output: { type: "string", description: "Override the MP4 output path." },
        work_dir: { type: "string", description: "Intermediate artefact directory." },
      },
      required: ["demo_path", "raw_video", "trace_path"],
    },
  },
];

const ACTION_DOCS: Record<string, string> = {
  goto: "Navigate to a URL. Required: url. Optional: wait_for.",
  click: "Click a selector. Required: selector. Optional: wait_for.",
  type: "Type into a selector. Required: selector + text. Optional: speed (ms/keystroke, default 80ms).",
  scroll: "Scroll. Required: selector OR to: {x, y}.",
  wait_for: "Wait for a selector or URL pattern. Required: selector OR url. Optional: timeout.",
  pause: "Hold the camera. Required: duration.",
  screenshot: "Screenshot to disk. Required: path. Optional: selector.",
};

interface ToolArgs {
  demo_path?: string;
  headed?: boolean;
  output?: string;
  raw_video?: string;
  trace_path?: string;
  work_dir?: string;
}

export async function runMcpServer(): Promise<void> {
  const server = new Server(
    { name: "demoreel", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as ToolArgs;

    try {
      switch (name) {
        case "record_demo": {
          if (!args.demo_path) throw new Error("demo_path is required");
          const result = await runRecord({
            demoPath: args.demo_path,
            headed: args.headed,
            output: args.output,
          });
          return jsonReply({
            output_path: result.outputPath,
            raw_video_path: result.rawVideoPath,
            trace_path: result.tracePath,
          });
        }
        case "preview_script": {
          if (!args.demo_path) throw new Error("demo_path is required");
          const result = runPreview(args.demo_path);
          return jsonReply({
            plan: result.plan,
            estimated_duration_ms: result.estimatedDurationMs,
            scene_count: result.config.scenes.length,
          });
        }
        case "list_actions": {
          return jsonReply({ actions: ACTION_DOCS });
        }
        case "render_overlay": {
          if (!args.demo_path || !args.raw_video || !args.trace_path) {
            throw new Error("demo_path, raw_video, and trace_path are required");
          }
          const demoPath = resolve(args.demo_path);
          const config = parseDemoFile(demoPath);
          const workDir = args.work_dir
            ? resolve(args.work_dir)
            : resolve(demoPath, "..", ".demoreel");
          // Smoke check trace.json parses (catches "wrong file" earlier).
          JSON.parse(readFileSync(args.trace_path, "utf8"));
          const result = await runPostPipeline({
            config,
            demoDir: resolve(demoPath, ".."),
            rawVideoPath: resolve(args.raw_video),
            tracePath: resolve(args.trace_path),
            workDir,
            outputPath: args.output ?? config.meta.output ?? "demo.mp4",
          });
          return jsonReply({ output_path: result.outputPath });
        }
        default:
          throw new Error(`unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function jsonReply(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}
