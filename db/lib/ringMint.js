// Minting and registering signet rings (docs/systemdocs/RINGS.md). The same
// runtime door onto the tag catalog as db/lib/photoMint.js: every ring is its
// own `custom` + `ephemeral` Tag row, because each is engraved for one person
// and registered to its own doors and account. The rules about what a ring IS
// live in db/lib/rings.js; the words in db/lib/ringText.js.
//
// Takes `prisma` (or a tx) as a parameter and stays off the @lifeweb/db barrel.

const { TAG_CATEGORY } = require("./constants");
const { createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");
const { openAccount } = require("./bankAccounts");
const { fillRingText } = require("./ringText");
const { PAPER_GROUP_SLUG, sealLabel } = require("./paper");
const {
  RING_SLUG,
  FINGER,
  initialsOf,
  ringAccessFor,
  spawnRingShape,
  ringName,
  ringDescription,
  ringInitials,
} = require("./rings");

const RING_SHAPE = {
  category: TAG_CATEGORY.ITEMS,
  pointCost: 0,
  custom: true,
  ephemeral: true,
  // A ring is handed over, stolen off a body, pawned. Weightless like a key was.
  tradeable: true,
  weightLbs: 0,
  stackable: false,
  removable: true,
  purchasable: false,
  purchasableAfterStart: false,
  equippable: true,
  equipSlot: FINGER,
  sprite: "gearring",
  // Seen on a hand, the way jewelry is; a pocketed ring is nobody's business.
  inspectVisibility: "WORN",
};

function ringSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-ring-${String(characterId ?? "x").slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

// The catalog row's group, so a minted ring sorts and colours with the recipe.
async function ringGroupId(db) {
  const source = await db.tag.findUnique({ where: { slug: RING_SLUG }, select: { groupId: true } });
  return source?.groupId ?? null;
}

// A ring engraved for `engravedFor` ({ id, name }) and registered to nothing.
// Plain unless `shape` says otherwise (an office's own ring, spawnRingShape):
// a plain ring leaves no seal. What a smith hands over is always plain. `db`
// must be the TOP-LEVEL client: createWithRetry leans on a failed insert, which
// would abort a transaction.
async function createRingRow(db, engravedFor, shape = null) {
  const initials = initialsOf(engravedFor?.name) ?? "?";
  const groupId = await ringGroupId(db);
  const tag = await createWithRetry(db, (attempt) => ({
    ...RING_SHAPE,
    groupId,
    slug: ringSlug(engravedFor?.id, attempt),
    name: shape?.name ?? ringName(initials),
    description: shape?.description ?? ringDescription({ initials, registered: false }),
    ringOfCharacterId: engravedFor?.id ?? null,
    ringInitials: initials,
    sealMark: shape?.sealMark ?? null,
    sealOffice: shape?.sealOffice ?? null,
  }));
  if (!tag) throw new Error("Could not engrave the ring.");
  return tag;
}

// Register a ring to seats and an account — the Meister's half of the doc, and
// what a seat's own ring gets at spawn. `roles` are Role rows (at least
// { slug, ringAccessSlugs }) covering `roleSlugs`. Registering never gives a
// ring a seal: a smithed ring for the Baron opens the Baron's doors and seals
// nothing, because only the office's own ring does.
async function registerRing(tx, ring, { roleSlugs, roles, bankAccountId }) {
  return tx.tag.update({
    where: { id: ring.id },
    data: {
      ringRoleSlugs: [...new Set(roleSlugs)].sort(),
      ringAccessSlugs: ringAccessFor(roleSlugs, roles),
      ringRegisteredAt: ring.ringRegisteredAt ?? new Date(),
      ringBankAccountId: bankAccountId ?? null,
      // An office ring's words are its own. A plain ring loses its "not
      // registered yet" sentence, and one registered to an office's doors says
      // it lacks the original's seal.
      ...(ring.sealOffice
        ? {}
        : {
            description: ringDescription({
              initials: ringInitials(ring),
              registered: true,
              office: (roles ?? []).some((r) => roleSlugs.includes(r.slug) && r.ringSealOffice),
            }),
          }),
    },
  });
}

// A seat's own ring, at creation: minted, put on, registered to the seat and
// linked to the character's account (opened here if the seat had none, since
// a ring with no account is a ring the infoterminal can't read). An office seat
// gets its own named ring, the only kind that seals. Best-effort by contract —
// the caller wraps it in .catch(), the way it does the bank account. Returns
// the ring, or null for a seat that doesn't spawn with one.
async function mintSpawnRing(prisma, character, role, { turnNumber = null } = {}) {
  if (!role?.ringSpawns) return null;
  const initials = initialsOf(character.name) ?? "?";
  const ring = await createRingRow(prisma, character, spawnRingShape(role, initials));
  const account = await openAccount(prisma, character, {
    accountClass: role.bankAccountClass ?? undefined,
    turnNumber,
  });
  return prisma.$transaction(async (tx) => {
    const registered = await registerRing(tx, ring, {
      roleSlugs: [role.slug],
      roles: [role],
      bankAccountId: account?.id ?? null,
    });
    await addToStack(tx, character.id, ring.id, 1, {});
    await tx.characterTag.update({
      where: { characterId_tagId: { characterId: character.id, tagId: ring.id } },
      data: { equipped: true, equippedQuantity: 1 },
    });
    return registered;
  });
}

// Forgery's one craft now: a wax stamp pressed from an office's signet ring the
// forger is holding, carrying that ring's mark and label, so it seals exactly as
// the ring would. The only way to get an office's wax seal
// (docs/systemdocs/RINGS.md). A plain ring has no mark and can't be copied.
// Minted on the top-level client for the same reason as a ring; the caller puts
// it in the forger's hands (the craft's own grant).
async function createForgedSeal(db, forgerId, ring) {
  if (!ring?.sealMark) throw new Error("That ring has no seal to copy.");
  const label = sealLabel(ring);
  const group = await db.tagGroup.findUnique({ where: { slug: PAPER_GROUP_SLUG }, select: { id: true } });
  const tag = await createWithRetry(db, (attempt) => ({
    category: TAG_CATEGORY.ITEMS,
    pointCost: 0,
    custom: true,
    ephemeral: true,
    tradeable: true,
    weightLbs: 0,
    stackable: false,
    removable: true,
    purchasable: false,
    purchasableAfterStart: false,
    sprite: "stamp-rd",
    groupId: group?.id ?? null,
    slug: `custom-seal-${String(forgerId ?? "x").slice(-8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${attempt ? `-${attempt}` : ""}`,
    name: fillRingText("forgedSealName", { label }),
    description: fillRingText("forgedSealDescription", { mark: ring.sealMark }),
    sealMark: ring.sealMark,
    sealOffice: ring.sealOffice ?? null,
  }));
  if (!tag) throw new Error("Could not cut the seal.");
  return tag;
}

module.exports = {
  RING_SHAPE,
  createRingRow,
  createForgedSeal,
  registerRing,
  mintSpawnRing,
};
