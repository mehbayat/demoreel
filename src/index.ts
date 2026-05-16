/**
 * Public library entrypoint. Re-exports the API surface so DemoReel
 * can be used programmatically (not just via the CLI / MCP).
 */

export { parseDemoFile, parseDemoString, DemoParseError, formatParseError } from "./schema/parser.js";
export type { ParseIssue } from "./schema/parser.js";
export { demoSchema } from "./schema/schema.js";
export type {
  ActionKind,
  Auth,
  DemoConfig,
  DemoMeta,
  DurationLiteral,
  Overlay,
  OverlayAnimation,
  Resolution,
  Scene,
  TypingSpeed,
  ZoomSpec,
} from "./schema/types.js";

export { runInit } from "./commands/init.js";
export { runPreview } from "./commands/preview.js";
export { runRecord } from "./commands/record.js";

export { recordSession } from "./recorder/session.js";
export type { RecordSessionOptions, RecordSessionResult } from "./recorder/session.js";

export { runPostPipeline } from "./post/pipeline.js";
export type { RenderPipelineOptions, RenderPipelineResult } from "./post/pipeline.js";

export { runMcpServer } from "./mcp.js";
