/**
 * Render dialogue boxes to transparent PNGs.
 *
 * MVP: Playwright screenshots an HTML template into a
 * transparent PNG. Each scene with `overlay.dialogue` produces
 * one PNG; the post-processor's overlay step composites it
 * onto the timeline at the scene's start_ms.
 *
 * v2 will swap to per-scene transparent WebM clips for animated
 * reveal (typewriter / slide-up). The overlay-composite signature
 * stays the same — FFmpeg `overlay` handles both image and video
 * inputs.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "playwright";

import type { Scene } from "../schema/types.js";
import { log } from "../util/log.js";

export interface DialogueRenderOptions {
  scenes: Scene[];
  outputDir: string;
  viewportWidth: number;
  viewportHeight: number;
  brandColor?: string;
}

export interface DialogueAsset {
  /** Scene name this PNG belongs to. */
  sceneName: string;
  /** Absolute path to the rendered PNG. */
  path: string;
  /** Computed bottom-right position (top-left coords) for FFmpeg overlay. */
  x: number;
  y: number;
  /** Rendered size. */
  width: number;
  height: number;
}

/**
 * Render every scene's dialogue into a transparent PNG.
 * Returns one asset descriptor per scene that has a dialogue.
 */
export async function renderDialoguePngs(
  options: DialogueRenderOptions,
): Promise<DialogueAsset[]> {
  const scenesWithDialogue = options.scenes.filter(
    (s) => s.overlay?.dialogue || s.overlay?.cta,
  );
  if (scenesWithDialogue.length === 0) return [];

  mkdirSync(options.outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: options.viewportWidth, height: options.viewportHeight },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const assets: DialogueAsset[] = [];
  const brand = options.brandColor ?? "#10b981";

  try {
    for (const scene of scenesWithDialogue) {
      const html = renderDialogueHtml({
        dialogue: scene.overlay?.dialogue,
        cta: scene.overlay?.cta,
        brandColor: brand,
      });
      await page.setContent(html, { waitUntil: "load" });
      // Allow web fonts a tick to settle before screenshot. (Runs in
      // the page's browser context; `document` exists there.)
      await page.evaluate(
        () => (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document?.fonts?.ready,
      );
      const locator = page.locator("#dialogue");
      const bbox = await locator.boundingBox();
      if (!bbox) {
        log.warn("dialogue.skip", { scene: scene.name, reason: "no bbox" });
        continue;
      }
      const outPath = join(options.outputDir, `dialogue-${scene.name}.png`);
      mkdirSync(dirname(outPath), { recursive: true });
      await locator.screenshot({ path: outPath, omitBackground: true });
      const margin = 64;
      const x = options.viewportWidth - Math.round(bbox.width) - margin;
      const y = options.viewportHeight - Math.round(bbox.height) - margin;
      assets.push({
        sceneName: scene.name,
        path: outPath,
        x,
        y,
        width: Math.round(bbox.width),
        height: Math.round(bbox.height),
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  log.info("dialogue.rendered", { count: assets.length });
  return assets;
}

interface DialogueHtmlInput {
  dialogue?: string;
  cta?: { text: string; url?: string };
  brandColor: string;
}

function renderDialogueHtml(input: DialogueHtmlInput): string {
  const escapedDialogue = input.dialogue ? escapeHtml(input.dialogue) : "";
  const escapedCtaText = input.cta?.text ? escapeHtml(input.cta.text) : "";
  return `<!doctype html>
<html><head><meta charset="UTF-8" /><style>
  html, body {
    margin: 0; padding: 0;
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #0f172a;
  }
  #dialogue {
    display: inline-block;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    padding: 18px 24px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
    max-width: 540px;
    border: 1px solid rgba(15, 23, 42, 0.08);
  }
  .dialogue-text {
    font-size: 22px;
    line-height: 1.35;
    font-weight: 500;
    letter-spacing: -0.01em;
  }
  .cta {
    margin-top: 12px;
    display: inline-block;
    padding: 8px 16px;
    background: ${input.brandColor};
    color: white;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
  }
</style></head>
<body>
  <div id="dialogue">
    ${escapedDialogue ? `<div class="dialogue-text">${escapedDialogue}</div>` : ""}
    ${escapedCtaText ? `<div class="cta">${escapedCtaText}</div>` : ""}
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
