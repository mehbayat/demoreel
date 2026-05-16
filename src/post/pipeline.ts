/**
 * Post-production pipeline orchestrator.
 *
 * Input: raw.webm (from Playwright) + trace.json + parsed
 * DemoConfig.
 * Output: final.mp4 (H.264, faststart, web-optimized).
 *
 * Stages (in order):
 *   1. Render per-scene dialogue PNGs.
 *   2. Build zoom keyframe expression from trace + scenes.
 *   3. Build overlay filter chain (logo + dialogues).
 *   4. Spawn one ffmpeg pass with the combined filtergraph.
 *
 * Single ffmpeg pass on purpose. Chaining multiple ffmpeg calls
 * would double-decode the video. The filter expressions are big
 * but the encoder cost is unchanged.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DemoConfig } from "../schema/types.js";
import { log } from "../util/log.js";
import { parseResolution, resolveRelativeToDemo } from "../util/paths.js";
import { renderIntroOutroCard } from "./cards.js";
import { renderDialoguePngs } from "./dialogue.js";
import { buildOverlayChain } from "./overlay.js";
import type { Trace } from "../recorder/trace.js";
import { buildZoomKeyframes, keyframesToFFmpegFilter } from "./zoom.js";

export interface RenderPipelineOptions {
  config: DemoConfig;
  /** Directory the demo file lives in — base for relative paths. */
  demoDir: string;
  /** Raw recording from the recorder stage. */
  rawVideoPath: string;
  /** Trace.json from the recorder stage. */
  tracePath: string;
  /** Where intermediate artefacts (dialogue PNGs etc.) go. */
  workDir: string;
  /** Final output MP4 path. Resolved relative to `demoDir`. */
  outputPath: string;
}

export interface RenderPipelineResult {
  outputPath: string;
}

export async function runPostPipeline(
  options: RenderPipelineOptions,
): Promise<RenderPipelineResult> {
  const { config, demoDir, rawVideoPath, tracePath, workDir, outputPath } = options;
  const resolution = parseResolution(config.meta.resolution ?? "1920x1080");
  mkdirSync(workDir, { recursive: true });

  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as Trace;

  log.info("post.dialogue_render", {});
  const dialogues = await renderDialoguePngs({
    scenes: config.scenes,
    outputDir: join(workDir, "dialogue"),
    viewportWidth: resolution.width,
    viewportHeight: resolution.height,
    brandColor: config.meta.brand_color,
  });

  log.info("post.zoom_keyframes", {});
  const keyframes = buildZoomKeyframes(config.scenes, trace);
  const zoomFilter = keyframesToFFmpegFilter(keyframes, resolution.width, resolution.height);

  log.info("post.overlay_chain", {});
  // Resolve logo path. Scene-level overlays can each carry a logo
  // but MVP treats the FIRST encountered logo as the timeline-wide
  // brand mark. v2 supports per-scene logo swaps.
  const logoScene = config.scenes.find((s) => s.overlay?.logo);
  const logoPath = logoScene?.overlay?.logo
    ? resolveRelativeToDemo(demoDir, logoScene.overlay.logo)
    : undefined;
  const overlay = buildOverlayChain(
    config.scenes,
    trace,
    { logoPath, dialogues },
    resolution.width,
    resolution.height,
  );

  // Stitch the filtergraph. `[0:v]` is the source.
  const filterGraph = [
    `[0:v]${zoomFilter}[zoomed]`,
    overlay.filterChain,
  ].join(";");

  const finalOut = resolveRelativeToDemo(demoDir, outputPath);
  const fps = config.meta.fps ?? 30;

  // 2026-05-16: intro / outro cards. When meta.intro or meta.outro
  // is set, render each as a static MP4 segment matching the main
  // recording's dims + fps, then concat [intro?, main, outro?].
  // Skip rendering the main MP4 directly to finalOut when either
  // card is present — pipe to a tmp file first so the concat step
  // can splice them in.
  const hasIntro = !!config.meta.intro;
  const hasOutro = !!config.meta.outro;
  const mainOut = hasIntro || hasOutro
    ? join(workDir, "main.mp4")
    : finalOut;

  await runFfmpeg({
    inputs: [rawVideoPath, ...overlay.extraInputs],
    filterGraph,
    output: mainOut,
    fps,
  });

  if (hasIntro || hasOutro) {
    const cardsDir = join(workDir, "cards");
    mkdirSync(cardsDir, { recursive: true });
    const segments: string[] = [];
    if (hasIntro && config.meta.intro) {
      const introPath = join(cardsDir, "intro.mp4");
      await renderIntroOutroCard({
        card: config.meta.intro,
        demoDir,
        outputPath: introPath,
        width: resolution.width,
        height: resolution.height,
        fps,
        brandColor: config.meta.brand_color,
      });
      segments.push(introPath);
    }
    segments.push(mainOut);
    if (hasOutro && config.meta.outro) {
      const outroPath = join(cardsDir, "outro.mp4");
      await renderIntroOutroCard({
        card: config.meta.outro,
        demoDir,
        outputPath: outroPath,
        width: resolution.width,
        height: resolution.height,
        fps,
        brandColor: config.meta.brand_color,
      });
      segments.push(outroPath);
    }
    await concatMp4s(segments, finalOut, fps);
    log.info("post.concat_with_cards", {
      segments: segments.length,
      intro: hasIntro,
      outro: hasOutro,
    });
  }

  log.info("post.done", { output: finalOut });
  return { outputPath: finalOut };
}

/**
 * Concat a list of MP4 segments into a single output via ffmpeg's
 * concat demuxer. All inputs must share dims + framerate + codec —
 * the card renderer matches the main pipeline's encoder settings
 * (libx264, yuv420p, 30fps) so this is a safe path.
 */
async function concatMp4s(
  segments: string[],
  output: string,
  fps: number,
): Promise<void> {
  // ffmpeg concat filter is more robust than the demuxer for
  // cases where the inputs MIGHT diverge in encoder settings —
  // it re-encodes everything to a uniform output. Worth the
  // small extra CPU cost vs. demuxer fragility.
  const filterInputs = segments.map((_, i) => `[${i}:v]`).join("");
  const filter = `${filterInputs}concat=n=${segments.length}:v=1:a=0[out]`;
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...segments.flatMap((s) => ["-i", s]),
    "-filter_complex",
    filter,
    "-map",
    "[out]",
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
    output,
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
      else reject(new Error(`ffmpeg concat exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

interface FfmpegArgs {
  inputs: string[];
  filterGraph: string;
  output: string;
  fps: number;
}

async function runFfmpeg(args: FfmpegArgs): Promise<void> {
  const cli = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...args.inputs.flatMap((path) => ["-i", path]),
    "-filter_complex",
    args.filterGraph,
    "-map",
    "[out]",
    "-r",
    String(args.fps),
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
    args.output,
  ];

  log.debug("ffmpeg.spawn", { cmd: ["ffmpeg", ...cli].join(" ") });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", cli, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `ffmpeg exited ${code}. Tail of stderr:\n${stderr.slice(-1200)}`,
          ),
        );
      }
    });
  });
}
