// The Disguise Kit's one verb: for three turns you wear a name that isn't
// yours.
//
// This is the FIFTH runtime authoring door onto the tag catalog, beside
// docs/tags.yaml, the GM form at /gm/dev/tags, the corpse/headstone/crate
// minters and db/lib/paperMint.js — whose row shape and retry loop this
// borrows wholesale rather than copying.
//
// WHY A MINTED ROW AND NOT A COLUMN. Tag.forcedName already does exactly this
// job: db/lib/presentedIdentity.js#forcedNameFrom returns it off any held tag,
// and presentedIdentity then puts the character behind that name with the
// letter plaque for its initial and refuses /conceal. So a minted row needs
// ZERO new call sites — every surface that resolves an identity picks it up
// for free, and the ordinary expiry sweep in db/index.js takes it away again.
// A Character.disguiseName column would have meant teaching all eight identity
// call sites about a second source, and a stale one would have had to be swept
// by something.
//
// Two consequences, both of which read as correct for a disguise rather than
// as bugs: the character posts under a letter plaque instead of their portrait
// (they do not look like themselves), and /conceal refuses while it is on (a
// second face over the first is one too many). The tag description says so.
//
// ONE EDGE, not worth a mechanism: forcedNameFrom takes the FIRST tag carrying
// a forcedName, so a character holding both Apex Form and a disguise gets an
// undefined winner. A Beast in a false moustache is not a situation the game
// can currently produce.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays OFF the @lifeweb/db barrel.

const { PAPER_SHAPE, createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");
const { NAME_LIMITS } = require("./characterName");
const { noteCode } = require("./paper");
const { expiryForGrant } = require("./grantExpiry");

const DISGUISE_KIT_SLUG = "disguise-kit";
const DISGUISE_TURNS = 3;

// Same uniquifier paperMint uses, for the same reason: Tag.slug is @unique and
// the `custom-` prefix is what keeps a runtime row out of the YAML's namespace
// forever, so db:sync-tags never sees it and db:prune-tags skips it.
function disguiseSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-disguise-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

// The name a player typed, trimmed to one line and capped where every other
// first name is capped. Returns null for anything that is not a usable name —
// the caller turns that into a refusal, since a server action is a public
// endpoint and the dialog's maxlength is a hint, not a lock.
function normalizeDisguiseName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return name.slice(0, NAME_LIMITS.firstName);
}

// Every disguise row wears the paper shape with three changes: it is not
// tradeable (a false moustache is not cargo — it is a thing you are doing),
// it is removable so a player can drop the act early, and it carries the
// forcedName that does the actual work.
//
// The NAME varies per attempt as well as the slug, which is no longer forced
// by a constraint (Tag.name stopped being unique — db/lib/paper.js#paperName)
// and is kept because it reads better: "Disguised (John)" is a name the game
// makes over and over, and a list of identical ones tells a GM nothing about
// which is which. db/lib/photoMint.js#disambiguated is the same answer.
//
// The first attempt stays clean; a retry appends a note code rather than a
// "(2)" — two people going by John are two different Johns, not the second
// draft of one.
//
// inspectVisibility is HIDDEN, so nobody reads "Disguised (Kellen Ward)" off a
// 🔍 — which would give the whole thing away.
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

// Mint the row and put it on the character. `openTurn` is the open Turn row —
// expiryForGrant stamps the absolute turn the sweep will match on, and WITHOUT
// a stamp the disguise is PERMANENT no matter what defaultDurationTurns says
// (TAGS.md §5: every grant path must stamp expiresTurn). expiryForGrant rather
// than turnFormat's expiryFor because this is a grant: advanceTurn() leaves no
// turn OPEN for a window, and expiryFor would silently hand out a forever
// disguise inside it.
//
// Returns the new Tag row, or null if six slug/name collisions in a row
// somehow happened. Runs OUTSIDE a transaction for the reason paperMint spells
// out: Postgres aborts the whole transaction on the first failed statement, so
// a retry loop inside a `tx` raises 25P02 instead of retrying — and
// "Disguised (John)" is a name the game will make over and over, unlike a
// note's random waybill code.
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

// What the caller checks before offering the button: a disguise already live.
// One at a time — a second one would leave two forcedName rows racing, and
// forcedNameFrom picks whichever comes back first.
async function activeDisguise(prisma, characterId) {
  return prisma.characterTag.findFirst({
    where: { characterId, tag: { forcedName: { not: null }, slug: { startsWith: "custom-disguise-" } } },
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
