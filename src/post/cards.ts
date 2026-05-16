/**
 * Intro / outro card renderer.
 *
 * Each card → static PNG via Playwright HTML render → ffmpeg
 * loops the PNG for ``duration_sec`` at the project's fps to
 * produce a short MP4 segment matching the main recording's
 * resolution + framerate + codec. The pipeline orchestrator
 * concats [intro?, main, outro?] in order.
 *
 * Mirrors ``dialogue.ts``'s HTML-via-Playwright approach so the
 * card aesthetic is consistent with the dialogue overlays.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import type { IntroOutroCard } from "../schema/types.js";
import { log } from "../util/log.js";
import { resolveRelativeToDemo } from "../util/paths.js";

export interface RenderCardOptions {
  card: IntroOutroCard;
  /** Demo file directory — base for relative logo paths. */
  demoDir: string;
  /** Output MP4 path for this card segment. */
  outputPath: string;
  /** Match the main recording's resolution. */
  width: number;
  height: number;
  fps: number;
  /** Brand color override (used when the card omits accent_color). */
  brandColor?: string;
}

export async function renderIntroOutroCard(
  options: RenderCardOptions,
): Promise<void> {
  const { card, demoDir, outputPath, width, height, fps, brandColor } = options;
  const duration = card.duration_sec ?? 3;

  // 1. Render the card HTML to a PNG via Playwright (full viewport
  //    screenshot — the card fills the frame, no transparent
  //    background needed since it IS the frame).
  const tmpDir = join(outputPath, "..", `.card-tmp-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const pngPath = join(tmpDir, "card.png");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const html = renderCardHtml({
      card,
      width,
      height,
      brandColor: brandColor ?? "#10b981",
      logoDataUrl:
        card.logo !== undefined
          ? await loadLogoDataUrl(resolveRelativeToDemo(demoDir, card.logo))
          : undefined,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(
      () => (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document?.fonts?.ready,
    );
    await page.screenshot({ path: pngPath, fullPage: false });
    await context.close();
  } finally {
    await browser.close();
  }

  // 2. ffmpeg loop the PNG for ``duration`` seconds.
  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    pngPath,
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  log.info("card.rendered", { outputPath, duration });
}

interface CardHtmlInput {
  card: IntroOutroCard;
  width: number;
  height: number;
  brandColor: string;
  logoDataUrl?: string;
}

function renderCardHtml(input: CardHtmlInput): string {
  const { card, width, height, brandColor, logoDataUrl } = input;
  const bg = card.background ?? "#0a0a0a";
  const fg = card.text_color ?? "#ffffff";
  const accent = card.accent_color ?? brandColor;
  const safeTitle = escapeHtml(card.title);
  const safeSubtitle = card.subtitle ? escapeHtml(card.subtitle) : "";
  const safeCta = card.cta?.text ? escapeHtml(card.cta.text) : "";
  return `<!doctype html>
<html><head><meta charset="UTF-8" /><style>
  html, body {
    margin: 0; padding: 0;
    width: ${width}px; height: ${height}px;
    background: ${bg};
    color: ${fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    overflow: hidden;
  }
  .card {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 32px;
    padding: 80px;
    box-sizing: border-box;
    text-align: center;
  }
  .logo {
    max-width: 280px;
    max-height: 120px;
    object-fit: contain;
    margin-bottom: 8px;
  }
  .title {
    font-size: ${Math.round(height * 0.075)}px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.05;
    max-width: 80%;
  }
  .subtitle {
    font-size: ${Math.round(height * 0.028)}px;
    font-weight: 400;
    line-height: 1.4;
    opacity: 0.78;
    max-width: 60%;
  }
  .cta {
    display: inline-block;
    margin-top: 16px;
    padding: 14px 28px;
    background: ${accent};
    color: ${bg};
    border-radius: 12px;
    font-weight: 600;
    font-size: ${Math.round(height * 0.022)}px;
    letter-spacing: 0.01em;
  }
</style></head>
<body>
  <div class="card">
    ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" />` : ""}
    <div class="title">${safeTitle}</div>
    ${safeSubtitle ? `<div class="subtitle">${safeSubtitle}</div>` : ""}
    ${safeCta ? `<div class="cta">${safeCta}</div>` : ""}
  </div>
</body></html>`;
}

async function loadLogoDataUrl(absPath: string): Promise<string | undefined> {
  try {
    const { readFileSync } = await import("node:fs");
    const ext = absPath.toLowerCase().split(".").pop() ?? "";
    const mime =
      ext === "svg"
        ? "image/svg+xml"
        : ext === "png"
          ? "image/png"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "webp"
              ? "image/webp"
              : "image/png";
    const buf = readFileSync(absPath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg card-render exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}
