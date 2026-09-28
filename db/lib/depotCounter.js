// The Depot's fixtures, as both faces work them.
//
// The ATM (the infoterminal) and the Merchant's gun are fixtures on walls
// (db/lib/placeAffordances.js), so each is reachable from Chat's place panel
// AND from a button on a Discord room post. The ATM stands in more places than
// the Depot — the Inn's bar, the Den's — which is why the gate below takes a
// place rather than assuming one. The drop box that stood beside them, and the
// /depot page's gate, went with the Depot Overhaul; the Merchant's Terminal
// is db/lib/merchantTerminal.js. That is why the money lives here
// rather than in the web's server actions: two faces, one set of rules, the
// db/lib bargain CLAUDE.md sets out.
//
// Everything below returns `{ ok: false, error }` rather than throwing, the
// db/lib/dmAnswer.js convention — the web turns that into a UserError and
// Discord answers with it verbatim, so a refusal reads the same in both places.
//
// Takes `prisma` as a parameter rather than requiring db/index.js back
// (db/lib/dm.js convention), and is deliberately NOT on the barrel: require it
// by path. See docs/systemdocs/DEPOT.md §0g.

const {
  DEPOT_LOCATION_SLUG,
  ATM_LOCATION_SLUGS,
  MERCHANT_LICENSE_SLUG,
  MEISTERS_OFFICE_ROOM_SLUG,
  TOWER_LOCATION_SLUG,
} = require("./depot");
const { DEPOT_KEYCARD_SLUG, loadDepot } = require("./depotState");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { MERCHANTS_OFFICE_ROOM_SLUG } = require("./train");
const {
  ARM_WORD,
  DISARM_WORD,
  turretWordMatches,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
} = require("./gatehouseTurret");
const {
  bumpBankAccount,
  vaultAndCoin,
  vaultObols,
  takeFromVault,
  accountBalance,
  vaultBacked,
  isCrown,
} = require("./bankAccounts");
const { addToStack, dropCharacterTag, addToRoomStack } = require("./tagWrites");
const { COMPANY, characterParty, roomParty, bankParty, turnStamp } = require("./economyLedger");
const { blockerFor, ACT } = require("./incapacitation");
const { accessSlugsOf, wornRing, isRegistered } = require("./rings");
const { RING_TEXT } = require("./ringText");
const { SCRAMBLING_TAG_SLUGS } = require("./memoryScramble");
const { ensurePin } = require("./acquaintances");

function fail(error) {
  return { ok: false, error };
}

// Who may work a counter: a living character, able to act, standing at the
// Depot. Loaded fresh every time — a dialog and a Discord modal both outlive
// somebody walking out of the room, which is the whole reason nothing here
// trusts what it was opened with.
//
// `where` widens that last clause for the ATM functions, and only those: a
// cash machine stands in the Inn's bar as well as at the Depot
// (db/lib/depot.js#ATM_LOCATION_SLUGS), but the transfer window and the gun
// are Depot business and stay there. Default is the Depot alone.
const AT_THE_DEPOT = { places: null, name: "the Depot" };
const AT_AN_ATM = { places: ATM_LOCATION_SLUGS, name: "an infoterminal" };

