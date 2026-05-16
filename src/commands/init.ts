/**
 * `demoreel init` — scaffold a demo script + assets folder in
 * the target directory.
 *
 * MVP behavior:
 *   - Writes `demo.yaml` if missing (refuses to overwrite).
 *   - Creates `assets/` next to it.
 *   - Prints a one-liner with the suggested next command.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { log } from "../util/log.js";

export interface InitOptions {
  /** Directory to initialise. Defaults to cwd. */
  cwd?: string;
  /** Force overwrite if `demo.yaml` exists. */
  force?: boolean;
}

const STARTER_DEMO_YAML = `# DemoReel script — created by \`demoreel init\`.
# Run with: npx demoreel record demo.yaml
#
# Reference: https://github.com/mehbayat/demoreel
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
`;

export function runInit(options: InitOptions = {}): void {
  const cwd = resolve(options.cwd ?? process.cwd());
  const target = join(cwd, "demo.yaml");
  const assetsDir = join(cwd, "assets");

  if (existsSync(target) && !options.force) {
    throw new Error(
      `Refusing to overwrite ${target}. Re-run with --force to overwrite.`,
    );
  }

  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(target, STARTER_DEMO_YAML, "utf8");

  // Copy any starter assets bundled in the package.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // dist/commands → up two to package root → templates/init/assets.
  const bundledAssets = resolve(moduleDir, "..", "..", "templates", "init", "assets");
  if (existsSync(bundledAssets)) {
    for (const name of readdirSync(bundledAssets)) {
      copyFileSync(join(bundledAssets, name), join(assetsDir, name));
    }
  }

  log.info("init.done", { demo: target, assets: assetsDir });
  process.stdout.write(
    `\nCreated ${target}\nNext: npx demoreel record ${target}\n\n`,
  );
}
