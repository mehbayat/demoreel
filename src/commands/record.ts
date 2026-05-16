/**
 * `demoreel record` — end-to-end: parse → record → post-process.
 *
 * Produces an MP4 at the config's `meta.output` path (resolved
 * relative to the demo file's directory).
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parseDemoFile, formatParseError, DemoParseError } from "../schema/parser.js";
import { recordSession } from "../recorder/session.js";
import { runPostPipeline } from "../post/pipeline.js";
import { log } from "../util/log.js";

export interface RecordOptions {
  /** Path to the .demo.yaml file. */
  demoPath: string;
  /** Run with the browser visible (default: headless). */
  headed?: boolean;
  /** Working directory for intermediate artefacts. Defaults to `<demoDir>/.demoreel`. */
  workDir?: string;
  /** Override the output path. */
  output?: string;
}

export interface RecordResult {
  outputPath: string;
  rawVideoPath: string;
  tracePath: string;
}

export async function runRecord(options: RecordOptions): Promise<RecordResult> {
  const demoPath = resolve(options.demoPath);
  const demoDir = dirname(demoPath);

  let config;
  try {
    config = parseDemoFile(demoPath);
  } catch (err) {
    if (err instanceof DemoParseError) {
      process.stderr.write(formatParseError(err));
      throw err;
    }
    throw err;
  }

  const workDir = options.workDir
    ? resolve(options.workDir)
    : join(demoDir, ".demoreel");
  mkdirSync(workDir, { recursive: true });

  const outputPath = options.output ?? config.meta.output ?? "demo.mp4";

  log.info("record.start", {
    demoPath,
    workDir,
    output: outputPath,
    scenes: config.scenes.length,
  });

  // 1. Record.
  const session = await recordSession({
    config,
    demoDir,
    outputDir: workDir,
    headed: options.headed,
  });

  // 2. Post-process.
  const post = await runPostPipeline({
    config,
    demoDir,
    rawVideoPath: session.rawVideoPath,
    tracePath: session.tracePath,
    workDir,
    outputPath,
  });

  log.info("record.done", { output: post.outputPath });
  return {
    outputPath: post.outputPath,
    rawVideoPath: session.rawVideoPath,
    tracePath: session.tracePath,
  };
}
