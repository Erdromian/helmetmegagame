// A game's transcript as a plain text file (docs/systemdocs/ARCHIVE.md §5, Export).
//
// The page draws the rows; this writes the same rows down, broken into days and
// scenes by the same rules (./archiveScenes.js) so the file reads the way the
// screen did. It reads RAW ArchiveEntry columns (characterName, concealedAlias,
// action…), never the browser shape: the export is built on the server for a GM,
// and one of its two sources is a packet, which only ever holds raw rows.
//
// Pure — no Prisma, no React — so /api/archive/export can hand it rows from the
// database or from a packet alike.

import { activeArchiveFilters } from "./archiveQuery";
import { FOLD_MARK, dayLabel, sameScene, sceneOf } from "./archiveScenes";
import { describeAudit } from "./auditNarrative";
import { gameTitle } from "./gameLabel";

// `{char:<id>|Name}`, the mention token (db/lib/characterMentions.js#TOKEN_RE).
// Spelled again here rather than required: that module drags half of db/lib in.
const MENTION_RE = /\{char:([A-Za-z0-9_-]{1,64})(?:\|([^{}|\n]{0,64}))?\}/g;

// The name a mention was sent under, frozen in the token. A token from before
// the freeze has none, and falls back to what the character is called now.
export function flattenMentions(content, names = new Map()) {
  return String(content ?? "").replace(MENTION_RE, (_raw, id, frozen) => frozen || names.get(id) || "someone");
}

// A timezone the browser sent that this runtime does not know is not worth a
// failed export: the file says UTC instead, and says so in its header.
export function safeTimeZone(tz) {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function clockIn(tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
  return (at) => fmt.format(new Date(at));
}

function stampIn(tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz,
  });
  return (at) => fmt.format(new Date(at));
}

function segmentText(seg, entry) {
  switch (seg.k) {
    case "t":
    case "em":
    case "mono":
    case "chip":
    case "zone":
      return String(seg.v);
    case "qty":
      return `×${seg.v}`;
    case "res":
      return `${seg.v} ⬢`;
    case "actor":
      return entry.actor.name;
    case "target":
      return entry.target?.name ?? "someone";
    default:
      return "";
  }
}

// One ACTION row as the sentence /gm/audit prints for the audit row behind it,
// in words: the same renderer the page uses (app/components/ArchiveActionSentence.js),
// with the same two adjustments — the name in front is dropped when it opens the
// sentence too, and a Move gets its words when the sentence does not quote them.
export function actionSentence(row) {
  const action = row?.action;
  if (!action?.type) return String(row?.content ?? "");
  const self = action.actorName && action.actorName === row.characterName;
  const entry = {
    actionType: action.type,
    details: action.details ?? {},
    actor: { characterId: null, name: action.actorName ?? "Someone" },
    target: action.targetId ? { id: action.targetId, name: action.targetName ?? "someone" } : null,
    names: {},
  };
  let { segments } = describeAudit(entry);
  if (self && segments[0]?.k === "actor") {
    segments = segments.slice(1);
    if (segments[0]?.k === "t" && segments[0].v === "—") segments = segments.slice(1);
  }
  const d = entry.details;
  if (action.moveText && !d.to && !d.description) {
    segments = [...segments, { k: "t", v: "—" }, { k: "em", v: `"${action.moveText}"` }];
  }
  return segments
    .map((s) => segmentText(s, entry))
    .filter(Boolean)
    .join(" ")
    .replace(/ ([,.;:])/g, "$1");
}

// The name a line went out under. A hooded line keeps both halves, the way the
// page draws them: what the room saw, then who it was.
function speakerOf(row) {
  const real = row.characterName ?? null;
  const alias = row.concealedAlias ?? null;
  if (alias && real && alias !== real) return `${alias} (${real})`;
  return alias ?? real ?? "Someone";
}

// Continuation lines sit under the words, not under the clock.
const INDENT = "       ";

function entryLine(time, lead, text) {
  const [first, ...rest] = String(text ?? "").split(/\r?\n/);
  return [`${time}  ${lead}${first}`, ...rest.map((line) => INDENT + line)];
}

