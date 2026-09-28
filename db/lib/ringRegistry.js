// The Meister's half of Rings.docx, as Meistery.docx left it: "the terminal
// also allows a character to connect a ring in their inventory to a treasury
// account, as long as the ring has not already been connected to an account"
// (docs/systemdocs/MEISTERY.md §5, RINGS.md §6).
//
// A ring the terminal has never seen is registered here: given the doors of
// one or more seats and linked to an account. A ring that was registered once
// and lost its account — the Meister closed it — only gets an account back;
// its doors stay what they were, so closing an account and reconnecting the
// ring can never add a door.
//
// Registering never makes a ring seal. Only an office's own spawned ring does,
// so a smithed ring registered to the Baron's doors opens them and nothing more.
//
// No gate here: db/lib/meisterTerminal.js#connectRing stands at the terminal
// first and hands over who is working it. Returns { ok, ... } or
// { ok: false, error }. Takes `prisma` as a parameter and stays off the barrel.

const { openAccount } = require("./bankAccounts");
const { registerRing } = require("./ringMint");
const { isRing, isRegistered } = require("./rings");
const { groupRoles } = require("./roleGroups");
const { MEISTER_TERMINAL_TEXT: T, fillMeisterText, roleListText } = require("./meisterTerminalText");

function fail(error) {
  return { ok: false, error };
}

// The rings this character is holding that have no account — what the panel offers.
async function connectableRingsHeld(prisma, characterId) {
  const rows = await prisma.characterTag.findMany({
    where: { characterId, tag: { ringOfCharacterId: { not: null }, ringBankAccountId: null } },
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          ringOfCharacterId: true,
          ringInitials: true,
          ringRegisteredAt: true,
          ringRoleSlugs: true,
        },
      },
    },
  });
  const [owners, roles] = await Promise.all([
    prisma.character.findMany({
      where: { id: { in: rows.map((r) => r.tag.ringOfCharacterId) } },
      select: { id: true, name: true, bankAccount: { select: { id: true } } },
    }),
    prisma.role.findMany({
      where: { slug: { in: [...new Set(rows.flatMap((r) => r.tag.ringRoleSlugs ?? []))] } },
      select: { slug: true, name: true },
    }),
  ]);
  const byId = new Map(owners.map((c) => [c.id, c]));
  const roleName = new Map(roles.map((r) => [r.slug, r.name]));
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
      // Registered once already: its doors are fixed, and only an account is asked for.
      registered: Boolean(r.tag.ringRegisteredAt),
      seatNames: (r.tag.ringRoleSlugs ?? []).map((slug) => roleName.get(slug) ?? slug),
    };
  });
}

// The seats a ring can be given — only those whose ring opens something — in
// the picker's own order (court, clergy, cerberon…). A seat whose access needs
// an item in the registrar's hands (`ring.authorised_by`) says so, and is shut
// when they don't hold it; connectRing checks it again.
async function ringSeats(prisma, heldSlugs) {
  const rows = await prisma.role.findMany({
    where: { ringAccessSlugs: { isEmpty: false } },
    orderBy: { sortOrder: "asc" },
    select: { slug: true, name: true, groupSlug: true, ringAuthorisedBy: true },
  });
  const itemNames = new Map(
    (
      await prisma.tag.findMany({
        where: { slug: { in: rows.map((r) => r.ringAuthorisedBy).filter(Boolean) } },
        select: { slug: true, name: true },
      })
    ).map((t) => [t.slug, t.name]),
  );
  const held = heldSlugs ?? new Set();
  return groupRoles(rows)
    .flatMap((g) => g.roles)
    .map(({ slug, name, ringAuthorisedBy }) => ({
      slug,
      name,
      needs: ringAuthorisedBy ? (itemNames.get(ringAuthorisedBy) ?? ringAuthorisedBy) : null,
      allowed: !ringAuthorisedBy || held.has(ringAuthorisedBy),
    }));
}

