// A mention, in the one shape the ROW is written in.
//
// The two faces spell a mention differently. Discord has `<@&roleId>`, which
// works because a character's personal role is a mentionable name token
// (PROXYING.md §6). The web has `{char:<id>}`, the same inline-reference
// syntax every other bubble in the app uses (web/app/components/richTokens.js).
// Neither is readable to the other: a `<@&…>` on the web is an angle-bracketed
// number, and a `{char:…}` on Discord is literal braces.
//
// So the row is FACE-NEUTRAL and stores `{char:<id>}`, and this module is the
// pair of translations at the edges:
//
//   in   db/lib/say.js#prepareSpeech  — a Discord-origin `<@&roleId>` naming a
//        character role becomes `{char:<id>}` before the row is written.
//   out  bot/src/lib/feedOutbox.js    — every `{char:<id>}` becomes
//        `<@&roleId>` on the way to Discord.
//
// The id in a token is never trusted as an authorisation. It resolves to a
// character or it does not; an unresolved token is left exactly as written,
// which is the same contract richTokens.js states for every other kind.
//
// THE TOKEN CARRIES THE NAME IT WAS SENT UNDER: `{char:<id>|<Name>}`.
//
// Everything else about a row's identity is frozen at send time —
// ArchiveEntry.characterName, .concealedAlias, .presentedAvatarPath
// (db/lib/archive.js). The mention was the exception, resolved live against
// the roster on every render, and that made a past sentence editable by its
// subject: a Mulligan rename renamed somebody in every line that had ever
// named them, and putting a hood on collapsed all of those to "someone".
// A row records who someone was as they were known then; this is that rule,
// applied to the people a speaker named as well as to the speaker.
//
// In the TOKEN rather than a column beside the row, because the text gets
// COPIED. A ⭐ lifts a body into Note.content (both star paths), a journal
// entry is its own store, and a sidecar would have to be added to three tables
// and hand-carried down every copy path — where a missed one falls back to
// live resolution, which is the bug. A name in the token travels with the
// words for free, and needs no migration.
//
// The name is the PRESENTED one (db/lib/presentedIdentity.js): forced >
// concealed > own. A row must never print a name the room could not have
// heard, so a hooded target mentioned from Discord — where any name role can
// be pinged — freezes as "Young Man", and a Beast freezes as Beast.
//
// A token with no `|` is one written before this existed. It resolves live,
// exactly as it always did. There is deliberately NO BACKFILL: stamping
// today's names onto old rows would perform the retroactive rewrite this
// exists to prevent, once, in bulk, and permanently.

const { parsePlaceKey } = require("./placeKey");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");

// A cuid, in practice, but written loosely on purpose: what makes a token
// valid is that it resolves, not that it matches a shape. The name half is
// optional and stops at the first `}` or `|`, which is what freezeMentionName
// below guarantees it can never contain.
const TOKEN_RE = /\{char:([A-Za-z0-9_-]{1,64})(?:\|([^{}|\n]{0,64}))?\}/g;
const ROLE_RE = /<@&(\d{5,32})>/g;

// What a name has to survive to sit inside the grammar. `{`, `}` and `|` are
// the three characters that would break it, and a player-typed name can hold
// all three: normalizeDisguiseName (db/lib/disguiseMint.js) only collapses
// whitespace and caps length, so a disguise called `Bob}` is reachable today.
// Capped at 64 to match the id half, so one mention cannot be a paragraph.
function freezeMentionName(name) {
  if (typeof name !== "string") return null;
  const clean = name.replace(/[{}|]/g, "").replace(/\s+/g, " ").trim().slice(0, 64);
  return clean || null;
}

// Whether this text names this character, in either spelling. One predicate,
// because "does the row mention me" is asked from three places and each of
// them used to build the string itself — which is how a widened grammar
// silently stops matching at one call site and not the others.
function mentionsCharacter(content, characterId) {
  if (typeof content !== "string" || !characterId) return false;
  return content.includes(`{char:${characterId}}`) || content.includes(`{char:${characterId}|`);
}

// The tags presentedIdentity resolves against: a name-forcing one, and
// anything equipped that conceals. Same shape web/lib/mentionDirectory.js
// selects — CONCEALMENT_TAG_FIELDS exists so these cannot drift.
const IDENTITY_INCLUDE = {
  where: {
    OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
  },
  select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
};

