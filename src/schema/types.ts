/**
 * Strongly-typed shape of a parsed ``.demo.yaml`` file.
 *
 * These types mirror the JSON schema in ``./schema.ts`` exactly.
 * Whenever you add a field to either, add it to both — the
 * validator at ``./parser.ts`` checks against the JSON schema
 * AND the TypeScript types are the only thing keeping the rest
 * of the codebase honest about what's actually present after
 * parse.
 */

/** Output resolution as `WIDTHxHEIGHT`. */
export type Resolution = `${number}x${number}`;

/** Duration literal accepted in YAML: `"2s"`, `"500ms"`, `"1.5s"`. */
export type DurationLiteral = `${number}${"s" | "ms"}`;

/** Per-keystroke delay for typed text. `0` or `"0ms"` = instant. */
export type TypingSpeed = DurationLiteral | 0;

export type ActionKind =
  | "goto"
  | "click"
  | "type"
  | "scroll"
  | "wait_for"
  | "pause"
  | "screenshot";

export type OverlayAnimation = "fade-in" | "fade-out" | "slide-up" | "typewriter";

/**
 * Intro / outro card spec. Each card renders as a static MP4
 * segment prepended (intro) or appended (outro) to the main
 * recording. Renderer = Playwright HTML → PNG → ffmpeg loop into
 * an MP4 of ``duration_sec``. Same path for both kinds.
 */
export interface IntroOutroCard {
  /** Main headline copy. */
  title: string;
  /** Optional subtitle / tagline drawn below the title. */
  subtitle?: string;
  /** Optional logo image (PNG/SVG path, relative to the demo file). */
  logo?: string;
  /** Background color (CSS hex). Default: #0a0a0a. */
  background?: string;
  /** Text color. Default: #ffffff. */
  text_color?: string;
  /** Accent color for the optional CTA pill. Default: project brand. */
  accent_color?: string;
  /** Optional CTA pill rendered below the subtitle. */
  cta?: { text: string; url?: string };
  /** Duration in seconds. Default: 3s. */
  duration_sec?: number;
}

export interface DemoMeta {
  /** Human title surfaced in dialogue + outro cards. */
  title: string;
  /** Final MP4 resolution. Defaults to 1920x1080. */
  resolution?: Resolution;
  /** Final MP4 frame rate. Defaults to 30. */
  fps?: number;
  /** Output path for the final MP4, relative to the demo file. */
  output?: string;
  /** Optional brand color (CSS), used by default overlay templates. */
  brand_color?: string;
  /** Intro card prepended before the recording. */
  intro?: IntroOutroCard;
  /** Outro card appended after the recording. */
  outro?: IntroOutroCard;
}

export interface Overlay {
  /** Path to an image (PNG/SVG) drawn in the corner. */
  logo?: string;
  /** One-line text drawn in the dialogue box layer. */
  dialogue?: string;
  /** Animation for the overlay's entrance. */
  animation?: OverlayAnimation;
  /** Optional call-to-action shown at the end of an outro scene. */
  cta?: {
    text: string;
    url?: string;
  };
}

export interface ZoomSpec {
  /** Selector to focus the zoom on. Mutually exclusive with `region`. */
  selector?: string;
  /** Manual zoom region in viewport coords. */
  region?: { x: number; y: number; width: number; height: number };
  /** Magnification factor — `1.5x` or numeric `1.5`. */
  level: `${number}x` | number;
  /** CSS-easing-style transition (e.g. `ease-in-out 0.5s`). */
  transition?: string;
}

/**
 * One scene of the demo. Each scene corresponds to ONE timeline
 * block in the final MP4. The presence of ``action`` makes it an
 * action-bearing scene (recorded via Playwright); the absence
 * makes it an overlay-only scene (no browser activity, just a
 * card on the timeline).
 */
export interface Scene {
  /** Short identifier surfaced in logs + trace.json. */
  name: string;

  /** Browser action to perform. Omit for an overlay-only scene. */
  action?: ActionKind;

  // Action-specific fields. Validation rules:
  //   - goto:        ``url`` required, optional ``wait_for``
  //   - click:       ``selector`` required, optional ``wait_for``
  //   - type:        ``selector`` + ``text`` required, optional ``speed``
  //   - scroll:      either ``selector`` OR ``to`` required
  //   - wait_for:    ``selector`` or ``url`` required, optional ``timeout``
  //   - pause:       ``duration`` required
  //   - screenshot:  ``path`` required, optional ``selector``
  url?: string;
  selector?: string;
  text?: string;
  speed?: TypingSpeed;
  to?: { x?: number; y?: number };
  wait_for?: string;
  timeout?: DurationLiteral;
  duration?: DurationLiteral;
  pause_after?: DurationLiteral;
  highlight_cursor?: boolean;
  path?: string;

  /** Overlay layer composited on top of this scene. */
  overlay?: Overlay;

  /** Zoom region to apply during this scene. */
  zoom?: ZoomSpec;
}

/** Optional auth block: cookies to inject before recording. */
export interface Auth {
  /** Cookies as `name=value` strings or full Playwright Cookie objects. */
  cookies?: Array<
    | string
    | {
        name: string;
        value: string;
        domain?: string;
        path?: string;
      }
  >;
  /**
   * Optional pre-recording login script. When set, runs BEFORE the
   * recording starts so the login flow isn't captured in the
   * video.
   */
  login?: Pick<Scene, "action" | "url" | "selector" | "text" | "wait_for">[];
}

/** Top-level shape of a `.demo.yaml` file. */
export interface DemoConfig {
  meta: DemoMeta;
  scenes: Scene[];
  auth?: Auth;
}
