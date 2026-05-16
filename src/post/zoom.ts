/**
 * Zoom keyframe builder. Takes the trace.json + parsed scenes
 * and produces FFmpeg filter expressions that interpolate
 * `crop` + `scale` between scene boundaries.
 *
 * Why a custom expression rather than the canned `zoompan`
 * filter: zoompan is designed for still images (Ken Burns over
 * one frame), not for video. We need a time-driven crop that
 * follows scene timestamps from trace.json. Standard
 * `crop=W:H:X:Y` with `t`-expression keyframes is the cleaner
 * primitive.
 */

import type { Scene } from "../schema/types.js";
import type { SceneTraceEntry, Trace } from "../recorder/trace.js";
import { parseZoomLevel } from "../util/paths.js";

export interface ZoomKeyframe {
  /** Seconds since recording start. */
  t: number;
  /** Pixel-space crop rect at this moment. */
  crop: { x: number; y: number; width: number; height: number };
}

/**
 * Build a sequence of zoom keyframes for the entire timeline.
 * Each scene contributes 0–2 keyframes:
 *   - No zoom: implicit "fullscreen" keyframe at scene start.
 *   - With zoom: enter-keyframe at scene start (interpolating
 *     from previous fullscreen) + hold-keyframe at scene end.
 *
 * Keyframes are emitted with linear interpolation between them
 * in the returned FFmpeg crop expression.
 */
export function buildZoomKeyframes(
  scenes: Scene[],
  trace: Trace,
): ZoomKeyframe[] {
  const keyframes: ZoomKeyframe[] = [];
  const { viewport } = trace;
  // Implicit starting fullscreen keyframe.
  keyframes.push({
    t: 0,
    crop: { x: 0, y: 0, width: viewport.width, height: viewport.height },
  });

  for (const scene of scenes) {
    const entry = findTraceEntry(trace, scene.name);
    if (!entry) continue;

    if (!scene.zoom) {
      // Scene without zoom: snap back to fullscreen at its start
      // (unless we're already there).
      const prev = keyframes[keyframes.length - 1];
      const isFullscreen =
        prev &&
        prev.crop.x === 0 &&
        prev.crop.y === 0 &&
        prev.crop.width === viewport.width &&
        prev.crop.height === viewport.height;
      if (!isFullscreen) {
        keyframes.push({
          t: entry.start_ms / 1000,
          crop: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        });
      }
      continue;
    }

    const level = parseZoomLevel(scene.zoom.level);
    const bbox = entry.zoom_bbox ?? scene.zoom.region;
    if (!bbox) continue;

    // Compute the crop rectangle: center on the bbox, dimensions
    // scaled down by `level` from the viewport.
    const cropWidth = Math.round(viewport.width / level);
    const cropHeight = Math.round(viewport.height / level);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    let cropX = Math.round(cx - cropWidth / 2);
    let cropY = Math.round(cy - cropHeight / 2);
    // Clamp to viewport.
    cropX = Math.max(0, Math.min(viewport.width - cropWidth, cropX));
    cropY = Math.max(0, Math.min(viewport.height - cropHeight, cropY));

    keyframes.push({
      t: entry.start_ms / 1000,
      crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
    });
  }

  return keyframes;
}

function findTraceEntry(trace: Trace, sceneName: string): SceneTraceEntry | undefined {
  return trace.scenes.find((s) => s.name === sceneName);
}

/**
 * Render the keyframes into an FFmpeg `crop` + `scale` filter
 * chain. The crop dimensions vary with `t`; `scale` brings
 * everything back to the target output resolution.
 *
 * FFmpeg's filtergraph supports `between(t,t1,t2)` and
 * `lerp(a,b,(t-t1)/(t2-t1))` for piecewise-linear interpolation.
 */
export function keyframesToFFmpegFilter(
  keyframes: ZoomKeyframe[],
  targetWidth: number,
  targetHeight: number,
): string {
  if (keyframes.length === 0) {
    return `scale=${targetWidth}:${targetHeight}`;
  }
  if (keyframes.length === 1) {
    const k = keyframes[0];
    if (!k) return `scale=${targetWidth}:${targetHeight}`;
    return `crop=${k.crop.width}:${k.crop.height}:${k.crop.x}:${k.crop.y},scale=${targetWidth}:${targetHeight}`;
  }
  const xExpr = buildPiecewiseExpr(keyframes, (k) => k.crop.x);
  const yExpr = buildPiecewiseExpr(keyframes, (k) => k.crop.y);
  const wExpr = buildPiecewiseExpr(keyframes, (k) => k.crop.width);
  const hExpr = buildPiecewiseExpr(keyframes, (k) => k.crop.height);
  return `crop=w='${wExpr}':h='${hExpr}':x='${xExpr}':y='${yExpr}',scale=${targetWidth}:${targetHeight}`;
}

/**
 * Build a piecewise-linear expression over keyframe times. For
 * keyframes [(t0,v0), (t1,v1), (t2,v2)] this produces:
 *
 *   if(lt(t,t1), v0+(v1-v0)*(t-t0)/(t1-t0),
 *     if(lt(t,t2), v1+(v2-v1)*(t-t1)/(t2-t1),
 *       v2))
 */
function buildPiecewiseExpr(
  keyframes: ZoomKeyframe[],
  pick: (k: ZoomKeyframe) => number,
): string {
  if (keyframes.length === 0) return "0";
  if (keyframes.length === 1) return `${pick(keyframes[0]!)}`;
  // Build right-to-left.
  let expr = `${pick(keyframes[keyframes.length - 1]!)}`;
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const k = keyframes[i]!;
    const next = keyframes[i + 1]!;
    const v0 = pick(k);
    const v1 = pick(next);
    const t0 = k.t;
    const t1 = next.t;
    const span = t1 - t0 || 1;
    expr = `if(lt(t,${t1}),${v0}+(${v1 - v0})*(t-${t0})/${span},${expr})`;
  }
  return expr;
}
