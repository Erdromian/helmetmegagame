// The Disguise Kit's one verb: for three turns you wear a name that isn't yours. Fifth runtime
// authoring door onto the tag catalog (alongside docs/tags.yaml, /gm/dev/tags, the corpse/headstone/
// crate minters, and db/lib/paperMint.js, whose row shape and retry loop this borrows). A MINTED ROW,
// not a column — Tag.forcedName does the job (db/lib/presentedIdentity.js#forcedNameFrom), so every
// identity surface picks it up free and the expiry sweep in db/index.js clears it later; the character
// posts under a letter plaque and /conceal refuses while it's on. forcedNameFrom takes the FIRST tag
// with a forcedName, so Apex Form + a disguise together is undefined. Takes `prisma` (or a tx), off the
// @lifeweb/db barrel like db/lib/dm.js.

const { PAPER_SHAPE, createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");
const { NAME_LIMITS } = require("./characterName");
const { TITLE_WORDS } = require("./titles");
const { DISGUISE_SLUG_PREFIX } = require("./disguises");
const { noteCode } = require("./paper");
const { expiryForGrant } = require("./grantExpiry");

const DISGUISE_KIT_SLUG = "disguise-kit";
const DISGUISE_TURNS = 3;

// Same uniquifier paperMint uses — the `custom-` prefix keeps a runtime row out of the YAML's
// namespace, so db:sync-tags never sees it and db:prune-tags skips it.
function disguiseSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${DISGUISE_SLUG_PREFIX}${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

function cleanPart(raw, limit) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, limit).trim();
}

// The name to go by, as one string: "Sir Aldric Vask". Takes the dialog's three parts — a title, a first
// name and a last name, each trimmed and capped like a character's own — or, from an older client, one
// typed string. A title must be one of the game's title words (./titles.js), matched in any case; any of
// them will do, since a disguise claims what it likes. Null for anything unusable, and for a title that
// is not a title — a server action is a public endpoint and the dialog's limits are a hint, not a lock.
// The name is matched on its bare "First Last" (./disguises.js), so the title never decides who it fools.
function normalizeDisguiseName(raw) {
  if (typeof raw === "string") {
    const name = cleanPart(raw, NAME_LIMITS.honorific + NAME_LIMITS.firstName + NAME_LIMITS.lastName + 2);
    return name || null;
  }
  if (!raw || typeof raw !== "object") return null;
  const firstName = cleanPart(raw.firstName, NAME_LIMITS.firstName);
  if (!firstName) return null;
  const lastName = cleanPart(raw.lastName, NAME_LIMITS.lastName);
  const typedTitle = cleanPart(raw.honorific, NAME_LIMITS.honorific);
  const honorific = typedTitle ? TITLE_WORDS.find((word) => word.toLowerCase() === typedTitle.toLowerCase()) : null;
  if (typedTitle && !honorific) return null;
  return [honorific, firstName, lastName].filter(Boolean).join(" ");
}

// Wears the paper shape with three changes: not tradeable, removable (drop the act early), and
// carries the forcedName that does the work. Name varies per retry attempt too, for GM readability
// (db/lib/photoMint.js#disambiguated) — a retry appends a note code, not "(2)". inspectVisibility is
// HIDDEN, so nobody reads the real name off a 🔍.
function disguiseData(characterId, name, attempt) {
  const label = attempt === 0 ? name : `${name} · ${noteCode()}`;
  return {
    ...PAPER_SHAPE,
    tradeable: false,
    removable: true,
    weightLbs: null,
    slug: disguiseSlug(characterId, attempt),
    name: `Disguised (${label})`,
    description: `You're disguised as ${name}.`,
    forcedName: name,
    defaultDurationTurns: DISGUISE_TURNS,
  };
}

// Mint the row and put it on the character. `openTurn` lets expiryForGrant stamp the absolute turn
// the sweep matches on — without it the disguise is PERMANENT (TAGS.md §5: every grant path must
// stamp expiresTurn). Runs OUTSIDE a transaction — Postgres aborts on the first failed statement, so a
// retry loop inside a `tx` raises 25P02 instead of retrying (see paperMint.js).
async function mintDisguise(prisma, characterId, name, openTurn) {
  const tag = await createWithRetry(prisma, (attempt) => disguiseData(characterId, name, attempt));
  if (!tag) return null;
  await addToStack(prisma, characterId, tag.id, 1, {
    source: "GM_GRANT",
    expiresTurn: await expiryForGrant(prisma, tag, openTurn, {
      characterId,
      where: "mintDisguise",
    }),
  });
  return tag;
}

// What the caller checks before offering the button — one at a time, a second would leave two
// forcedName rows racing.
async function activeDisguise(prisma, characterId) {
  return prisma.characterTag.findFirst({
    where: { characterId, tag: { forcedName: { not: null }, slug: { startsWith: DISGUISE_SLUG_PREFIX } } },
    select: { id: true, tagId: true, tag: { select: { id: true, name: true, forcedName: true } } },
  });
}

module.exports = {
  DISGUISE_KIT_SLUG,
  DISGUISE_TURNS,
  normalizeDisguiseName,
  mintDisguise,
  activeDisguise,
};
