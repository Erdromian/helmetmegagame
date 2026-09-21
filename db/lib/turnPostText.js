// The wire shape of a Game-channel post — the turn, the session line and the
// epilogue, as they are written into ArchiveEntry.content and read back by the
// feed (CHAT.md, the Game channel; db/lib/gameChannel.js writes them).
//
// A feed row carries `channelKind` and `content` and nothing else
// (db/lib/archive.js#feedRowShape), so anything structured has to live inside
// the one string. It is TEXT, not JSON, for two reasons: /archive prints
// `content` as prose, and the feed's search is an ILIKE over the same column —
// a JSON blob would be a row that reads as noise in one and matches noise in
// the other. So a post is a short header block of `Key: value` lines, one blank
// line, then a markdown body:
//
//   Turn: 14
//   Day: 7
//   Date: September 27th, 2026
//   Clock: This turn ends at <t:1758999600:t>, or <t:1758999600:R>.
//
//   Whatever the note said.
//
// The `<t:…>` tags are kept on purpose. They render as a live local time in
// each reader's own zone on both faces (web/app/components/remarkDiscord.js), so
// a stored clock never goes stale. Discord's own chrome does NOT come along: the
// `-#` subtext prefix and the `<@&role>` ping are how that channel dresses a
// line, and the block on the web has a byline instead.
//
// ZERO REQUIRES, EVER — the same rule db/lib/decreeText.js keeps, and for the
// same reason: the feed's block renderer is a "use client" file, and one require
// of @lifeweb/db from here would drag PrismaClient into the browser bundle.

// The three kinds, which are also the rows' `channelKind`. One list, so a
// writer and a renderer cannot disagree about the word.
const GAME_POST = { TURN: "turn", SESSION: "session", GAME_END: "gameend" };

// What the game-end block is headed, on both faces of the web. Discord's own
// post says "Game Ended" (db/lib/epilogue.js#formatEpilogue) and keeps saying
// it; this is the web's title and lives here so the block and any future reader
// share the one string.
const GAME_END_TITLE = "The game is over";

// A header value is one line. A newline inside one would become the body's
// first paragraph when the row is read back, which is how a field silently eats
// a sentence.
function oneLine(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

// `{ Key: value }` plus a body, in the shape above. A field with no value is
// left out entirely rather than written empty — an absent clock and a blank one
// are different things to the renderer.
function composeGamePost(fields, body) {
  const head = Object.entries(fields ?? {})
    .map(([key, value]) => [key, oneLine(value)])
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}: ${value}`);
  const text = String(body ?? "").trim();
  if (head.length === 0) return text;
  return text ? `${head.join("\n")}\n\n${text}` : head.join("\n");
}

// The inverse: `{ fields, body }`, with the keys lowercased so a reader never
// has to match capitalisation. Lines are taken until the first blank one, and
// anything before that blank line WITHOUT a `Key:` in front of it ends the
// header there and starts the body — so a row hand-written as plain prose comes
// back as a body with no fields rather than as nothing at all.
function parseGamePost(content) {
  const lines = String(content ?? "").split("\n");
  const fields = {};
  let at = 0;
  for (; at < lines.length; at += 1) {
    const line = lines[at];
    if (line.trim() === "") break;
    const cut = line.indexOf(":");
    if (cut <= 0) break;
    const key = line.slice(0, cut).trim().toLowerCase();
    if (!/^[a-z][a-z ]*$/.test(key)) break;
    fields[key] = line.slice(cut + 1).trim();
  }
  const body = lines.slice(at).join("\n").replace(/^\n+/, "").trim();
  return { fields, body };
}

// The turn post. `note` is the GM's own words for this turn, when there are
// any; everything else is the stamp db/turnCalendar.js#turnFacts computed, so
// #turns and the Game channel can never disagree about the clock.
// `plate` is "nuke" or "hellfire" once the game has earned one (db/lib/turnBanner.js), else absent.
function formatTurnPost({ number, day, date, clock, note, plate } = {}) {
  return composeGamePost(
    { Turn: number, Day: day, Date: date, Clock: clock, Plate: plate },
    note,
  );
}

function splitTurnPost(content) {
  const { fields, body } = parseGamePost(content);
  return {
    number: fields.turn ?? "",
    day: fields.day ?? "",
    date: fields.date ?? "",
    clock: fields.clock ?? "",
    plate: fields.plate ?? "",
    note: body,
  };
}

// The session line, and it is the sentence and nothing else. The words are
// db/lib/session.js's own, so a player who read one face has read both — and a
// header field here would be a label nobody needs, printed above a line that
// already says the whole thing. It draws as a plain subtext row rather than as
// a block (web/app/(app)/chat/blockRows.js has no entry for it), so what is
// stored is exactly what is read.
function formatSessionPost({ open } = {}) {
  return open ? "The game is in session." : "The game is no longer in session.";
}

// The epilogue. The facts line is a header field because it is the block's
// byline; the closing note, the antagonists and the roster are the body, as
// markdown, in the order db/lib/epilogue.js#formatEpilogue says them.
function formatEndPost({ facts, note, sections } = {}) {
  const body = [];
  if (note) body.push(`» ${String(note).trim()}`);
  for (const section of sections ?? []) {
    if (!section?.lines?.length) continue;
    // The heading is its own paragraph and the names are ONE list: a blank line
    // between each name would make markdown render a loose list, which puts a
    // paragraph's worth of air between every person in the roster.
    body.push(`**${section.title}**\n\n${section.lines.map((line) => `- ${line}`).join("\n")}`);
  }
  return composeGamePost({ Facts: facts }, body.join("\n\n"));
}

function splitEndPost(content) {
  const { fields, body } = parseGamePost(content);
  // The closing note is the leading `» …` paragraph, drawn as a pull-quote
  // rather than as part of the roster below it.
  const blocks = body.split("\n\n");
  const quoted = blocks[0]?.startsWith("» ") ? blocks.shift().slice(2).trim() : "";
  return { facts: fields.facts ?? "", note: quoted, body: blocks.join("\n\n").trim() };
}

module.exports = {
  GAME_POST,
  GAME_END_TITLE,
  composeGamePost,
  parseGamePost,
  formatTurnPost,
  splitTurnPost,
  formatSessionPost,
  formatEndPost,
  splitEndPost,
};
