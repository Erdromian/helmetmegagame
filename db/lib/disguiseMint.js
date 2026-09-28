// The Disguise Kit's one verb: for three turns you wear a name that isn't yours. Fifth runtime
// authoring door onto the tag catalog (alongside docs/tags.yaml, /gm/dev/tags, the corpse/headstone/
// crate minters, and db/lib/paperMint.js, whose row shape and retry loop this borrows). A MINTED ROW,
// not a column — Tag.forcedName does the job (db/lib/presentedIdentity.js#forcedNameFrom), so every
// identity surface picks it up free and the expiry sweep in db/index.js clears it later; the character
// posts under a letter plaque, and a hood pulled up over it hides it (./disguises.js#hoodUpOverDisguise).
// forcedNameFrom takes the FIRST tag
// with a forcedName, so Apex Form + a disguise together is undefined. Takes `prisma` (or a tx), off the
// @lifeweb/db barrel like db/lib/dm.js.

const { PAPER_SHAPE, createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");
const { NAME_LIMITS } = require("./characterName");
const { titleFormFor } = require("./titles");
const { groupRoles } = require("./roleGroups");
const { DISGUISE_SLUG_PREFIX, DISGUISE_TITLE_JOIN } = require("./disguises");
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

// The longest title a disguise may claim. With the longest first and last names it still fits the 80
// characters a Discord webhook's name may have (./characterName.js#NAME_LIMITS).
const DISGUISE_TITLE_MAX = 24;

// The name to go by, as one string: "Sir Aldric Vask". Takes the dialog's three parts — a title, a first
// name and a last name, each trimmed and capped like a character's own — or, from an older client, one
// typed string. A title is any text at all, since a disguise claims what it likes ("Grand Poobah"), and
// it is joined to the name by the no-break space that says where it ends (./disguises.js
// #DISGUISE_TITLE_JOIN). One of the game's own title words (./titles.js), in any case, is worn in the
// form the WEARER's `gender` takes: a disguise changes the name, not who is under it, so a woman who
// picks Sir goes by Dame. Null for anything unusable — a server action is a public endpoint and the
// dialog's limits are a hint, not a lock. The name is matched on its bare "First Last"
// (./disguises.js), so the title never decides who it fools, whatever the person it names is called.
function normalizeDisguiseName(raw, { gender = "NEUTRAL" } = {}) {
  if (typeof raw === "string") {
    const name = cleanPart(raw, NAME_LIMITS.honorific + NAME_LIMITS.firstName + NAME_LIMITS.lastName + 2);
    return name || null;
  }
  if (!raw || typeof raw !== "object") return null;
  const firstName = cleanPart(raw.firstName, NAME_LIMITS.firstName);
  if (!firstName) return null;
  const lastName = cleanPart(raw.lastName, NAME_LIMITS.lastName);
  const typedTitle = cleanPart(raw.honorific, DISGUISE_TITLE_MAX);
  const honorific = typedTitle ? (titleFormFor(typedTitle, gender) ?? typedTitle) : null;
  const bare = [firstName, lastName].filter(Boolean).join(" ");
  return honorific ? `${honorific}${DISGUISE_TITLE_JOIN}${bare}` : bare;
}

// The longest job a disguise may claim: the same cap a Friends entry's role takes, since a job heard
// is written into one (web/app/(app)/memories/friendActions.js).
const DISGUISE_JOB_MAX = 60;

// The real jobs the dialog suggests: every seat in the game, bucketed by estate the way the character
// picker is (./roleGroups.js#groupRoles). A suggestion, not a list to pick from: any job will do, made
// up or not, since a disguise claims what it likes (resolveDisguiseJob).
async function disguiseJobChoices(prisma) {
  const roles = await prisma.role.findMany({ orderBy: { sortOrder: "asc" }, select: { slug: true, name: true, groupSlug: true } });
  return groupRoles(roles);
}

// The job a typed value claims: `{ slug, name, groupSlug }`, or null when none was typed. Any job
// title works, real or made up. One that names a seat — by its name in any case, a leading "the" or
// "a" dropped, or by its slug — is that seat, spelled the seat's way and worn in its estate's colour.
// Anything else is a job nobody has, kept as typed with its first letter raised: `slug` and
// `groupSlug` null, so it has a name and no colour. Either way a job claims its name and nothing
// more: no seat's powers, rooms, rings or wages.
async function resolveDisguiseJob(prisma, raw) {
  const typed = cleanPart(raw, DISGUISE_JOB_MAX).replace(/^(?:the|an?)\s+(?=\S)/i, "");
  if (!typed) return null;
  const role = await prisma.role.findFirst({
    where: { OR: [{ slug: typed }, { name: { equals: typed, mode: "insensitive" } }] },
    select: { slug: true, name: true, groupSlug: true },
  });
  return role ?? { slug: null, name: typed[0].toUpperCase() + typed.slice(1), groupSlug: null };
}

// Wears the paper shape with three changes: not tradeable, removable (drop the act early), and
// carries the forcedName that does the work. Name varies per retry attempt too, for GM readability
// (db/lib/photoMint.js#disambiguated) — a retry appends a note code, not "(2)". inspectVisibility is
// HIDDEN, so nobody reads the real name off a 🔍.
// `job` is the claimed job (resolveDisguiseJob), or null.
function disguiseData(characterId, name, attempt, job = null) {
  const label = attempt === 0 ? name : `${name} · ${noteCode()}`;
  return {
    ...PAPER_SHAPE,
    tradeable: false,
    removable: true,
    weightLbs: null,
    slug: disguiseSlug(characterId, attempt),
    name: `Disguised (${label})`,
    description: job ? `You're disguised as ${name}, ${job.name}.` : `You're disguised as ${name}.`,
    forcedName: name,
    disguiseJob: job?.name ?? null,
    disguiseJobSlug: job?.slug ?? null,
    defaultDurationTurns: DISGUISE_TURNS,
  };
}

// Mint the row and put it on the character. `openTurn` lets expiryForGrant stamp the absolute turn
// the sweep matches on — without it the disguise is PERMANENT (TAGS.md §5: every grant path must
// stamp expiresTurn). Runs OUTSIDE a transaction — Postgres aborts on the first failed statement, so a
// retry loop inside a `tx` raises 25P02 instead of retrying (see paperMint.js). `job` is a
// resolveDisguiseJob answer, or null for none.
async function mintDisguise(prisma, characterId, name, openTurn, { job = null } = {}) {
  const tag = await createWithRetry(prisma, (attempt) => disguiseData(characterId, name, attempt, job));
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
  DISGUISE_JOB_MAX,
  DISGUISE_TITLE_MAX,
  normalizeDisguiseName,
  disguiseJobChoices,
  resolveDisguiseJob,
  mintDisguise,
  activeDisguise,
};
