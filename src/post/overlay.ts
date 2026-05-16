/**
 * Logo + dialogue overlay compositor. Produces an FFmpeg filter
 * chain that layers each overlay asset onto the (already zoomed)
 * base video at its scene's start_ms.
 *
 * Logo is a "constant" overlay (drawn for the entire timeline).
 * Dialogue boxes are time-windowed (drawn only during their
 * scene). Both use FFmpeg's `overlay` filter with the
 * `enable=between(t,...)` selector for timing.
 */

import type { Scene } from "../schema/types.js";
import type { DialogueAsset } from "./dialogue.js";
import type { Trace } from "../recorder/trace.js";

export interface OverlayInputs {
  /** Path to the logo image, if any. Drawn full-timeline. */
  logoPath?: string;
  /** Per-scene dialogue PNGs. */
  dialogues: DialogueAsset[];
}

export interface OverlayPlan {
  /** Additional inputs passed to ffmpeg via `-i`. */
  extraInputs: string[];
  /**
   * Filter-graph node that takes the post-zoom video as input and
   * produces the final overlay-composited output.
   */
  filterChain: string;
}

/**
 * Build the FFmpeg overlay chain.
 *
 * Input filter labels:
 *   [v0]  the post-zoom video
 *   [vN]  the Nth overlay image input (logo + dialogues)
 *
 * Each overlay node consumes the previous video label + the next
 * image input and produces a new video label.
 */
export function buildOverlayChain(
  scenes: Scene[],
  trace: Trace,
  inputs: OverlayInputs,
  viewportWidth: number,
  viewportHeight: number,
): OverlayPlan {
  const extraInputs: string[] = [];
  const filterParts: string[] = [];

  let currentLabel = "[zoomed]";
  let inputIndex = 1; // 0 is the base video

  if (inputs.logoPath) {
    extraInputs.push(inputs.logoPath);
    const margin = 32;
    // Bottom-right placement by default. W/H are filter-eval-time vars.
    const x = viewportWidth - 220;
    const y = viewportHeight - 100;
    const next = `[v${inputIndex}]`;
    filterParts.push(`${currentLabel}[${inputIndex}:v]overlay=${x}:${y}${next}`);
    currentLabel = next;
    inputIndex += 1;
  }

  for (const asset of inputs.dialogues) {
    const traceEntry = trace.scenes.find((s) => s.name === asset.sceneName);
    if (!traceEntry) continue;
    const startSec = traceEntry.start_ms / 1000;
    const endSec = traceEntry.end_ms / 1000;
    const sceneCfg = scenes.find((s) => s.name === asset.sceneName);
    const animation = sceneCfg?.overlay?.animation ?? "fade-in";
    // Apply a fade-in/out window: 0.3s ramp at each boundary by default.
    const fadeIn = 0.3;
    const fadeOut = 0.3;
    const fadeOutStart = Math.max(startSec, endSec - fadeOut);
    const enable = `between(t,${startSec},${endSec})`;
    extraInputs.push(asset.path);
    const next = `[v${inputIndex}]`;

    // 2026-05-16: animation support.
    // - ``fade-in`` / ``fade-out`` (default) — existing alpha ramp.
    // - ``slide-up`` — animated y position: starts ~80px below the
    //   final position, eases up to the final y over 0.4s, then
    //   holds. Implemented via an ffmpeg ``y=`` expression
    //   referencing frame time ``t``. The fade ramps stay on so
    //   the slide reads as a coherent reveal.
    // - ``typewriter`` — falls back to fade-in for now; full
    //   char-reveal is a v0.2 follow-up (needs PNG-sequence-to-
    //   alpha-WebM authoring; deferred to keep this round under a
    //   day).
    const useSlideUp = animation === "slide-up";
    const slideDistance = 80; // px
    const slideDur = 0.4; // s
    const yExpr = useSlideUp
      ? `'if(lt(t,${startSec}+${slideDur}),` +
        `${asset.y}+${slideDistance}*(1-(t-${startSec})/${slideDur}),` +
        `${asset.y})'`
      : `${asset.y}`;
    const xExpr = `${asset.x}`;

    // Per-asset alpha layer with fade in + out.
    filterParts.push(
      `[${inputIndex}:v]` +
        `format=rgba,` +
        `fade=in:st=${startSec}:d=${fadeIn}:alpha=1,` +
        `fade=out:st=${fadeOutStart}:d=${fadeOut}:alpha=1` +
        `[d${inputIndex}];` +
        `${currentLabel}[d${inputIndex}]overlay=x=${xExpr}:y=${yExpr}:enable='${enable}'${next}`,
    );
    currentLabel = next;
    inputIndex += 1;
  }

  // If no overlays, pass through.
  if (filterParts.length === 0) {
    return {
      extraInputs: [],
      filterChain: `${currentLabel}null[out]`,
    };
  }

  // Rename the final label to `[out]` for the caller's `-map` line.
  const finalRename = filterParts.pop()!.replace(currentLabel, currentLabel);
  filterParts.push(finalRename.replace(/\[v\d+\]$/, "[out]"));

  return {
    extraInputs,
    filterChain: filterParts.join(";"),
  };
}