function rowLines(row, clock, names) {
  const time = clock(row.sentAt);
  const edited = row.editedAt ? " (edited)" : "";
  if (row.kind === "ACTION") {
    return entryLine(time, `${row.characterName ?? "Someone"} ▸ `, flattenMentions(actionSentence(row), names) + edited);
  }
  if (row.kind === "MESSAGE") {
    // A line the world said (db/lib/scene.js) has no speaker at all.
    if (row.source === "SYSTEM") return entryLine(time, "* ", flattenMentions(row.content, names) + edited);
    return entryLine(time, `${speakerOf(row)}: `, flattenMentions(row.content, names) + edited);
  }
  // An arrival, a death, a desire: what the page folds into one muted line.
  return entryLine(time, `${FOLD_MARK[row.kind] ?? "·"} `, flattenMentions(row.content, names));
}

function headerLines({ game, status, filters, names, count, tz, generatedAt, whole }) {
  const lines = [`Archive — ${gameTitle(game)}`, status];
  if (whole) {
    lines.push("Showing: the whole game, every line and every act");
  } else {
    lines.push(`Showing: ${filters.show === "all" ? "Everything" : "Speech"} · Actions ${filters.actions ? "on" : "off"}`);
    const chips = activeArchiveFilters(filters, names).map((c) => c.label);
    lines.push(`Narrowed to: ${chips.length ? chips.join(" · ") : "nothing, the whole game"}`);
    lines.push(`Order: ${filters.order === "desc" ? "newest first" : "oldest first"}`);
  }
  lines.push(`${count} ${count === 1 ? "entry" : "entries"} · exported ${stampIn(tz)(generatedAt)} (${tz})`);
  return lines;
}

function epilogueLines(epilogue) {
  if (!epilogue) return [];
  const out = ["", "How it ended", "------------"];
  if (epilogue.closingNote) out.push(`» ${epilogue.closingNote}`);
  if (epilogue.facts) out.push(epilogue.facts);
  if (epilogue.antagonists?.length) out.push("", "The antagonists:", ...epilogue.antagonists.map((l) => `  ${l}`));
  if (epilogue.roster?.length) out.push("", "Who was who:", ...epilogue.roster.map((l) => `  ${l}`));
  return out;
}

/**
 * The whole file, as one string.
 *   game        the Game row (label and dates name it)
 *   status      one line saying which game this is: current, past, put away
 *   rows        raw ArchiveEntry rows, already filtered and in order
 *   filters     parseArchiveParams output, for the header (ignored when `whole`)
 *   whole       true when no filter applied (a put-away game, read from its packet)
 *   names       character id -> name, for People chips and pre-freeze mentions
 *   epilogue    { closingNote, facts, antagonists[], roster[] } as plain lines, or null
 *   tz          the reader's timezone; anything unknown reads as UTC
 */
export function archiveTranscriptText({
  game, status = "", rows = [], filters = {}, whole = false, names = new Map(), epilogue = null, tz, generatedAt = new Date(),
}) {
  const zone = safeTimeZone(tz);
  const clock = clockIn(zone);
  const body = [];
  let day;
  let scene;
  let count = 0;
  for (const row of rows) {
    // A TURN_START is never a line: the day heading says all it carries. And a
    // day with nothing else in it gets no heading, since in a file an empty
    // heading reads as a line that went missing.
    if (row.kind === "TURN_START") continue;
    const thisDay = dayLabel(row);
    if (thisDay !== day) {
      day = thisDay;
      scene = undefined;
      body.push("", `== ${thisDay} ==`);
    }
    const here = sceneOf(row);
    if (!sameScene(here, scene)) {
      scene = here;
      body.push("", `-- ${here.label}${here.channelKind === "summary" ? " (summary)" : ""} --`);
    }
    body.push(...rowLines(row, clock, names));
    count += 1;
  }
  const head = headerLines({ game, status, filters, names, count, tz: zone, generatedAt, whole });
  const empty = count === 0 ? ["", "No line in this game matches that."] : [];
  return [...head, ...epilogueLines(epilogue), ...empty, ...body, ""].join("\n");
}

// What the downloaded file is called: the game, then whether it was narrowed.
export function archiveFileName(game, { filtered = false } = {}) {
  const slug = gameTitle(game)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  const name = slug || String(game?.id ?? "game").slice(0, 7);
  return `archive-${name}${filtered ? "-filtered" : ""}.txt`;
}
