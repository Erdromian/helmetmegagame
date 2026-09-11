import { Prisma } from "@lifeweb/db";
import { DM_KIND, MENTION_SOURCE } from "@lifeweb/db/lib/dmKinds";

// The predicates the desk and Chat read DirectMessage through.
//
// There are two questions, and they used to be tangled into one. "Is this row
// conversation?" decides the RAIL — who is in the inbox, in what order, with
// what preview. "Is this row drawable?" decides a THREAD — what you see once
// you have opened somebody. A notice answers no to the first and yes to the
// second, which is exactly the shape that was missing.
//
// Both key on `DirectMessage.kind` and nothing else. It used to be a list of
// `source` strings, and the trouble with a list is that a new string is not on
// it: `lobby_assignment` ("You are the Baroness"), `bird` ("a bird finds you"),
// `rite`, `threat_assign` and five more were all full conversation on the desk
// because nobody thought to add them. `kind` is written by sendDm whether the
// caller thinks about it or not, and its default is the quiet one.

// A thread: everything except plumbing.
const IS_DRAWABLE = { kind: { not: DM_KIND.QUIET } };

// The one thing the two chairs still disagree about. A mention relay is about
// the player, so their Chat pane shows it and the GM desk does not — on
// Discord that DM is simply sitting in their inbox either way. Written as a
// null-tolerant OR because `source` is NULL on most rows, and in SQL a NULL
// predicate drops its row rather than keeping it.
const NOT_MENTION = { OR: [{ source: null }, { source: { not: MENTION_SOURCE } }] };

// A thread's rows, from whichever chair. `perspective: "player"` keeps the
// mention relays; the default GM chair drops them.
export function withoutDmNoise(where, { perspective = "gm" } = {}) {
  const extra = perspective === "player" ? [] : [NOT_MENTION];
  return { ...where, AND: [...(where?.AND ?? []), IS_DRAWABLE, ...extra] };
}

// The raw-SQL twins, for the $queryRaw call sites that can't take a Prisma
// `where`. Keep every predicate in this one file — a hand-rolled copy
// elsewhere drifts and disagrees with the desk, which is how the rail once
// previewed and sorted by rows the pane was hiding.
//
// `alias` is a code-supplied literal (the table alias in the caller's FROM),
// never user input, so Prisma.raw is safe here.
function col(alias, c) {
  return Prisma.raw(alias ? `${alias}."${c}"` : `"${c}"`);
}

// The rail: recency, ordering, the preview, `hasConversation`, unread counts,
// the nav badge. A notice can no more put a player in the inbox than it can
// move one up it.
export function railKindSql(alias) {
  return Prisma.sql`${col(alias, "kind")} = ${DM_KIND.CONVERSATION}`;
}

// The raw twin of withoutDmNoise, for the one raw-SQL caller that asks the
// THREAD question rather than the rail one: the desk's message-content search
// (app/api/gm/conversation-search). It has to match what opening
// the person would show, notices included — a GM who remembers reading a line
// on somebody's thread and cannot search for it has been told the search is
// broken, and searching only the rail's rows is exactly that.
export function threadKindSql(alias, { perspective = "gm" } = {}) {
  const base = Prisma.sql`${col(alias, "kind")} <> ${DM_KIND.QUIET}`;
  if (perspective === "player") return base;
  return Prisma.sql`${base} AND (${col(alias, "source")} IS DISTINCT FROM ${MENTION_SOURCE})`;
}

// The rail's preview line, prefixed by who wrote it — "You: " for this GM,
// "GM: " for another, "Bot: " for a bot-authored line, nothing for the
// player's own words. Lives here, next to the predicates, because the desk
// layout and the live-inbox delta (web/lib/inboxDelta.js) both build the same
// preview and must not drift.
//
// One query's worth now: the last CONVERSATION row is the last row the rail
// can see at all, so there is nothing to fall back to. There used to be a
// second query and a muted "this conversation is nothing but a turret notice"
// state — both of which existed only because a notice could put a row on the
// rail with nothing to say.
export function dmPreview(latest, myDiscordUserId) {
  if (!latest?.content) return "";
  const label =
    latest.direction === "INBOUND" ? ""
    : !latest.authorDiscordUserId ? "Bot: "
    : latest.authorDiscordUserId === myDiscordUserId ? "You: "
    : "GM: ";
  return `${label}${latest.content}`;
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
  kind: true,
  createdAt: true,
  meta: true,
};

// What the GM DESK is handed about a conversation. The player's opposite
// number above, and deliberately wider: the desk has to say WHO answered
// ("You: " / "GM: " / "Bot: " in dmPreview), so authorDiscordUserId stays,
// and it draws notices as quiet grey lines, so `kind` stays too.
//
// Kept in step with the open-thread select in web/lib/inboxDelta.js on
// purpose — the desk's poll and its live stream deliver rows into the same
// client store (gm/players/liveInbox.js), and two shapes in one store is how
// a row renders one way on arrival and another way after a refresh.
export const GM_DM_SELECT = {
  id: true,
  discordUserId: true,
  direction: true,
  content: true,
  authorDiscordUserId: true,
  source: true,
  kind: true,
  createdAt: true,
  meta: true,
};

export function gmDmRow(row) {
  return {
    id: row.id,
    discordUserId: row.discordUserId,
    direction: row.direction,
    content: row.content,
    authorDiscordUserId: row.authorDiscordUserId ?? null,
    source: row.source ?? null,
    kind: row.kind,
    meta: row.meta ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function playerDmRow(row) {
  return {
    id: row.id,
    direction: row.direction,
    content: row.content,
    source: row.source ?? null,
    kind: row.kind,
    meta: row.meta ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
