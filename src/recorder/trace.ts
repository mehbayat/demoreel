/**
 * Trace.json writer. The recorder emits an entry per scene
 * boundary with timestamps + (where relevant) selector bounding
 * boxes + mouse positions. The post-processor reads this file
 * to compute zoom keyframes, overlay timing, and (v2) cursor
 * overlay positions.
 */

import { writeFileSync } from "node:fs";

export interface SceneTraceEntry {
  /** Scene name from the demo config. */
  name: string;
  /** Action kind, or `null` for overlay-only scenes. */
  action: string | null;
  /** Milliseconds from recording start when this scene began. */
  start_ms: number;
  /** Milliseconds from recording start when this scene ended. */
  end_ms: number;
  /** Bounding box of the zoom selector in viewport coords, if any. */
  zoom_bbox?: { x: number; y: number; width: number; height: number };
  /** Mouse trail captured during this scene. */
  mouse?: Array<{ t_ms: number; x: number; y: number }>;
}

export interface Trace {
  schema_version: 1;
  /** Viewport size at record time — needed for zoom math. */
  viewport: { width: number; height: number };
  /** Total recording duration in ms. */
  duration_ms: number;
  scenes: SceneTraceEntry[];
}

export class TraceBuilder {
  private startedAt: number | null = null;
  private current: Partial<SceneTraceEntry> & { name: string; mouse: SceneTraceEntry["mouse"] } | null = null;
  private scenes: SceneTraceEntry[] = [];

  constructor(private readonly viewport: { width: number; height: number }) {}

  start(): void {
    this.startedAt = performance.now();
  }

  /** Begin a new scene. Closes the previous one if open. */
  beginScene(name: string, action: string | null): void {
    if (this.startedAt === null) {
      throw new Error("TraceBuilder.start() must be called before beginScene()");
    }
    this.endScene();
    const now = performance.now();
    this.current = {
      name,
      action,
      start_ms: Math.round(now - this.startedAt),
      mouse: [],
    };
  }

  /** Close the active scene. No-op if none. */
  endScene(): void {
    if (!this.current || this.startedAt === null) return;
    const now = performance.now();
    const entry: SceneTraceEntry = {
      name: this.current.name,
      action: this.current.action ?? null,
      start_ms: this.current.start_ms ?? 0,
      end_ms: Math.round(now - this.startedAt),
      ...(this.current.zoom_bbox ? { zoom_bbox: this.current.zoom_bbox } : {}),
      ...(this.current.mouse && this.current.mouse.length > 0
        ? { mouse: this.current.mouse }
        : {}),
    };
    this.scenes.push(entry);
    this.current = null;
  }

  setZoomBBox(bbox: { x: number; y: number; width: number; height: number }): void {
    if (this.current) this.current.zoom_bbox = bbox;
  }

  /** Record a mouse position sample. */
  pushMouse(x: number, y: number): void {
    if (!this.current || this.startedAt === null) return;
    const t_ms = Math.round(performance.now() - this.startedAt);
    this.current.mouse?.push({ t_ms, x, y });
  }

  finalize(): Trace {
    this.endScene();
    if (this.startedAt === null) {
      throw new Error("TraceBuilder.start() must be called before finalize()");
    }
    return {
      schema_version: 1,
      viewport: this.viewport,
      duration_ms: Math.round(performance.now() - this.startedAt),
      scenes: this.scenes,
    };
  }

  writeTo(path: string): Trace {
    const trace = this.finalize();
    writeFileSync(path, JSON.stringify(trace, null, 2), "utf8");
    return trace;
  }
}