// Whose account the terminal opens (docs/systemdocs/RINGS.md). An infoterminal
// reads the signet ring on your finger, never your face: no ring, no account,
// and a stolen one opens the account it was registered to — but only for the
// account's PIN. The holder types it too while Concussed or Amnesiac, when the
// number won't come to them (docs/systemdocs/MEMORIES.md). Otherwise the PIN is
// entered for you, which is the whole point of the ring.
//
// Returns { ok, account } or { ok: false, error, pinNeeded?, pinPrompt? }. A
// caller drawing a dialog shows pinPrompt beside a PIN box and asks again with
// the PIN; a caller moving money just refuses with the error.
async function terminalAccount(prisma, character, { pin = null } = {}) {
  const ring = wornRing(character.tags);
  if (!ring) return fail(RING_TEXT.infoterminalNoRing);
  if (!isRegistered(ring) || !ring.ringBankAccountId) return fail(RING_TEXT.infoterminalUnregistered);
  const account = await prisma.bankAccount.findUnique({
    where: { id: ring.ringBankAccountId },
    include: { character: { select: { id: true, pin: true } } },
  });
  if (!account) return fail(RING_TEXT.infoterminalUnregistered);

  const own = account.characterId === character.id;
  const forgot = (character.tags ?? []).some((ct) => SCRAMBLING_TAG_SLUGS.includes(ct.tag?.slug));
  if (own && !forgot) return { ok: true, account };

  const pinPrompt = own ? RING_TEXT.infoterminalPinForgot : RING_TEXT.infoterminalPinStranger;
  const typed = String(pin ?? "").trim();
  if (!typed) return { ok: false, error: pinPrompt, pinNeeded: true, pinPrompt };
  // A holder from before PINs existed gets one now, so the number can be learned at all.
  let holderPin = account.character?.pin ?? null;
  if (!holderPin && account.characterId) {
    await ensurePin(prisma, account.characterId);
    holderPin = (await prisma.character.findUnique({ where: { id: account.characterId }, select: { pin: true } }))?.pin ?? null;
  }
  if (!holderPin || typed !== holderPin) {
    return { ok: false, error: RING_TEXT.infoterminalWrongPin, pinNeeded: true, pinPrompt };
  }
  return { ok: true, account };
}

async function counterActor(prisma, discordUserId, where = AT_THE_DEPOT) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    include: {
      tags: { include: { tag: true } },
      location: { select: { slug: true, id: true } },
      bankAccount: true,
    },
  });
  if (!character) return fail("You don't have a living character.");
  const places = where.places ?? new Set([DEPOT_LOCATION_SLUG]);
  if (!places.has(character.location?.slug)) {
    return fail(`You're not standing at ${where.name}.`);
  }
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(`You can't act — you're ${blocker.name}.`);

  // A worn ring carries the Depot keycard for its seat (docs/systemdocs/RINGS.md).
  const held = accessSlugsOf(character.tags);
  return {
    ok: true,
    character,
    held,
    licensed: held.has(MERCHANT_LICENSE_SLUG),
    keycard: held.has(DEPOT_KEYCARD_SLUG),
  };
}

// What the infoterminal dialog draws against, in one read.
//
// The account is the worn ring's (terminalAccount), withheld until the PIN is
// typed when one is needed — `pinNeeded` and `pinPrompt` say so, and
// `accountProblem` says why there is none at all.
async function counterState(prisma, discordUserId, { pin = null } = {}) {
  const actor = await counterActor(prisma, discordUserId, AT_AN_ATM);
  if (!actor.ok) return actor;
  const { character, held, licensed, keycard } = actor;

  const { coin } = await vaultAndCoin(prisma);
  const depot = await loadDepot(prisma);
  const access = await terminalAccount(prisma, character, { pin });
  const account = access.ok ? access.account : null;

  const heldObols = coin
    ? ((
        await prisma.characterTag.findUnique({
          where: { characterId_tagId: { characterId: character.id, tagId: coin.id } },
          select: { quantity: true },
        })
      )?.quantity ?? 0)
    : 0;

  return {
    ok: true,
    account: account
      ? {
          fingerprint: account.fingerprint,
          class: account.class,
          // The Crown's is the Vault itself, read fresh (bankAccounts.js#accountBalance).
          balanceObols: await accountBalance(prisma, account),
          backed: vaultBacked(account),
          crown: isCrown(account),
          own: account.characterId === character.id,
        }
      : null,
    accountProblem: access.ok ? null : access.error,
    pinNeeded: Boolean(access.pinNeeded),
    pinPrompt: access.pinPrompt ?? null,
    heldObols,
    // Send is the Depot's own (bankSend keeps the bare Depot gate), so the
    // picker is only filled in standing there. The Vault is the dialog's own row.
    sendTo:
      account && character.location?.slug === DEPOT_LOCATION_SLUG
        ? await sendableAccounts(prisma, character.id)
        : null,
    turretArmed: depot.turretArmed,
    licensed,
    keycard,
    held: [...held],
  };
}

