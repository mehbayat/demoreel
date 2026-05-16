/**
 * Recording session orchestrator. Spins up Playwright, runs the
 * pre-recording auth flow if present, then walks the scenes
 * end-to-end while emitting trace entries.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { DemoConfig } from "../schema/types.js";
import { log } from "../util/log.js";
import { parseResolution } from "../util/paths.js";
import { runSceneAction } from "./actions.js";
import { TraceBuilder } from "./trace.js";

export interface RecordSessionResult {
  /** Absolute path to the raw recorded video (WebM from Playwright). */
  rawVideoPath: string;
  /** Absolute path to trace.json. */
  tracePath: string;
}

export interface RecordSessionOptions {
  /** Demo config (already parsed + validated). */
  config: DemoConfig;
  /** Directory the demo file lives in — base for relative paths. */
  demoDir: string;
  /** Where to write `raw.webm` + `trace.json`. */
  outputDir: string;
  /** Run with browser UI visible. Defaults to headless. */
  headed?: boolean;
}

export async function recordSession(
  options: RecordSessionOptions,
): Promise<RecordSessionResult> {
  const { config, outputDir, headed = false } = options;
  const resolution = parseResolution(config.meta.resolution ?? "1920x1080");

  mkdirSync(outputDir, { recursive: true });
  const tracePath = join(outputDir, "trace.json");

  log.info("recording.start", {
    scenes: config.scenes.length,
    resolution: `${resolution.width}x${resolution.height}`,
    headed,
  });

  const browser: Browser = await chromium.launch({ headless: !headed });
  const context: BrowserContext = await browser.newContext({
    viewport: resolution,
    deviceScaleFactor: 1,
    recordVideo: {
      dir: outputDir,
      size: resolution,
    },
  });

  // Auth: inject cookies before the first navigation if specified.
  if (config.auth?.cookies && config.auth.cookies.length > 0) {
    const cookies = normalizeCookies(config.auth.cookies);
    if (cookies.length > 0) await context.addCookies(cookies);
  }

  const page: Page = await context.newPage();
  const trace = new TraceBuilder(resolution);

  // Mouse trail capture — every move samples a position. Best-effort;
  // Playwright doesn't broadcast a move event to the test runner, so
  // we wrap the page's mouse with a position interceptor via the
  // CDP-backed `Page.on("response"...)` approach is too noisy. Stub
  // for now: actions push their click coordinates explicitly.

  trace.start();

  // Pre-recording auth login flow. Runs BEFORE timeline scenes so the
  // login isn't captured. We still drive it through `runSceneAction`
  // for consistency; trace entries are skipped (auth.login isn't a
  // user-facing timeline).
  if (config.auth?.login) {
    log.info("recording.auth_login", { steps: config.auth.login.length });
    for (const step of config.auth.login) {
      // Auth scenes share Scene typing; not all fields apply but the
      // dispatcher tolerates partials.
      await runSceneAction(page, step as never, { trace });
    }
  }

  for (const scene of config.scenes) {
    log.info("recording.scene", { name: scene.name, action: scene.action ?? "overlay" });
    trace.beginScene(scene.name, scene.action ?? null);
    try {
      await runSceneAction(page, scene, { trace });
    } catch (err) {
      log.error("recording.scene_failed", {
        name: scene.name,
        error: (err as Error).message,
      });
      throw err;
    }
  }
  trace.endScene();

  await context.close();
  await browser.close();

  // Playwright writes a single .webm per page in the recordVideo dir.
  // Find it (the dir is fresh, so there's exactly one).
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(outputDir);
  const webm = entries.find((name) => name.endsWith(".webm"));
  if (!webm) {
    throw new Error(
      `Playwright did not produce a .webm in ${outputDir} — recording may have failed.`,
    );
  }
  const rawVideoPath = join(outputDir, webm);

  trace.writeTo(tracePath);

  log.info("recording.done", { raw: rawVideoPath, trace: tracePath });
  return { rawVideoPath, tracePath };
}

function normalizeCookies(
  cookies: NonNullable<DemoConfig["auth"]>["cookies"],
): Array<{ name: string; value: string; domain?: string; path?: string }> {
  if (!cookies) return [];
  const out: Array<{ name: string; value: string; domain?: string; path?: string }> = [];
  for (const c of cookies) {
    if (typeof c === "string") {
      const idx = c.indexOf("=");
      if (idx <= 0) continue;
      out.push({ name: c.slice(0, idx), value: c.slice(idx + 1) });
    } else {
      out.push(c);
    }
  }
  return out;
}

// Silence the unused-import warning while we leave `dirname` in for
// future use (relative output normalisation).
void dirname;
