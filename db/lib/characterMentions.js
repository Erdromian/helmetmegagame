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

const { parsePlaceKey } = require("./placeKey");

// A cuid, in practice, but written loosely on purpose: what makes a token
// valid is that it resolves, not that it matches a shape.
const TOKEN_RE = /\{char:([A-Za-z0-9_-]{1,64})\}/g;
const ROLE_RE = /<@&(\d{5,32})>/g;

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
// and the characters it actually named. A token whose character is gone or
// has no role is left as literal text rather than dropped — a reader seeing
// `{char:abc}` can tell somebody was meant, which a silent deletion cannot.
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

  const rewritten = content.replace(TOKEN_RE, (raw, id) => {
    const character = byId.get(id);
    return character?.discordRoleId ? `<@&${character.discordRoleId}>` : raw;
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
  mentionedIdsIn,
  tokensToRoles,
  rolesToTokens,
  earshotForPlaceKey,
  inEarshot,
};
