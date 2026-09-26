// The Meister's half of Rings.docx: a smithed ring is taken to his terminal and
// "put into the database" — given the doors of one or more seats and linked to
// a new or existing treasury account (docs/systemdocs/RINGS.md). The terminal is
// the /treasury desk, gated on standing in the Meister's office like every other
// thing on that desk (depotCounter.js#canReadTreasury), so a Baron who can open
// the door can register a ring too, and a thief who got in can.
//
// Registering never makes a ring seal. Only an office's own spawned ring does, so
// a smithed ring registered to the Baron's doors opens them and nothing more.
//
// Returns { ok, ... } or { ok: false, error }, the depotCounter.js convention.
// Takes `prisma` as a parameter and stays off the barrel.

const { canReadTreasury } = require("./depotCounter");
const { openAccount } = require("./bankAccounts");
const { registerRing } = require("./ringMint");
const { isRing, isRegistered } = require("./rings");
const { RING_TEXT, fillRingText } = require("./ringText");
function fail(error) {
  return { ok: false, error };
}

// "the Baron", "the Baron and the Hand", "the Baron, the Hand and the Meister".
function roleListText(names) {
  const the = names.map((n) => `the ${n}`);
  if (the.length <= 1) return the.join("");
  return `${the.slice(0, -1).join(", ")} and ${the[the.length - 1]}`;
}

// The unregistered rings this character is holding — what the panel offers.
async function unregisteredRingsHeld(prisma, characterId) {
  const rows = await prisma.characterTag.findMany({
    where: { characterId, tag: { ringOfCharacterId: { not: null }, ringRegisteredAt: null } },
    select: { tag: { select: { id: true, name: true, ringOfCharacterId: true, ringInitials: true } } },
  });
  const owners = await prisma.character.findMany({
    where: { id: { in: rows.map((r) => r.tag.ringOfCharacterId) } },
    select: { id: true, name: true, bankAccount: { select: { id: true } } },
  });
  const byId = new Map(owners.map((c) => [c.id, c]));
  return rows.map((r) => {
    const owner = byId.get(r.tag.ringOfCharacterId) ?? null;
    return {
      tagId: r.tag.id,
      name: r.tag.name,
      initials: r.tag.ringInitials ?? "",
      ownerName: owner?.name ?? null,
      // Whether "Open a new account" can mean anything: the engraved person
      // already has one (one per character, BankAccount.characterId), or is gone.
      ownerAccountId: owner?.bankAccount?.id ?? null,
      ownerGone: !owner,
    };
  });
}

async function registerHeldRing(prisma, { discordUserId, ringTagId, roleSlugs: rawRoles, accountId = null, newAccount = false, turn = null }) {
  const gate = await canReadTreasury(prisma, discordUserId);
  if (!gate.ok) return gate;
  const me = gate.character;

  const held = await prisma.characterTag.findFirst({
    where: { characterId: me.id, tagId: String(ringTagId ?? "") },
    select: { tag: true },
  });
  if (!held || !isRing(held.tag)) return fail(RING_TEXT.registerNone);
  if (isRegistered(held.tag)) return fail(RING_TEXT.registerNone);
  const ring = held.tag;

  const wanted = [...new Set((Array.isArray(rawRoles) ? rawRoles : []).map(String))];
  const roles = await prisma.role.findMany({
    where: { slug: { in: wanted } },
    select: { slug: true, name: true, ringAccessSlugs: true, ringSealOffice: true },
  });
  if (roles.length !== wanted.length) return fail("That seat doesn't exist.");

  let account = null;
  if (newAccount) {
    const owner = await prisma.character.findUnique({
      where: { id: ring.ringOfCharacterId },
      select: { id: true, name: true, bankAccount: true },
    });
    if (!owner) return fail("Whoever this ring was made for is gone. Link an existing account.");
    account = owner.bankAccount ?? (await openAccount(prisma, owner, { turnNumber: turn?.number ?? null }));
  } else {
    account = await prisma.bankAccount.findUnique({ where: { id: String(accountId ?? "") } });
    if (!account) return fail("There's no account with that name.");
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-swap on the registration: two clicks, or two terminals, must
    // not register one ring twice with different doors.
    const { count } = await tx.tag.updateMany({
      where: { id: ring.id, ringRegisteredAt: null },
      data: { ringRegisteredAt: new Date() },
    });
    if (!count) {
      const err = new Error(RING_TEXT.registerNone);
      err.userMessage = err.message;
      throw err;
    }
    await registerRing(tx, { ...ring, ringRegisteredAt: new Date() }, {
      roleSlugs: wanted,
      roles,
      bankAccountId: account.id,
    });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "ring_registered",
        targetCharacterId: ring.ringOfCharacterId,
        turnId: turn?.id ?? null,
        details: {
          ringTagId: ring.id,
          ringName: ring.name,
          roleSlugs: wanted,
          accountId: account.id,
          fingerprint: account.fingerprint,
          registeredBy: me.id,
        },
      },
    });
  }).catch((err) => {
    if (err?.userMessage) return { error: err.userMessage };
    throw err;
  });

  const done = await prisma.tag.findUnique({ where: { id: ring.id }, select: { ringRegisteredAt: true, ringBankAccountId: true } });
  if (done?.ringBankAccountId !== account.id) return fail(RING_TEXT.registerNone);

  const names = roleListText(roles.map((r) => r.name));
  return {
    ok: true,
    characterId: me.id,
    line: roles.length ? fillRingText("registerDone", { roles: names }) : RING_TEXT.registerDoneNone,
  };
}

module.exports = { unregisteredRingsHeld, registerHeldRing };