// Stamp every mention in `content` with the name its subject is presenting
// RIGHT NOW, replacing anything already there.
//
// Replacing rather than preserving is the security half: the web composer
// writes the name in as it inserts the chip, and a server action is a public
// endpoint (CLAUDE.md), so a posted `{char:<victim>|Some Fake Name}` has to be
// overwritten rather than trusted. The composer's copy is only there so the
// draft looks right before it is sent.
//
// One query for the whole message, and a no-op string scan when there are no
// mentions at all — which is almost every line.
async function stampMentionNames(prisma, content) {
  const ids = mentionedIdsIn(content);
  if (ids.length === 0) return content;

  const characters = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      concealed: true,
      age: true,
      gender: true,
      tags: IDENTITY_INCLUDE,
    },
  });
  const nameById = new Map(
    characters.map((character) => [
      character.id,
      freezeMentionName(
        presentedIdentity(character, {
          forcedName: forcedNameFrom(character.tags),
          concealment: concealmentFrom(character.tags),
        }).name,
      ),
    ]),
  );

  // A token naming somebody who is gone keeps whatever it had: there is no
  // live answer to replace it with, and dropping the name would lose the only
  // record of who was meant.
  return content.replace(TOKEN_RE, (raw, id, existing) => {
    const name = nameById.get(id) ?? freezeMentionName(existing);
    return name ? `{char:${id}|${name}}` : `{char:${id}}`;
  });
}

// Every character id named by a `{char:…}` in this text, deduped and in the
// order they appear.
function mentionedIdsIn(content) {
  if (typeof content !== "string" || !content.includes("{char:")) return [];
  const ids = [];
  for (const match of content.matchAll(TOKEN_RE)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

// Web/row -> Discord. Returns `{ content, characters }`: the rewritten text,
// and the characters it actually named.
//
// A token whose character is gone or has no role falls back to the NAME the
// token froze, as plain text. It used to fall back to the raw `{char:abc}`, on
// the argument that a reader seeing braces can at least tell somebody was
// meant — which was the best available answer while the token held nothing a
// human could read. It holds the name now, so the honest fallback is to print
// it. Plain text, not a ping: there is no role to ping.
async function tokensToRoles(prisma, content) {
  const ids = mentionedIdsIn(content);
  if (ids.length === 0) return { content, characters: [] };

  const characters = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      status: true,
      discordRoleId: true,
      discordUserId: true,
      locationId: true,
      zoneId: true,
      webOnly: true,
    },
  });
  const byId = new Map(characters.map((c) => [c.id, c]));

  const rewritten = content.replace(TOKEN_RE, (raw, id, frozenName) => {
    const character = byId.get(id);
    if (character?.discordRoleId) return `<@&${character.discordRoleId}>`;
    return frozenName || raw;
  });

  return { content: rewritten, characters: ids.map((id) => byId.get(id)).filter(Boolean) };
}

// Discord -> row. Only a role that IS a character's name token is rewritten:
// Character.discordRoleId is @unique, so the lookup answers with one character
// or with nothing, and a GM/spectator/player role resolves to nothing and is
// left alone. That is the same rule bot/src/lib/mentions.js has always applied
// to the relay DM.
async function rolesToTokens(prisma, content) {
  if (typeof content !== "string" || !content.includes("<@&")) return content;
  const roleIds = [...new Set([...content.matchAll(ROLE_RE)].map((m) => m[1]))];
  if (roleIds.length === 0) return content;

  const characters = await prisma.character.findMany({
    where: { discordRoleId: { in: roleIds } },
    select: { id: true, discordRoleId: true },
  });
  if (characters.length === 0) return content;
  const byRole = new Map(characters.map((c) => [c.discordRoleId, c.id]));

  return content.replace(ROLE_RE, (raw, roleId) => {
    const id = byRole.get(roleId);
    return id ? `{char:${id}}` : raw;
  });
}

// How far a ping carries, expressed as the place it was said in. The rule is
// PROXYING.md §6's: a ping must not reach further than a voice would, so a
// Location, a Room and a Conversation all gate on the LOCATION around them,
// and a zone summary gates on the zone.
async function earshotForPlaceKey(prisma, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { locationId: null, zoneId: null };

  if (parsed.kind === "loc") return { locationId: parsed.id, zoneId: null };
  if (parsed.kind === "zone") return { locationId: null, zoneId: parsed.id };

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({ where: { id: parsed.id }, select: { locationId: true } });
    return { locationId: room?.locationId ?? null, zoneId: null };
  }

  const conversation = await prisma.playerThread.findUnique({
    where: { id: parsed.id },
    select: { locationId: true },
  });
  return { locationId: conversation?.locationId ?? null, zoneId: null };
}

// Whether this character is close enough to be told. Alive, and standing in
// the place's earshot. Pinging your own character DOES pass — the relay is
// the only proof a player has that the feature works, and PROXYING.md §6 has
// the whole argument.
function inEarshot(character, earshot) {
  if (!character || character.status !== "ALIVE") return false;
  if (earshot.locationId) return character.locationId === earshot.locationId;
  if (earshot.zoneId) return character.zoneId === earshot.zoneId;
  return false;
}

module.exports = {
  TOKEN_RE,
  ROLE_RE,
  freezeMentionName,
  mentionsCharacter,
  mentionedIdsIn,
  stampMentionNames,
  tokensToRoles,
  rolesToTokens,
  earshotForPlaceKey,
  inEarshot,
};
