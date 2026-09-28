// Turns one page of the built economy report into the page a public share link serves
// (web/app/share/economy/[token]/route.js, ECONOMY.md §7a). Pure string work, no imports, so
// db/test/economyShareHtml.test.js can load it by path.
//
// Two changes, and only the first matters for what a stranger can read:
//
// - **The nav comes out.** Every page carries report.js's <nav> of links to all its sibling pages,
//   the Secret recipes page among them. Those links would 404 from a share URL anyway — the route
//   serves exactly one page and nothing beside it — so this is about not showing a stranger a menu
//   of doors they cannot open, not the lock itself.
// - **The CSS and the sort script go inline.** The page asks for report.css and report-client.js by
//   relative path, which from /share/economy/<token> would mean two more public routes. Inlining
//   them (about 5 KB together) keeps the share one self-contained response.

const NAV = /<nav class="report-nav">[\s\S]*?<\/nav>/;
const STYLESHEET = /<link rel="stylesheet" href="report\.css">/;
const SCRIPT = /<script src="report-client\.js"><\/script>/;

// Replacer functions rather than replacement strings throughout: a replacement STRING reads `$&`,
// `$'` and friends as patterns, and a stylesheet or a script can contain a `$`.
export function sharedPageHtml(html, { css = "", js = "" } = {}) {
  return html
    .replace(NAV, () => "")
    .replace(STYLESHEET, () => `<meta name="robots" content="noindex, nofollow"><style>${css.replace(/<\/style/gi, "<\\/style")}</style>`)
    .replace(SCRIPT, () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
}

// "What a turn is worth" out of "<title>What a turn is worth — Bascinet economy</title>", or null.
export function reportPageTitle(html) {
  const m = /<title>([\s\S]*?)(?: — Bascinet economy)?<\/title>/.exec(html ?? "");
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
