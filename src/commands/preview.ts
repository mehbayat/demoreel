/**
 * `demoreel preview` — dry-run. Parses the demo file, prints the
 * action list with computed timings, but does NOT launch a browser
 * or run ffmpeg. The fastest possible "does my script even parse"
 * loop.
 */

import { dirname, resolve } from "node:path";

import { parseDemoFile } from "../schema/parser.js";
import type { DemoConfig, Scene } from "../schema/types.js";
import { parseDurationToMs } from "../util/paths.js";

export interface PreviewResult {
  config: DemoConfig;
  /** Pretty-printable action plan. */
  plan: string;
  /** Estimated total recording duration in ms (rough — actual depends on network/page state). */
  estimatedDurationMs: number;
}

export function runPreview(demoPath: string): PreviewResult {
  const abs = resolve(demoPath);
  const config = parseDemoFile(abs);

  // Estimate per scene.
  const lines: string[] = [];
  let totalMs = 0;
  config.scenes.forEach((scene, i) => {
    const est = estimateSceneMs(scene);
    totalMs += est;
    lines.push(formatScene(i + 1, scene, est));
  });

  const plan =
    `# Plan for ${config.meta.title}\n` +
    `# Source: ${abs}\n` +
    `# Working dir: ${dirname(abs)}\n` +
    `# Scenes: ${config.scenes.length}\n` +
    `# Estimated duration: ${(totalMs / 1000).toFixed(1)}s\n\n` +
    lines.join("\n");

  return { config, plan, estimatedDurationMs: totalMs };
}

/** Rough per-scene duration estimate (in ms). */
function estimateSceneMs(scene: Scene): number {
  let ms = 0;
  switch (scene.action) {
    case "goto":
      ms += 1500; // typical page load
      break;
    case "click":
      ms += 300;
      break;
    case "type": {
      const speedMs =
        scene.speed === 0
          ? 0
          : scene.speed !== undefined
            ? parseDurationToMs(scene.speed)
            : 80;
      ms += (scene.text?.length ?? 0) * speedMs + 200;
      break;
    }
    case "scroll":
      ms += 500;
      break;
    case "wait_for":
      ms += 800;
      break;
    case "pause":
      if (scene.duration) ms += parseDurationToMs(scene.duration);
      break;
    case "screenshot":
      ms += 200;
      break;
    case undefined:
      // Overlay-only scene: budget 2s for the dialogue to be read.
      ms += 2000;
      break;
  }
  if (scene.pause_after) ms += parseDurationToMs(scene.pause_after);
  return ms;
}

function formatScene(idx: number, scene: Scene, estMs: number): string {
  const kind = scene.action ?? "overlay";
  const target = scene.url ?? scene.selector ?? "—";
  const overlay = scene.overlay?.dialogue ? ` ‹${scene.overlay.dialogue}›` : "";
  const zoom = scene.zoom ? ` [zoom ${formatZoomLevel(scene.zoom.level)}]` : "";
  return `${pad(String(idx), 3)}. ${pad(scene.name, 24)} ${pad(kind, 10)} ${pad(
    target,
    32,
  )} ~${(estMs / 1000).toFixed(1)}s${overlay}${zoom}`;
}

function formatZoomLevel(level: string | number): string {
  return typeof level === "number" ? `${level}x` : level;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…";
  return s + " ".repeat(n - s.length);
}
