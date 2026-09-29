// The visual goldens: a real browser opens the signed-in app against a
// database built for nothing else, and every screen is compared to the PNG
// checked in under scripts/dev/visual/goldens/<platform>/. A diff fails the
// run and writes the three images (expected, actual, diff) into test-results/.
//
//   npm run dev:visual:setup                   # once: the world + fixtures
//   npm run dev:visual                         # compare
//   npm run dev:visual -- -g " map$" --update-snapshots   # meant it: re-baseline one
//
// Everything that made the old snapshotter (scripts/dev/snapshot-site.mjs)
// drift is pinned here: its own Chromium rather than whatever Chrome is on
// the machine, one viewport, one timezone, one locale, motion off, and a
// frozen Date in the page (scripts/dev/visual/pages.spec.mjs) so the clock
// in the top bar and every "3 minutes ago" stop moving.
//
// The dev server is started here too, on its own port, pointed at the visual
// database with LOCAL_MODE forced on — so a checkout holding a real bot token
// still never asks Discord anything during a run. See LOCAL-DEV.md §5.
import { defineConfig } from "@playwright/test";
import { VISUAL_DATABASE_URL } from "./scripts/dev/visual/fixtures.mjs";

export const PORT = process.env.VISUAL_PORT ?? "3111";
export const BASE = `http://localhost:${PORT}`;

// The spec opens Prisma to look fixture ids up; it must open THIS database,
// whatever the shell exported.
process.env.DATABASE_URL = VISUAL_DATABASE_URL;

export default defineConfig({
  testDir: "scripts/dev/visual",
  testMatch: /.*\.spec\.mjs$/,
  outputDir: "test-results/visual",
  // One set per platform (darwin, win32), because each draws fonts a hair
  // differently and line heights round to a different pixel: the macOS set
  // failed 5 of 21 screens on Windows with nothing actually wrong. A platform
  // with no folder yet (Linux) gets one written on its first run.
  snapshotPathTemplate: "{testDir}/goldens/{platform}/{arg}{ext}",

  // `next dev` compiles each route on first request; parallel workers only
  // starve it, and the first load of a desk page can take most of a minute.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,

  expect: {
    timeout: 30_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Hides what the page shows that is not the page (Next's dev badge).
      stylePath: "scripts/dev/visual/screenshot.css",
      // A hair of antialiasing noise is not a regression. Anything a person
      // would notice is far above this.
      maxDiffPixelRatio: 0.002,
    },
  },

  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results/visual-report" }]],

  use: {
    baseURL: BASE,
    locale: "en-US",
    timezoneId: "America/Chicago", // the game's one clock (db/lib/turnClock.js)
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    viewport: { width: 1440, height: 900 },
    // A failure keeps its trace so the diff can be read alongside what the
    // page was doing; a pass keeps nothing.
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },

  webServer: {
    command: `npm run dev --workspace=web -- --port ${PORT}`,
    // The front door, signed out.
    url: `${BASE}/`,
    reuseExistingServer: true,
    timeout: 240_000,
    // VISUAL_VERBOSE=1 shows next's own compile log when the server will not come up.
    stdout: process.env.VISUAL_VERBOSE ? "pipe" : "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: VISUAL_DATABASE_URL,
      // Its own build folder (web/next.config.mjs), so it starts beside a
      // `dev:web` already running in this checkout. Sharing .next, next dev
      // refuses a second server on the same folder, and with stdout ignored
      // below all that surfaced was "exited early".
      NEXT_DIST_DIR: ".next-visual",
      // Forced, not inherited: web/.env.local may hold a real token, and a
      // golden that depended on the live guild's roles would drift with it.
      LOCAL_MODE: "true",
      DISCORD_TOKEN: "local",
      DISCORD_GUILD_ID: "local",
    },
  },
});
