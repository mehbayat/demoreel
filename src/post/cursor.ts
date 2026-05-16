/**
 * Cursor highlight overlay.
 *
 * Headless Chromium has no system cursor, so the captured mouse
 * positions in trace.json are the points where Playwright's
 * action class operated (click centers, type focus points). The
 * post-processor renders a brief pulsing circle at each captured
 * position so viewers' eyes follow the action — a much more
 * presentation-friendly experience than guessing where the click
 * landed.
 *
 * Implementation:
 *   - Render ONE 96×96 PNG with a semi-transparent yellow circle +
 *     soft white outline (via Playwright + an SVG-in-HTML page).
 *   - The post-processor's ffmpeg pipeline overlays this PNG at
 *     each (x, y) timestamp with a 0.6s pulse window: fade-in
 *     0.15s → hold 0.3s → fade-out 0.15s. Multiple sequential
 *     pulses look like a heartbeat.
 *
 * Why one shared PNG rather than per-pulse: cheap. ffmpeg loops
 * the same image input for as many overlay invocations as we
 * have positions.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import type { Trace } from "../recorder/trace.js";
import { log } from "../util/log.js";

const CURSOR_PNG_SIZE = 96; // px — final composite scales with main resolution
const PULSE_DURATION = 0.6;
const FADE_IN = 0.15;
const FADE_OUT = 0.15;

export interface CursorOverlay {
  /** ffmpeg input path for the cursor PNG. */
  pngPath: string;
  /** Pulses to render, derived from trace.scenes[].mouse[]. */
  pulses: Array<{ tSec: number; x: number; y: number }>;
}

export async function renderCursorHighlightPng(
  workDir: string,
): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const pngPath = join(workDir, "cursor-highlight.png");
  if (existsSync(pngPath)) return pngPath;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: CURSOR_PNG_SIZE, height: CURSOR_PNG_SIZE },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>
        html, body { margin: 0; padding: 0; background: transparent; }
        svg { display: block; }
      </style></head><body>
        <svg width="${CURSOR_PNG_SIZE}" height="${CURSOR_PNG_SIZE}" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="g" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#facc15" stop-opacity="0.7" />
              <stop offset="55%" stop-color="#facc15" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#facc15" stop-opacity="0" />
            </radialGradient>
          </defs>
          <circle cx="48" cy="48" r="44" fill="url(#g)" />
          <circle cx="48" cy="48" r="18" fill="rgba(255,255,255,0.85)" stroke="#facc15" stroke-width="3" />
        </svg>
      </body></html>`,
      { waitUntil: "load" },
    );
    await page.locator("svg").screenshot({ path: pngPath, omitBackground: true });
    await context.close();
  } finally {
    await browser.close();
  }
  log.info("cursor.png_rendered", { pngPath });
  return pngPath;
}

/**
 * Build the list of cursor pulses from a trace. Each entry from
 * ``trace.scenes[].mouse[]`` becomes one pulse at the recording-
 * relative timestamp.
 */
export function buildCursorPulses(trace: Trace): CursorOverlay["pulses"] {
  const pulses: CursorOverlay["pulses"] = [];
  for (const scene of trace.scenes) {
    if (!scene.mouse) continue;
    for (const m of scene.mouse) {
      pulses.push({ tSec: m.t_ms / 1000, x: m.x, y: m.y });
    }
  }
  return pulses;
}

/**
 * Produce a single MP4 with cursor pulses composited on top of
 * the input. Pulse PNG is overlaid at each (x, y) position, time-
 * windowed with fade-in/out via the ``fade`` filter (same trick
 * the dialogue overlay uses). Returns true on success, false on
 * no-pulses (caller should skip the step).
 */
export async function compositeCursorOverlay(
  inputMp4: string,
  outputMp4: string,
  cursorPng: string,
  pulses: CursorOverlay["pulses"],
): Promise<boolean> {
  if (pulses.length === 0) return false;

  // Build the filtergraph: each pulse needs its own faded copy of
  // the cursor PNG (because ffmpeg's overlay enable= window can
  // toggle visibility but can't apply a different fade per pulse).
  // We use ``split`` on input 1 (the PNG) to fan out N copies,
  // each goes through its own fade chain + overlay.
  const splitCount = pulses.length;
  const splitLabels = pulses.map((_, i) => `[c${i}]`).join("");
  let filter = `[1:v]split=${splitCount}${splitLabels};`;

  let currentLabel = "[0:v]";
  pulses.forEach((p, i) => {
    const fadeOutStart = Math.max(p.tSec, p.tSec + PULSE_DURATION - FADE_OUT);
    const faded = `[c${i}f]`;
    filter +=
      `[c${i}]format=rgba,` +
      `fade=in:st=${p.tSec}:d=${FADE_IN}:alpha=1,` +
      `fade=out:st=${fadeOutStart}:d=${FADE_OUT}:alpha=1` +
      faded +
      ";";
    const overlayed = i === pulses.length - 1 ? "[out]" : `[v${i}]`;
    const xExpr = p.x - CURSOR_PNG_SIZE / 2;
    const yExpr = p.y - CURSOR_PNG_SIZE / 2;
    const enable = `between(t,${p.tSec},${p.tSec + PULSE_DURATION})`;
    filter +=
      `${currentLabel}${faded}overlay=${xExpr}:${yExpr}:enable='${enable}'${overlayed};`;
    currentLabel = overlayed;
  });
  // Strip trailing semicolon.
  filter = filter.replace(/;$/, "");

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputMp4,
    "-i",
    cursorPng,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-c:a",
    "copy",
    outputMp4,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`ffmpeg cursor overlay exited ${code}: ${stderr.slice(-800)}`),
        );
    });
  });
  log.info("cursor.overlay_composited", { pulses: pulses.length });
  return true;
}