// There is no opening an account at a terminal any more. A seat's account
// opens at creation (docs/roles.yaml's `bank_account:`) and its ring is linked
// to it; everybody else has a ring smithed and the Meister opens one when he
// registers it (docs/systemdocs/RINGS.md).

// The ATM. A claim on one side, coins on the other.
//
// For a TREASURY account the coins are REAL and come out of the Keep's Vault,
// so a withdrawal the Vault cannot cover is refused rather than clamped — the
// claim is only worth what is behind it. An OFFSHORE account skips the Vault
// entirely: that money is held off-world.
//
// The CROWN account (the Baron's) has no claim to move. Its balance is the
// Vault, so a withdrawal is coin off the pile and a deposit is coin back on
// it, with no account row touched either way — as much as the Vault holds,
// whenever the ring and PIN say so.
async function bankMove(prisma, discordUserId, { direction, amount: rawAmount, pin = null, turn = null } = {}) {
  const actor = await counterActor(prisma, discordUserId, AT_AN_ATM);
  if (!actor.ok) return actor;
  const { character } = actor;
  const access = await terminalAccount(prisma, character, { pin });
  if (!access.ok) return access;
  const account = access.account;

  const withdrawing = direction !== "DEPOSIT";
  const amount = Math.trunc(Number(rawAmount));
  if (!Number.isInteger(amount) || amount < 1) return fail("That isn't an amount.");

  const crown = isCrown(account);
  if (withdrawing) {
    const holds = await accountBalance(prisma, account);
    if (holds < amount) return fail(crown ? `The Vault holds ${holds} ¢.` : `Your account holds ${holds} ¢.`);
  }

  const { room: vault, coin } = await vaultAndCoin(prisma);
  if (!coin) return fail("The obol isn't in the catalog yet. A GM needs to run the tag sync.");
  const backed = vaultBacked(account);
  if (backed && !vault) return fail("The treasury isn't in the database yet. A GM needs to run the zone sync.");

  if (!withdrawing) {
    const holding = await prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: coin.id } },
      select: { quantity: true },
    });
    if ((holding?.quantity ?? 0) < amount) return fail(`You're carrying ${holding?.quantity ?? 0} ¢.`);
  }

  const me = characterParty(character);
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;
  const reason = withdrawing ? "BANK_WITHDRAWAL" : "BANK_DEPOSIT";
  const stamp = turnStamp(turn);

  try {
    await prisma.$transaction(async (tx) => {
      // ROOM LOCK FIRST, ALWAYS, then the account. tagWrites.js#dropRoomTag
      // takes the room lock first, so taking them the other way round here
      // would deadlock a deposit against a withdrawal.
      if (backed) await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${vault.id} FOR UPDATE`;

      // The Crown's balance is the pile itself, read under the room lock just
      // taken; the coin moving below is the whole transaction. takeFromVault
      // still refuses a short Vault, so a race with another withdrawal cannot
      // pay out coin that is not there.
      let moved;
      if (crown) {
        const before = await vaultObols(tx);
        const delta = withdrawing ? -amount : amount;
        moved = { before, after: before + delta, delta };
      } else {
        moved = await bumpBankAccount(tx, account.id, withdrawing ? -amount : amount, {
          holderName: account.holderName,
          econ: { reason, ...stamp },
        });
        if (Math.abs(moved.delta) < amount) {
          const err = new Error("Your account was edited. Try again.");
          err.userMessage = err.message;
          throw err;
        }
      }

      if (withdrawing) {
        // The Vault pays out FIRST, so a short Vault throws before any coin is
        // minted into somebody's hand — and rolls the debit back with it.
        if (backed) await takeFromVault(tx, amount, { coin, room: vault });
        await addToStack(tx, character.id, coin.id, amount, {
          source: "EVENT",
          stackable: true,
          econ: { from: backed ? vaultParty : COMPANY, to: me, reason, ...stamp },
        });
      } else {
        await dropCharacterTag(tx, character.id, coin.id, amount, {
          econ: { from: me, to: backed ? vaultParty : COMPANY, reason, ...stamp },
        });
        if (backed) {
          // The coin leg is already booked by the drop above; booking it again
          // here would count the same movement twice.
          await addToRoomStack(tx, vault.id, coin.id, amount, { econ: { reason, ...stamp } });
        }
      }

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "request_depot_atm",
          targetCharacterId: character.id,
          turnId: turn?.id ?? null,
          details: {
            direction: withdrawing ? "WITHDRAW" : "DEPOSIT",
            amount,
            balanceBefore: moved.before,
            balanceAfter: moved.after,
            backed,
            // The balances above are the Vault's own pile when this is set.
            ...(crown ? { crown: true } : {}),
            fingerprint: account.fingerprint,
            // Whose account it was — a ring on the wrong finger reaches somebody else's.
            ...(account.characterId !== character.id ? { accountHolderId: account.characterId } : {}),
          },
        },
      });
    });
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    throw err;
  }

  return {
    ok: true,
    direction: withdrawing ? "WITHDRAW" : "DEPOSIT",
    amount,
    characterId: character.id,
    line: withdrawing ? `You take ${amount} ¢ out.` : `You put ${amount} ¢ in.`,
  };
}

// Paying somebody by account, or handing the claim back to the Keep.
//
// Nothing physical moves either way, which is what makes this simple: no coin
// leaves anybody's hands, the Vault's stash is untouched, and so the room-lock
// rule in db/lib/bankAccounts.js does not apply. Two account rows are locked
// instead, and they are taken in id order so two people paying each other at
// once cannot deadlock on one another.
//
// The treasury is a ROOM, not an account (docs/systemdocs/ECONOMY.md §2), so
// sending to it SURRENDERS the claim: the balance falls and the coin behind it
// stays where it was. The Keep ends up better backed rather than richer, which
// is the only honest thing a claim can do when it has nowhere to be paid into.
//
// The Crown's account (the Baron's) is the Vault, so it works both ways round.
// Sending FROM it creates a claim: the payee's balance rises and the coin stays
// on the pile until they come for it, so the Crown's own balance does not fall
// — which is how a Baron pays wages by transfer, and how a Baron who pays too
// many ends up with a bank run. Sending TO it is sending to the treasury: the
// payer's claim is surrendered and nothing is credited, because the Crown's
// balance is the pile and the pile has not changed.
async function bankSend(prisma, discordUserId, { toAccountId, toTreasury = false, amount: rawAmount, pin = null, turn = null } = {}) {
  const actor = await counterActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const access = await terminalAccount(prisma, character, { pin });
  if (!access.ok) return access;
  const account = access.account;
  const fromCrown = isCrown(account);

  const amount = Math.trunc(Number(rawAmount));
  if (!Number.isInteger(amount) || amount < 1) return fail("That isn't an amount.");
  const holds = await accountBalance(prisma, account);
  if (holds < amount) return fail(fromCrown ? `The Vault holds ${holds} ¢.` : `Your account holds ${holds} ¢.`);

  const { room: vault } = await vaultAndCoin(prisma);
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;

  let target = null;
  let otherParty = null;
  if (toTreasury) {
    if (!vault) return fail("The treasury isn't in the database yet. A GM needs to run the zone sync.");
    if (fromCrown) return fail("That money is already in the Vault.");
    otherParty = vaultParty;
  } else {
    target = await prisma.bankAccount.findUnique({ where: { id: String(toAccountId ?? "") } });
    if (!target) return fail("There's no account with that name.");
    if (target.id === account.id) return fail("That's your own account.");
    if (fromCrown && isCrown(target)) return fail("That money is already in the Vault.");
    if (isCrown(target) && !vault) return fail("The treasury isn't in the database yet. A GM needs to run the zone sync.");
    // Paying the Crown hands the claim back to the Vault, so the ledger names the Vault.
    otherParty = isCrown(target) ? vaultParty : bankParty(target);
  }
  const toCrown = Boolean(target && isCrown(target));

  const econ = { other: otherParty, reason: "BANK_TRANSFER", ...turnStamp(turn) };

  try {
    await prisma.$transaction(async (tx) => {
      // Id order, both sides, so two sends crossing each other queue rather
      // than deadlock. The debit's own check comes after both have moved.
      // ONE ledger entry for the whole movement, booked off the payer's side:
      // from this account to the other, which is what both accounts' sums read
      // (ECONOMY.md §3). The credit takes no ctx at all — booking it again from
      // the far side would count the same 30 ¢ twice and leave the invariant
      // reading double on both books.
      //
      // The Crown is never bumped: from it, the payee's credit is the only leg
      // and books the claim as issued by the Vault; to it, the payer's debit is
      // the only leg, the same as sending to the treasury.
      let legs;
      if (fromCrown) {
        legs = [
          {
            id: target.id,
            holderName: target.holderName,
            delta: amount,
            ctx: { holderName: target.holderName, econ: { ...econ, other: vaultParty } },
          },
        ];
      } else if (target && !toCrown) {
        legs = [
          { id: account.id, holderName: account.holderName, delta: -amount, ctx: { holderName: account.holderName, econ } },
          { id: target.id, holderName: target.holderName, delta: amount, ctx: null },
        ].sort((a, b) => (a.id < b.id ? -1 : 1));
      } else {
        legs = [{ id: account.id, holderName: account.holderName, delta: -amount, ctx: { holderName: account.holderName, econ } }];
      }

      const moved = {};
      for (const leg of legs) {
        moved[leg.id] = await bumpBankAccount(tx, leg.id, leg.delta, leg.ctx);
      }

      // The clamp inside bumpBankAccount is a FLOOR, never a check: a balance
      // edited between the read above and here would pay out less than it
      // said, so refuse the whole thing rather than move a short amount.
      if (!fromCrown && Math.abs(moved[account.id].delta) < amount) {
        const err = new Error("Your account was edited. Try again.");
        err.userMessage = err.message;
        throw err;
      }
      // The Crown's side of the audit row is the pile, which a send never moves.
      if (fromCrown) moved[account.id] = { before: holds, after: holds, delta: 0 };

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "request_depot_send",
          targetCharacterId: character.id,
          turnId: turn?.id ?? null,
          details: {
            amount,
            balanceBefore: moved[account.id].before,
            balanceAfter: moved[account.id].after,
            toTreasury: Boolean(toTreasury),
            // A send from the Crown issues a claim; one to the Crown surrenders it.
            ...(fromCrown ? { fromCrown: true } : {}),
            ...(toCrown ? { toCrown: true } : {}),
            // Snapshots, the log-table convention: the row has to keep reading
            // correctly after a holder is renamed or an account is closed.
            toName: target?.holderName ?? null,
            toFingerprint: target?.fingerprint ?? null,
          },
        },
      });
    });
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    throw err;
  }

  return {
    ok: true,
    amount,
    characterId: character.id,
    line: toTreasury ? `You send ${amount} ¢ to the treasury.` : `You send ${amount} ¢ to ${target.holderName}.`,
  };
}

// Who you may send to. Name and id only — a fingerprint half-tells you whose
// an account is (db/lib/bankAccounts.js), and the picker has no business
// handing that out, nor a balance, nor whether somebody banks offshore.
async function sendableAccounts(prisma, characterId) {
  const rows = await prisma.bankAccount.findMany({
    // The living only: a dead holder's account is still a row, and offering it
    // in a picker both names the dead and pays into nothing.
    where: { characterId: { not: characterId }, character: { status: "ALIVE" } },
    select: { id: true, holderName: true },
    orderBy: { holderName: "asc" },
  });
  return rows.filter((r) => r.holderName);
}

// The gun's switch, on the Merchant's Office wall. The state is RE-READ at
// submit, so two people in the office at once cannot both throw it the same
// way, and the word they were asked to type is what says which way they meant.
async function depotTurretPanel(prisma, discordUserId) {
  const actor = await counterActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  if (!actor.licensed) return fail("You don't have the Merchant's License.");

  const office = await prisma.room.findUnique({
    where: { slug: MERCHANTS_OFFICE_ROOM_SLUG },
    select: { id: true, locationId: true },
  });
  if (!office || office.locationId !== actor.character.locationId) return fail("There's no button here.");

  const depot = await loadDepot(prisma);
  return {
    ok: true,
    armed: depot.turretArmed,
    word: depot.turretArmed ? DISARM_WORD : ARM_WORD,
    hasFace: Boolean(String(depot.merchantFace ?? "").trim()),
  };
}

async function toggleDepotTurret(prisma, discordUserId, { word, turn = null } = {}) {
  const panel = await depotTurretPanel(prisma, discordUserId);
  if (!panel.ok) return panel;
  const actor = await counterActor(prisma, discordUserId);
  if (!actor.ok) return actor;

  if (!turretWordMatches(word, panel.armed)) return fail("You leave the button alone.");
  const next = !panel.armed;

  // With no face on file it fires on EVERYONE, this Merchant included, and
  // disarming needs you standing here — so arming is refused rather than
  // offered as a one-click suicide with a GM-only cure.
  if (next && !panel.hasFace) {
    return fail("There's no face on file — it would shoot everyone, you included.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.depot.update({ where: { id: 1 }, data: { turretArmed: next } });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "depot_turret_toggled",
        targetCharacterId: actor.character.id,
        turnId: turn?.id ?? null,
        details: { armed: next, characterId: actor.character.id, characterName: actor.character.name },
      },
    });
  });

  return {
    ok: true,
    armed: next,
    locationId: actor.character.locationId,
    // The room's only warning, and the Censor's gun's own two lines rather than
    // a second pair — see db/lib/gatehouseTurret.js. The caller speaks it: a
    // REST call has no business inside the transaction above.
    ambient: (next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE).text,
    line: next ? "The button toggles on." : "The button toggles off.",
  };
}

// Who may read /treasury: somebody standing in the Keep who can get through the
// Meister's office door. ONE predicate, because the page, the action behind its
// one control and the nav rail all ask it and must not drift — the rail showing
// an item that redirects is worse than no item.
//
// The door's keys are read off the Room's own accessTagSlugs rather than named
// here, so re-keying the office in docs/zones.yaml moves the gate with it.
async function canReadTreasury(prisma, discordUserId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, location: { select: { slug: true } } },
  });
  if (!character) return { ok: false, error: "You don't have a living character." };
  if (character.location?.slug !== TOWER_LOCATION_SLUG) {
    return { ok: false, error: "The terminal is in the Meister's office." };
  }

  const room = await prisma.room.findUnique({
    where: { slug: MEISTERS_OFFICE_ROOM_SLUG },
    select: { id: true, kind: true, accessTagSlugs: true },
  });
  if (!room) return { ok: false, error: "The Meister's office isn't in the database yet." };

  const keys = await roomAccessKeys(prisma, character.id);
  if (!accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length) {
    return { ok: false, error: "The office is locked." };
  }
  return { ok: true, character };
}

module.exports = {
  canReadTreasury,
  counterActor,
  counterState,
  terminalAccount,
  bankMove,
  bankSend,
  sendableAccounts,
  depotTurretPanel,
  toggleDepotTurret,
};
