# demoreel

Scriptable browser demo recorder with cinematic post-production. CLI + MCP server.

`demoreel` reads a `.demo.yaml` script, drives a real Chromium browser through the steps, and produces a polished MP4 with zooms, dialogue boxes, and branded overlays — without Loom, iMovie, or hand editing.

Think VHS-for-the-browser. Product Hunt demos, README hero videos, investor walkthroughs, changelog demos. Reproducible. Version-controlled. PR-able.

## Why

- **Reproducible demos.** Re-run the same script after a UI change; the video updates.
- **Version control.** Your demo script lives in the repo. Diff it. Review it. Roll it back.
- **Agent-native.** Built-in MCP server — Claude Code, Cursor, and Codex can record a demo via tool call.

## Install

```bash
npx demoreel init        # scaffold demo.yaml + assets/
npx demoreel record demo.yaml
```

Requires Node 20+ and `ffmpeg` on PATH. Playwright auto-installs Chromium on first run.

## Quick start

```yaml
# demo.yaml
meta:
  title: "My first demo"
  resolution: 1920x1080
  fps: 30
  output: demo.mp4

scenes:
  - name: intro
    overlay:
      dialogue: "Let me show you how this works."

  - name: open-app
    action: goto
    url: "https://example.com"
    wait_for: "h1"
    pause_after: 1s

  - name: zoom-headline
    action: pause
    duration: 2s
    zoom:
      selector: "h1"
      level: 1.4x
    overlay:
      dialogue: "The headline is the first thing your users see."

  - name: outro
    overlay:
      dialogue: "Thanks for watching."
      cta:
        text: "Get started →"
        url: "https://example.com"
```

```bash
npx demoreel preview demo.yaml   # validate + print the plan
npx demoreel record demo.yaml    # record + render the MP4
```

## Actions

| Action | Required | Optional |
|---|---|---|
| `goto` | `url` | `wait_for` |
| `click` | `selector` | `wait_for` |
| `type` | `selector`, `text` | `speed` (default 80ms/keystroke) |
| `scroll` | `selector` OR `to: {x, y}` | — |
| `wait_for` | `selector` OR `url` | `timeout` |
| `pause` | `duration` | — |
| `screenshot` | `path` | `selector` |

Every scene supports `overlay` (dialogue / CTA / logo) and `zoom` (selector or region, with magnification level).

`npx demoreel actions` prints this list at any time.

## CLI

```
demoreel init [--force]              scaffold a starter demo.yaml + assets/
demoreel record <file> [--headed]    record + render an MP4
demoreel preview <file>              dry-run — validate + print the plan
demoreel actions                     list available action types
demoreel --mcp                       boot MCP stdio server
```

## MCP server

Wire DemoReel into Claude Code, Cursor, or any MCP-compatible client:

```jsonc
// ~/.claude/mcp.json (or equivalent)
{
  "mcpServers": {
    "demoreel": {
      "command": "npx",
      "args": ["-y", "demoreel", "--mcp"]
    }
  }
}
```

Tools exposed:

- `record_demo` — full pipeline (record + render).
- `preview_script` — dry-run, returns the action plan.
- `list_actions` — list available action types.
- `render_overlay` — post-process-only; re-render from an existing `raw.webm` + `trace.json` without re-recording.

## How it works

```
.demo.yaml
   ↓
parser + JSON schema (helpful errors with field paths)
   ↓
recorder: Playwright Chromium → raw.webm + trace.json
   ↓
post-processor: FFmpeg pipeline
   ├─ render dialogue PNGs (Playwright HTML → transparent PNG)
   ├─ build zoom keyframe expression from trace.json
   ├─ overlay logo + per-scene dialogues with fade in/out
   └─ encode H.264 + faststart → demo.mp4
```

`trace.json` is the bridge between recording and post — scene timestamps + (where applicable) selector bounding boxes flow from the recorder to the keyframe builder. This lets you re-render with new overlays without re-recording the browser session (`render_overlay` MCP tool / `demoreel render-overlay` for v1.1).

## Library API

```ts
import { parseDemoFile, runRecord } from "demoreel";

const config = parseDemoFile("./demo.yaml");  // typed DemoConfig
const result = await runRecord({ demoPath: "./demo.yaml" });
console.log(result.outputPath);  // path to the rendered MP4
```

Full surface: `parseDemoFile`, `parseDemoString`, `runInit`, `runPreview`, `runRecord`, `recordSession`, `runPostPipeline`, `runMcpServer`, `demoSchema`, plus the full type set (`DemoConfig`, `Scene`, `Overlay`, `ZoomSpec`, etc.).

## Differentiators

| Tool | What it does | Gap DemoReel fills |
|------|---|---|
| Loom | Manual screen recording | No scripting, no reproducibility, no version control |
| VHS (charmbracelet) | Terminal GIFs | Terminal only — no browser |
| Playwright `recordVideo` | Raw browser capture | No post-production layer |
| Remotion | Programmatic video from React | Not a recorder; generates from code |
| OBS | Manual recording | No automation, no scripting |

DemoReel = **scriptable browser recording + automatic cinematic post-production.**

## Status

v0.1.0 — MVP. Stable enough to use; the API surface may still shift before v1.0.

What's in: parser, Playwright recorder (`goto` / `click` / `type` / `scroll` / `wait_for` / `pause` / `screenshot`), FFmpeg post-process (keyframe zoom + logo + dialogue PNGs), CLI, MCP server.

What's deferred to v0.2: animated dialogue boxes (typewriter / slide-up), cursor highlight overlay, TTS narration, intro/outro card templates, GitHub Action (`demoreel/action@v1`), auth cookie injection, mobile device emulation, SSE MCP transport.

## License

MIT. See [LICENSE](./LICENSE).

## Credits

Built by [@mehbayat](https://github.com/mehbayat). Sponsored by [Greenroom](https://greenroomai.app) — AI-native video editor; if you want videos *generated* rather than *recorded*, check it out.
