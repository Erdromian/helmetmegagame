import { Prisma } from "@lifeweb/db";
import { AUTOMATED_EFFECT_SOURCES, MENTION_SOURCE } from "./dmSources";

// Excludes bot/UI plumbing that happens to go out as a DM but isn't part of
// a GM<->player conversation: embeds (meta.embed === true), anything tagged
// source: "system_notice" (edit-flow prompts, mention relays, proxy
// hand-back, reaction refusals — see bot/src/lib/dm.js call sites), and
// source: "prompt_reply" (what a player typed back INTO one of those
// prompts). Applied at the query, not the render, so a future noisy sendDm()
// call needs to pass its own `source` to show up here at all.
//
// Written as explicit null-tolerant ORs rather than a NOT over the two
// conditions: in SQL, `NOT (meta->'embed' = true)` is NULL — not true — for
// every row whose meta is NULL or lacks the key, and a NULL predicate drops
// the row, which almost every message is. Same trap applies to `source`,
// which is NULL on older rows and on anything sendDm sends without an
// explicit source.
const NOT_NOISE = [
  { OR: [{ source: null }, { source: { not: "system_notice" } }] },
  // Nothing writes prompt_reply any more (the edit flow is a button + modal,
  // bot/src/lib/editModal.js), but rows already in the table stay hidden so a
  // GM never reads a stray in-character poster as mail.
  { OR: [{ source: null }, { source: { not: "prompt_reply" } }] },
  {
    OR: [
      { meta: { equals: Prisma.DbNull } },
      { meta: { path: ["embed"], equals: Prisma.DbNull } },
      { meta: { path: ["embed"], not: true } },
    ],
  },
];

// Which chair is reading. The GM desk ("gm", the default) also drops mention
// relays — a ping is not conversation on the desk. The player's Chat pane
// ("player") keeps them: on Discord that DM is simply there, and hiding it on
// the web was the bug where a web ping seemed to reach nobody.
const GM_ONLY_NOISE = [{ OR: [{ source: null }, { source: { not: MENTION_SOURCE } }] }];

export function withoutDmNoise(where, { perspective = "gm" } = {}) {
  const extra = perspective === "player" ? [] : GM_ONLY_NOISE;
  return { ...where, AND: [...(where?.AND ?? []), ...NOT_NOISE, ...extra] };
}

// The raw-SQL twin of withoutDmNoise, for the $queryRaw call sites that can't
// take a Prisma `where`. Keep the two predicates in this one file — a
// hand-rolled copy elsewhere drifts and disagrees with the desk.
//
// `alias` is a code-supplied literal (the table alias in the caller's FROM),
// never user input, so Prisma.raw is safe here.
export function dmNoiseSql(alias, { perspective = "gm" } = {}) {
  const col = (c) => Prisma.raw(alias ? `${alias}."${c}"` : `"${c}"`);
  const base = Prisma.sql`(${col("source")} IS DISTINCT FROM 'system_notice')
    AND (${col("source")} IS DISTINCT FROM 'prompt_reply')
    AND ((${col("meta")}->>'embed') IS DISTINCT FROM 'true')`;
  if (perspective === "player") return base;
  return Prisma.sql`${base} AND (${col("source")} IS DISTINCT FROM ${MENTION_SOURCE})`;
}

// dmNoiseSql, plus excluding bot/effect noise that reads like conversation
// but isn't one — a resource grant, a dev-panel microaction summary, a
// Move-unlock notice (see dmSources.js for the exact list and why
// staged_push is not in it). For the rail's "last genuine message" preview
// text only — unread counts, the nav badge, and the "awaiting" filter keep
// using dmNoiseSql/withoutDmNoise so recency still reflects any DM.
export function genuineConversationSql(alias) {
  const col = (c) => Prisma.raw(alias ? `${alias}."${c}"` : `"${c}"`);
  const exclusions = AUTOMATED_EFFECT_SOURCES.map((s) => Prisma.sql`(${col("source")} IS DISTINCT FROM ${s})`);
  return Prisma.sql`${dmNoiseSql(alias)} AND ${Prisma.join(exclusions, " AND ")}`;
}

// The rail's preview prefix — "You: " for a message this GM sent, "GM: " for
// another GM's, "Bot: " for a bot-authored line, nothing for the player's own
// words. Lives here, next to the noise predicates, because the desk layout
// and the live-inbox delta (web/lib/inboxDelta.js) both build the same
// preview and must not drift.
export function dmPreviewLabel(genuine, myDiscordUserId) {
  if (!genuine) return "";
  if (genuine.direction === "INBOUND") return "";
  if (!genuine.authorDiscordUserId) return "Bot: ";
  return genuine.authorDiscordUserId === myDiscordUserId ? "You: " : "GM: ";
}

// The rail's preview line, from the two messages the desk queries for: the
// last GENUINE one (what a person said) and the last non-noise one (anything
// at all, automated notices included).
//
// A conversation can have the second and not the first, and that used to
// render as a row with a name on it and nothing in it — which is what a
// brand-new character looked like the moment a turret or a move-unlock DM'd
// them. It is a system message, so it says so and reads muted, rather than
// looking like a message somebody forgot to write. Built here because the
// desk layout and the live-inbox delta both need it and must not drift.
export function dmPreview(genuine, latest, myDiscordUserId) {
  if (genuine) return { preview: `${dmPreviewLabel(genuine, myDiscordUserId)}${genuine.content}`, previewIsSystem: false };
  if (latest?.content) return { preview: latest.content, previewIsSystem: true };
  return { preview: "", previewIsSystem: false };
}

// What Chat hands a PLAYER about their own conversation (CHAT.md §2b): the
// row minus who wrote it. `authorDiscordUserId` is deliberately not selected —
// a player never learns which GM answered, on either face. One select and one
// shape, read by the feed hub's live fan-out and by play/actions.js#gmThread,
// so the two cannot disagree.
export const PLAYER_DM_SELECT = {
  id: true,
  direction: true,
  content: true,
  source: true,
  createdAt: true,
  meta: true,
};

export function playerDmRow(row) {
  return {
    id: row.id,
    direction: row.direction,
    content: row.content,
    source: row.source ?? null,
    createdAt: row.createdAt.toISOString(),
    meta: row.meta ?? null,
  };
}