// Which account the ring is to reach: "new" opens (or reuses) the engraved
// person's own; otherwise an account by id, or by fingerprint (Discord asks
// for one typed).
async function pickAccount(prisma, ring, { accountId, fingerprint, newAccount, turn }) {
  if (newAccount) {
    const owner = await prisma.character.findUnique({
      where: { id: ring.ringOfCharacterId },
      select: { id: true, name: true, bankAccount: true },
    });
    if (!owner) return fail(T.registerOwnerGone);
    return { ok: true, account: owner.bankAccount ?? (await openAccount(prisma, owner, { turnNumber: turn?.number ?? null })) };
  }
  if (fingerprint) {
    const account = await prisma.bankAccount.findUnique({
      where: { fingerprint: String(fingerprint).trim().toUpperCase() },
    });
    return account ? { ok: true, account } : fail(T.noSuchFingerprint);
  }
  const account = await prisma.bankAccount.findUnique({ where: { id: String(accountId ?? "") } });
  return account ? { ok: true, account } : fail(T.noAccount);
}

async function connectRing(
  prisma,
  {
    registrar,
    heldSlugs,
    discordUserId,
    ringTagId,
    roleSlugs: rawRoles,
    accountId = null,
    fingerprint = null,
    newAccount = false,
    turn = null,
  },
) {
  const held = await prisma.characterTag.findFirst({
    where: { characterId: registrar.id, tagId: String(ringTagId ?? "") },
    select: { tag: true },
  });
  if (!held || !isRing(held.tag)) return fail(T.registerNone);
  const ring = held.tag;
  if (ring.ringBankAccountId) return fail(T.registerAlready);
  const firstTime = !isRegistered(ring);

  // Seats only for a ring the terminal has never seen. A reconnected ring
  // keeps the doors it has.
  let wanted = [];
  let roles = [];
  if (firstTime) {
    wanted = [...new Set((Array.isArray(rawRoles) ? rawRoles : []).map(String))];
    roles = await prisma.role.findMany({
      where: { slug: { in: wanted } },
      select: { slug: true, name: true, ringAccessSlugs: true, ringSealOffice: true, ringAuthorisedBy: true },
    });
    if (roles.length !== wanted.length) return fail(T.registerNoSeat);

    // Some seats' access is only the office's to hand out: registering a ring
    // to the Merchant's needs his License in the registrar's hands, the
    // Baron's his Scepter (`ring.authorised_by` in docs/roles.yaml).
    const gated = roles.filter((r) => r.ringAuthorisedBy);
    const missing = gated.find((r) => !(heldSlugs ?? new Set()).has(r.ringAuthorisedBy));
    if (missing) {
      const item = await prisma.tag.findUnique({ where: { slug: missing.ringAuthorisedBy }, select: { name: true } });
      return fail(fillMeisterText("registerNeedsAuth", { role: missing.name, item: item?.name ?? missing.ringAuthorisedBy }));
    }
  }

  const picked = await pickAccount(prisma, ring, { accountId, fingerprint, newAccount, turn });
  if (!picked.ok) return picked;
  const account = picked.account;

  try {
    await prisma.$transaction(async (tx) => {
      // Compare-and-swap on the account: two clicks, or two terminals, must
      // not connect one ring twice — nor register it twice with different doors.
      const { count } = await tx.tag.updateMany({
        where: { id: ring.id, ringBankAccountId: null, ringRegisteredAt: firstTime ? null : { not: null } },
        data: { ringBankAccountId: account.id },
      });
      if (!count) throw Object.assign(new Error(T.registerAlready), { userMessage: T.registerAlready });
      if (firstTime) {
        await registerRing(tx, { ...ring, ringRegisteredAt: new Date() }, {
          roleSlugs: wanted,
          roles,
          bankAccountId: account.id,
        });
      }
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "ring_registered",
          targetCharacterId: ring.ringOfCharacterId,
          turnId: turn?.id ?? null,
          details: {
            ringTagId: ring.id,
            ringName: ring.name,
            roleSlugs: firstTime ? wanted : (ring.ringRoleSlugs ?? []),
            accountId: account.id,
            fingerprint: account.fingerprint,
            registeredBy: registrar.id,
            reconnected: !firstTime,
          },
        },
      });
    });
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    throw err;
  }

  let line;
  if (!firstTime) line = fillMeisterText("registerDoneAccount", { name: account.holderName });
  else if (roles.length) line = fillMeisterText("registerDone", { roles: roleListText(roles.map((r) => r.name)) });
  else line = T.registerDoneNone;

  // Whoever holds the ring, since a ring worn while it was registered opens
  // new doors at once.
  return { ok: true, characterId: registrar.id, line };
}

module.exports = { connectableRingsHeld, ringSeats, connectRing };
