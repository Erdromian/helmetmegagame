// A public share of one economy-report page (web/lib/economyShareHtml.js, ECONOMY.md §7a): the nav to the
// rest of the report comes out, and the page's CSS and script go inline so the share is one response.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "..", "web", "lib", "economyShareHtml.js")).href);
const reportSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "analysis", "economy", "report.js"), "utf8");

// The same shape report.js's page() writes.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>What a turn is worth — Bascinet economy</title><link rel="stylesheet" href="report.css"></head><body>
<div class="report-shell">
<nav class="report-nav"><a href="index.html" class="report-brand">Bascinet economy</a><a href="secrets.html">Secret recipes</a></nav>
<main>
<section><h2>What a turn is worth</h2></section>
</main>
</div>
<script src="report-client.js"></script></body></html>`;

test("report.js still writes the three pieces the share rewrites", () => {
  // If one of these moves, the share quietly keeps the nav or loses its styling. The nav is the one that
  // matters: it lists every other page, Secret recipes included.
  assert.ok(reportSource.includes('<nav class="report-nav">'));
  assert.ok(reportSource.includes('<link rel="stylesheet" href="report.css">'));
  assert.ok(reportSource.includes('<script src="report-client.js"></script>'));
});

test("the nav to the rest of the report comes out", async () => {
  const { sharedPageHtml } = await load();
  const out = sharedPageHtml(PAGE, { css: "body{}", js: "1" });
  assert.ok(!out.includes("report-nav"));
  assert.ok(!out.includes("secrets.html"));
  assert.ok(out.includes("<h2>What a turn is worth</h2>"));
});

test("the CSS and script go inline, unmangled, and the page asks not to be indexed", async () => {
  const { sharedPageHtml } = await load();
  // `$&` and `$'` are what a replacement STRING would have expanded.
  const css = "a::after{content:'$&'}";
  const js = "const x = `$'`; if (a</script>b) {}";
  const out = sharedPageHtml(PAGE, { css, js });
  assert.ok(out.includes(`<style>${css}</style>`));
  assert.ok(out.includes("<script>const x = `$'`; if (a<\\/script>b) {}</script>"));
  assert.ok(!out.includes('href="report.css"'));
  assert.ok(!out.includes('src="report-client.js"'));
  assert.ok(out.includes('<meta name="robots" content="noindex, nofollow">'));
});

test("a page's title comes off its <title>, without the report's suffix", async () => {
  const { reportPageTitle } = await load();
  assert.equal(reportPageTitle(PAGE), "What a turn is worth");
  assert.equal(reportPageTitle("<title>The ⬢ market &amp; more — Bascinet economy</title>"), "The ⬢ market & more");
  assert.equal(reportPageTitle(""), null);
  assert.equal(reportPageTitle(undefined), null);
});
