/**
 * Path resolution helpers. The demo file's directory is the
 * implicit base for `output`, `logo`, asset references, etc. —
 * mirrors how docker-compose treats relative paths.
 */

import { dirname, isAbsolute, resolve } from "node:path";

/** Resolve a path relative to the demo file's directory. */
export function resolveRelativeToDemo(demoFilePath: string, target: string): string {
  if (isAbsolute(target)) return target;
  return resolve(dirname(demoFilePath), target);
}

/** Parse a duration literal (`"2s"`, `"500ms"`) into milliseconds. */
export function parseDurationToMs(literal: string | number): number {
  if (typeof literal === "number") return literal;
  const m = literal.match(/^([0-9]+(?:\.[0-9]+)?)(s|ms)$/);
  if (!m) throw new Error(`Invalid duration literal: ${literal}`);
  const value = Number(m[1]);
  return m[2] === "s" ? value * 1000 : value;
}

/** Parse a resolution literal (`"1920x1080"`) into {width, height}. */
export function parseResolution(literal: string): { width: number; height: number } {
  const m = literal.match(/^([0-9]+)x([0-9]+)$/);
  if (!m) throw new Error(`Invalid resolution: ${literal}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Parse a zoom level (`"1.5x"` or numeric `1.5`) into a float. */
export function parseZoomLevel(level: string | number): number {
  if (typeof level === "number") return level;
  const m = level.match(/^([0-9]+(?:\.[0-9]+)?)x$/);
  if (!m) throw new Error(`Invalid zoom level: ${level}`);
  return Number(m[1]);
}
