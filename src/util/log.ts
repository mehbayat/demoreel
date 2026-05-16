/**
 * Minimal structured logger. Strings go to stderr so they can't
 * pollute MCP stdio responses (which must be valid JSON-RPC on
 * stdout).
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let activeLevel: Level = (process.env.DEMOREEL_LOG_LEVEL as Level) || "info";

export function setLogLevel(level: Level): void {
  activeLevel = level;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[activeLevel]) return;
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  // Always stderr — see header.
  process.stderr.write(`[${ts}] ${level.toUpperCase()} ${msg}${metaStr}\n`);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
