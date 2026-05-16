# Architecture decisions

Locked 2026-05-16. Update when revisiting; don't silently
override.

## 1. Name — `demoreel`

`demoreel` is unregistered on npm (verified 2026-05-16,
registry returns 404). Matches the brief's working name
and the README hero asset framing ("DemoReel demoing
itself").

Alternatives considered (`demotape`, `showreel`,
`screenplay`, `take`) — all taken on npm. `demoreel-cli`,
`demoreel-mcp`, `demoroll`, `directorscut` are free
fallbacks if we ever need to namespace the binary.

## 2. Package structure — single package, two entrypoints

Single `demoreel` npm package. `bin.demoreel` is the
CLI; the MCP server runs via `demoreel --mcp` from the
same binary.

Brief's own guidance: "Single package is simpler for
MVP." Splitting into core / CLI / MCP would triple the
publish overhead with no compiler-time benefit at this
size.

When this grows past ~3000 lines of source, revisit:
extracting `@demoreel/core` may be worth the npm churn
once the lib API has more than one consumer.

## 3. Dialogue box rendering — transparent PNGs (MVP)

MVP renders dialogue boxes as static transparent PNGs
composited via FFmpeg `overlay`. Playwright screenshots
an HTML template into PNG; PNG drops onto the timeline
as a layer.

v2 swaps to per-dialogue transparent WebM clips for
animated reveal (typewriter, slide-up, fade). The
compositor signature stays the same — `overlay({path,
start, duration, x, y})` works for both image and video
inputs in FFmpeg's `overlay` filter.

Avoiding now: the WebM-with-alpha rabbit hole. We
already debugged the
`pix_fmt=yuv420p`-vs-`ALPHA_MODE=1` distinction on the
Greenroom side (2026-05-16); not paying that tax twice
for v1.

## 4. Zoom implementation — FFmpeg post-process

Zooms are applied as `crop` + `scale` in the FFmpeg
post-processor, keyframed against the trace.json
timestamps the recorder emits.

The brief's architecture diagram shows
``trace.json → post-processor calculates zoom
keyframes`` — going with that. The brief's
recommendation paragraph at the bottom suggested CSS
zoom during recording for MVP, but CSS-during-recording
bakes the zoom into raw.webm: a wrong zoom = re-record
the whole demo.

Post-process zoom keeps `raw.webm` pristine. You can
re-render the final MP4 with different zoom levels from
the same raw recording. Same math either way; just
moving it to where it composes cleanly.

## 5. License — MIT

Brief specifies MIT in the build instructions and the
"maximum adoption" framing in the marketing plan. MIT
removes friction for downstream packagers (Homebrew,
Linux distros, internal forks at companies). Apache-2.0
patent grant matters for projects expecting patent
disputes; for a recorder tool, that's vanishingly
unlikely to apply.

---

# Out of scope decisions

These were considered and explicitly NOT chosen:

- **Monorepo with separate `@demoreel/*` packages.** See #2.
- **CSS zoom during recording.** See #4.
- **Bun runtime.** Playwright doesn't officially
  support Bun yet (2026-05). Node 20+ is the safe pin.
- **Built-in TTS in MVP.** Deferred per brief.
- **Cursor highlight overlay in MVP.** Trace.json
  emits mouse positions, but we don't render the
  overlay until v2 (one more FFmpeg layer, not load-bearing
  for the marketing-flywheel value prop).
- **Animated intro/outro card templates in MVP.** Same
  reason — static cards work, animation is polish.
