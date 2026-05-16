import { describe, expect, it } from "vitest";

import { DemoParseError, parseDemoString } from "../src/schema/parser.js";

const validMinimal = `
meta:
  title: "Minimal demo"
scenes:
  - name: only-scene
    action: goto
    url: "https://example.com"
`;

const validRich = `
meta:
  title: "Rich demo"
  resolution: 1920x1080
  fps: 30
  output: demo.mp4
  brand_color: "#10b981"
scenes:
  - name: intro
    overlay:
      dialogue: "Welcome"
  - name: nav
    action: goto
    url: "https://example.com"
    wait_for: "#app"
    pause_after: 1s
  - name: zoom
    action: pause
    duration: 2s
    zoom:
      selector: ".card"
      level: 1.5x
      transition: ease-in-out 0.5s
  - name: typing
    action: type
    selector: "#input"
    text: "hello world"
    speed: 80ms
`;

describe("parseDemoString", () => {
  it("accepts a minimal valid script", () => {
    const cfg = parseDemoString(validMinimal);
    expect(cfg.meta.title).toBe("Minimal demo");
    expect(cfg.scenes).toHaveLength(1);
    expect(cfg.scenes[0]?.name).toBe("only-scene");
  });

  it("accepts a rich script with overlays, zooms, and typing", () => {
    const cfg = parseDemoString(validRich);
    expect(cfg.scenes).toHaveLength(4);
    expect(cfg.scenes[2]?.zoom?.level).toBe("1.5x");
    expect(cfg.scenes[3]?.speed).toBe("80ms");
  });

  it("rejects missing required fields", () => {
    const yaml = `
meta:
  title: "Bad"
scenes:
  - name: bad-scene
    action: type
`;
    expect(() => parseDemoString(yaml)).toThrow(DemoParseError);
  });

  it("rejects unknown top-level properties (additionalProperties)", () => {
    const yaml = `
meta:
  title: "Bad"
scenes:
  - name: bad-scene
    action: goto
    url: "https://example.com"
typo_section:
  - x: 1
`;
    expect(() => parseDemoString(yaml)).toThrow(DemoParseError);
  });

  it("rejects an unknown action enum value", () => {
    const yaml = `
meta:
  title: "Bad"
scenes:
  - name: bad-scene
    action: teleport
    url: "https://example.com"
`;
    try {
      parseDemoString(yaml);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DemoParseError);
      const parseErr = err as DemoParseError;
      expect(parseErr.issues.some((i) => i.message.includes("must be one of"))).toBe(true);
    }
  });

  it("rejects an empty scenes array", () => {
    const yaml = `
meta:
  title: "No scenes"
scenes: []
`;
    expect(() => parseDemoString(yaml)).toThrow(DemoParseError);
  });

  it("rejects duplicate scene names (semantic check)", () => {
    const yaml = `
meta:
  title: "Dupe"
scenes:
  - name: same
    action: goto
    url: "https://a.com"
  - name: same
    action: goto
    url: "https://b.com"
`;
    try {
      parseDemoString(yaml);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DemoParseError);
      const parseErr = err as DemoParseError;
      expect(parseErr.issues.some((i) => i.message.toLowerCase().includes("duplicate"))).toBe(true);
    }
  });

  it("rejects a scene with neither action nor overlay", () => {
    const yaml = `
meta:
  title: "Empty scene"
scenes:
  - name: ghost
`;
    try {
      parseDemoString(yaml);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DemoParseError);
      const parseErr = err as DemoParseError;
      expect(
        parseErr.issues.some((i) => i.message.toLowerCase().includes("neither")),
      ).toBe(true);
    }
  });

  it("rejects malformed duration literals", () => {
    const yaml = `
meta:
  title: "Bad duration"
scenes:
  - name: bad-pause
    action: pause
    duration: 2minutes
`;
    expect(() => parseDemoString(yaml)).toThrow(DemoParseError);
  });
});
