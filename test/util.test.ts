import { describe, expect, it } from "vitest";

import {
  parseDurationToMs,
  parseResolution,
  parseZoomLevel,
} from "../src/util/paths.js";
import { buildZoomKeyframes, keyframesToFFmpegFilter } from "../src/post/zoom.js";
import type { Trace } from "../src/recorder/trace.js";
import type { Scene } from "../src/schema/types.js";

describe("paths utils", () => {
  it("parses second/ms durations", () => {
    expect(parseDurationToMs("2s")).toBe(2000);
    expect(parseDurationToMs("500ms")).toBe(500);
    expect(parseDurationToMs("1.5s")).toBe(1500);
    expect(parseDurationToMs(0)).toBe(0);
  });

  it("throws on bad duration literal", () => {
    expect(() => parseDurationToMs("two seconds")).toThrow();
  });

  it("parses WIDTHxHEIGHT resolutions", () => {
    expect(parseResolution("1920x1080")).toEqual({ width: 1920, height: 1080 });
    expect(parseResolution("720x720")).toEqual({ width: 720, height: 720 });
    expect(() => parseResolution("HD")).toThrow();
  });

  it("parses zoom levels (Nx and numeric)", () => {
    expect(parseZoomLevel("1.5x")).toBe(1.5);
    expect(parseZoomLevel(2)).toBe(2);
    expect(() => parseZoomLevel("invalid")).toThrow();
  });
});

describe("buildZoomKeyframes", () => {
  const viewport = { width: 1920, height: 1080 };

  it("emits a single fullscreen keyframe when no scene declares zoom", () => {
    const scenes: Scene[] = [
      { name: "intro", action: "goto", url: "https://x" },
      { name: "outro", action: "pause", duration: "1s" },
    ];
    const trace: Trace = {
      schema_version: 1,
      viewport,
      duration_ms: 2000,
      scenes: [
        { name: "intro", action: "goto", start_ms: 0, end_ms: 1000 },
        { name: "outro", action: "pause", start_ms: 1000, end_ms: 2000 },
      ],
    };
    const kf = buildZoomKeyframes(scenes, trace);
    expect(kf).toHaveLength(1);
    expect(kf[0]?.crop).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("inserts a zoom keyframe at the scene's start time", () => {
    const scenes: Scene[] = [
      { name: "intro", action: "goto", url: "https://x" },
      {
        name: "zoom-in",
        action: "pause",
        duration: "2s",
        zoom: { selector: ".x", level: "2x" },
      },
    ];
    const trace: Trace = {
      schema_version: 1,
      viewport,
      duration_ms: 3000,
      scenes: [
        { name: "intro", action: "goto", start_ms: 0, end_ms: 1000 },
        {
          name: "zoom-in",
          action: "pause",
          start_ms: 1000,
          end_ms: 3000,
          zoom_bbox: { x: 800, y: 400, width: 200, height: 200 },
        },
      ],
    };
    const kf = buildZoomKeyframes(scenes, trace);
    expect(kf.length).toBeGreaterThanOrEqual(2);
    const zoomKf = kf.find((k) => k.t === 1);
    expect(zoomKf).toBeDefined();
    expect(zoomKf?.crop.width).toBe(960); // 1920 / 2
    expect(zoomKf?.crop.height).toBe(540); // 1080 / 2
  });
});

describe("keyframesToFFmpegFilter", () => {
  it("returns plain scale when no keyframes", () => {
    expect(keyframesToFFmpegFilter([], 1920, 1080)).toBe("scale=1920:1080");
  });

  it("returns a static crop+scale for one keyframe", () => {
    const filter = keyframesToFFmpegFilter(
      [{ t: 0, crop: { x: 100, y: 50, width: 1280, height: 720 } }],
      1920,
      1080,
    );
    expect(filter).toContain("crop=1280:720:100:50");
    expect(filter).toContain("scale=1920:1080");
  });

  it("builds a piecewise expression for multiple keyframes", () => {
    const filter = keyframesToFFmpegFilter(
      [
        { t: 0, crop: { x: 0, y: 0, width: 1920, height: 1080 } },
        { t: 2, crop: { x: 480, y: 270, width: 960, height: 540 } },
      ],
      1920,
      1080,
    );
    expect(filter).toContain("if(lt(t,2)");
  });
});
