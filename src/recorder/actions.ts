/**
 * Action handlers. Each Scene's `action` maps to one of these
 * functions; they all share the same (page, scene, ctx) signature
 * so the recorder loop is uniform.
 */

import type { Page } from "playwright";

import type { Scene } from "../schema/types.js";
import { parseDurationToMs } from "../util/paths.js";
import type { TraceBuilder } from "./trace.js";

export interface ActionContext {
  trace: TraceBuilder;
}

/** Run a single scene's action against the Playwright page. */
export async function runSceneAction(
  page: Page,
  scene: Scene,
  ctx: ActionContext,
): Promise<void> {
  switch (scene.action) {
    case undefined:
      // Overlay-only scene — no browser action. Caller still
      // contributes its overlay/dialogue duration to the timeline
      // separately.
      return;
    case "goto":
      await doGoto(page, scene);
      break;
    case "click":
      await doClick(page, scene, ctx);
      break;
    case "type":
      await doType(page, scene, ctx);
      break;
    case "scroll":
      await doScroll(page, scene);
      break;
    case "wait_for":
      await doWaitFor(page, scene);
      break;
    case "pause":
      await doPause(scene);
      break;
    case "screenshot":
      await doScreenshot(page, scene);
      break;
    default: {
      const exhaustive: never = scene.action;
      throw new Error(`unhandled action: ${exhaustive as string}`);
    }
  }

  // After-action pause if specified (lets the camera "breathe" before
  // moving on — important for presentation pacing).
  if (scene.pause_after) {
    await page.waitForTimeout(parseDurationToMs(scene.pause_after));
  }

  // Capture zoom bbox if the scene targets one. The actual zoom is
  // applied post-process; we just record the geometry here.
  if (scene.zoom?.selector) {
    const bbox = await page.locator(scene.zoom.selector).first().boundingBox();
    if (bbox) ctx.trace.setZoomBBox(bbox);
  } else if (scene.zoom?.region) {
    ctx.trace.setZoomBBox(scene.zoom.region);
  }
}

async function doGoto(page: Page, scene: Scene): Promise<void> {
  if (!scene.url) throw new Error(`scene ${scene.name}: goto requires url`);
  await page.goto(scene.url, { waitUntil: "load" });
  if (scene.wait_for) await page.waitForSelector(scene.wait_for);
}

async function doClick(page: Page, scene: Scene, ctx: ActionContext): Promise<void> {
  if (!scene.selector) throw new Error(`scene ${scene.name}: click requires selector`);
  const locator = page.locator(scene.selector).first();
  // 2026-05-16: capture click center as a mouse position so the
  // post-processor can render a cursor-highlight pulse there.
  // Headless Chromium has no system cursor; the "mouse position"
  // = where Playwright's mouse class was acting. boundingBox()
  // before the click is the cheapest correct probe.
  const bbox = await locator.boundingBox();
  if (bbox) {
    ctx.trace.pushMouse(
      Math.round(bbox.x + bbox.width / 2),
      Math.round(bbox.y + bbox.height / 2),
    );
  }
  await locator.click();
  if (scene.wait_for) await page.waitForSelector(scene.wait_for);
}

async function doType(page: Page, scene: Scene, ctx: ActionContext): Promise<void> {
  if (!scene.selector || scene.text === undefined) {
    throw new Error(`scene ${scene.name}: type requires selector + text`);
  }
  const speedMs =
    scene.speed === 0
      ? 0
      : scene.speed !== undefined
        ? parseDurationToMs(scene.speed)
        : 80; // brief default
  const locator = page.locator(scene.selector).first();
  // 2026-05-16: same cursor capture as doClick — the focus click
  // is where the user's eye will track to.
  const bbox = await locator.boundingBox();
  if (bbox) {
    ctx.trace.pushMouse(
      Math.round(bbox.x + bbox.width / 2),
      Math.round(bbox.y + bbox.height / 2),
    );
  }
  await locator.click();
  await locator.fill(""); // clear existing
  // Playwright's `type` accepts a per-keystroke delay; this is the
  // single most-presentation-load-bearing knob in DemoReel.
  await locator.pressSequentially(scene.text, { delay: speedMs });
}

async function doScroll(page: Page, scene: Scene): Promise<void> {
  if (scene.selector) {
    await page.locator(scene.selector).first().scrollIntoViewIfNeeded();
    return;
  }
  const to = scene.to;
  if (!to) {
    throw new Error(`scene ${scene.name}: scroll requires either selector or to`);
  }
  await page.evaluate(
    ({ x, y }: { x?: number; y?: number }) => {
      // Browser context — `window` is in scope inside the page.
      (globalThis as { scrollTo?: (opts: { left: number; top: number; behavior: string }) => void }).scrollTo?.({
        left: x ?? 0,
        top: y ?? 0,
        behavior: "smooth",
      });
    },
    { x: to.x, y: to.y },
  );
}

async function doWaitFor(page: Page, scene: Scene): Promise<void> {
  if (scene.selector) {
    const opts = scene.timeout ? { timeout: parseDurationToMs(scene.timeout) } : {};
    await page.waitForSelector(scene.selector, opts);
    return;
  }
  if (scene.url) {
    const opts = scene.timeout ? { timeout: parseDurationToMs(scene.timeout) } : {};
    await page.waitForURL(scene.url, opts);
    return;
  }
  throw new Error(`scene ${scene.name}: wait_for requires selector or url`);
}

async function doPause(scene: Scene): Promise<void> {
  if (!scene.duration) throw new Error(`scene ${scene.name}: pause requires duration`);
  const ms = parseDurationToMs(scene.duration);
  await new Promise<void>((res) => setTimeout(res, ms));
}

async function doScreenshot(page: Page, scene: Scene): Promise<void> {
  if (!scene.path) throw new Error(`scene ${scene.name}: screenshot requires path`);
  if (scene.selector) {
    await page.locator(scene.selector).first().screenshot({ path: scene.path });
  } else {
    await page.screenshot({ path: scene.path, fullPage: false });
  }
}
