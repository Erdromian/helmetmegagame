// Every screen with a golden, and who is looking at it. One test per screen
// so a failure names the page, and the run order is the list order —
// `next dev` compiles a route the first time it is asked for, so the
// player routes go first while the desk warms up behind them.
//
// Keep this list SHORT. A golden costs a re-baseline every time the screen
// is meant to change, and this app restyles often; fifteen or twenty screens
// that between them touch every shared component is the right size. A new
// screen belongs here when it has a shape nothing else on the list has.
//
// Determinism, and where each piece of it lives:
//   - Date is frozen at FROZEN_NOW in every page before it loads, so the top
//     bar's clock, the lock countdown and every "3 minutes ago" hold still.
//   - The world is the fixed one seed.mjs writes; nothing in it is random.
//   - The speaker is switched on in every page before it loads. With nothing
//     saved, soundStore.js starts it OFF under `next dev` (which is what
//     serves these shots) and ON everywhere else; the goldens show what a
//     player sees, so they pin the saved setting rather than the default.
//   - Fonts are awaited before the shot; motion is off in the config.
//   - toHaveScreenshot itself takes two shots and waits for them to match,
//     which is what absorbs hydration landing a beat after load.

import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mintCookie, resolveTarget } from "../session.mjs";
import { CHARACTERS, FROZEN_NOW } from "./fixtures.mjs";

const require = createRequire(import.meta.url);

const MOBILE = { width: 390, height: 844 };

// as: "public" (no cookie) | "gm" | a key of CHARACTERS.
// path: a string, or a function of the fixture ids for a URL only the
// database knows.
const SCREENS = [
  // The front door. (/handbook would be the other public screen, but it is
  // switched off in web/lib/handbook.js for now and answers 404.)
  { name: "signin", as: "public", path: "/" },

  { name: "character-full", as: "full", path: "/character" },
  { name: "character-bare", as: "bare", path: "/character" },
  { name: "character-dead", as: "dead", path: "/character" },
  // The travel rail fetches after hydration and says "Reading the road…"
  // until it lands; a shot taken before that is a golden of a spinner.
  { name: "chat", as: "full", path: "/chat", gone: "Reading the road" },
  { name: "chat-ghost", as: "dead", path: "/chat", gone: "Reading the road" },
  { name: "map", as: "full", path: "/map" },
  { name: "documents", as: "full", path: "/documents" },
  { name: "memories", as: "full", path: "/memories" },

  { name: "character-full-mobile", as: "full", path: "/character", viewport: MOBILE },
  { name: "chat-mobile", as: "full", path: "/chat", viewport: MOBILE, gone: "Reading the road" },
  { name: "map-mobile", as: "full", path: "/map", viewport: MOBILE },

  { name: "gm-players", as: "gm", path: "/gm/players" },
  { name: "gm-turns", as: "gm", path: "/gm/turns" },
  { name: "gm-audit", as: "gm", path: "/gm/audit" },
  { name: "gm-structures", as: "gm", path: "/gm/structures" },
  { name: "gm-dev", as: "gm", path: "/gm/dev" },
  { name: "gm-dev-characters", as: "gm", path: "/gm/dev?s=characters" },
  { name: "gm-dev-character", as: "gm", path: (ids) => `/gm/dev/characters/${ids.full}` },
  { name: "gm-dev-zones", as: "gm", path: "/gm/dev?s=zones" },
  { name: "lifeweb", as: "gm", path: "/lifeweb" },
];

const cookies = {}; // persona -> "name=value"
const ids = {}; // fixture key -> Character.id

test.beforeAll(async () => {
  const { prisma } = require("@lifeweb/db");
  try {
    for (const [key, spec] of Object.entries(CHARACTERS)) {
      const row = await prisma.character.findFirst({
        where: { discordUserId: spec.discordUserId },
        select: { id: true },
      });
      if (!row) throw new Error(`No "${key}" fixture in the database — run npm run dev:visual:setup first.`);
      ids[key] = row.id;
      cookies[key] = await mintCookie(spec.discordUserId);
    }
  } finally {
    await prisma.$disconnect();
  }
  cookies.gm = await mintCookie((await resolveTarget(["--gm"])).discordUserId);
});

async function open(browser, screen) {
  const context = await browser.newContext(screen.viewport ? { viewport: screen.viewport } : {});
  if (screen.as !== "public") {
    const [name, ...rest] = cookies[screen.as].split("=");
    await context.addCookies([{ name, value: rest.join("="), domain: "localhost", path: "/" }]);
  }
  // `sfx|music|volume`, the shape soundStore.js reads: speaker on, music on, full.
  await context.addInitScript(() => window.localStorage.setItem("bascinet:sound", "1|1|1"));
  const page = await context.newPage();
  await page.clock.setFixedTime(FROZEN_NOW);
  return { context, page };
}

for (const screen of SCREENS) {
  test(screen.name, async ({ browser }) => {
    const { context, page } = await open(browser, screen);
    try {
      const path = typeof screen.path === "function" ? screen.path(ids) : screen.path;
      // "load", not "networkidle": /chat holds an event stream open for as
      // long as the page lives, and networkidle would wait on it forever.
      const response = await page.goto(path, { waitUntil: "load", timeout: 150_000 });

      // A gate that shut answers with a redirect, not an error; a golden of
      // the landing page would pass forever and prove nothing.
      const landed = new URL(page.url()).pathname;
      const wanted = new URL(path, "http://localhost").pathname;
      expect(landed, `${path} redirected to ${landed}`).toBe(wanted);
      expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(400);

      await page.evaluate(() => document.fonts.ready);
      if (screen.gone) await expect(page.getByText(screen.gone)).toHaveCount(0);
      // A beat for hydration. toHaveScreenshot's own stability loop would
      // absorb it, but its caret-hiding style lands on inputs as inline
      // style, and React logs a hydration mismatch for every one it finds
      // there before it has mounted. One second is past that on a dev build.
      await page.waitForTimeout(1_000);
      await expect(page).toHaveScreenshot(`${screen.name}.png`);
    } finally {
      await context.close();
    }
  });
}
