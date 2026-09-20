// The Depot's counter, as both faces work it.
//
// The ATM, the drop box and the Merchant's gun are fixtures on walls
// (db/lib/placeAffordances.js), so each is reachable from Chat's place panel
// AND from a button on a Discord room post. The ATM is the only one of the
// three that stands anywhere but the Depot — there is a second machine in the
// Inn's bar, which is why the gate below takes a place rather than assuming
// one. That is why the money lives here
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
const { openAccount, bumpBankAccount, vaultAndCoin, takeFromVault, TREASURY } = require("./bankAccounts");
const { addToStack, dropCharacterTag, addToRoomStack } = require("./tagWrites");
const { COMPANY, characterParty, roomParty, bankParty, turnStamp } = require("./economyLedger");
const { blockerFor, ACT } = require("./incapacitation");

const DESTINATIONS = new Set(["SELF", "TREASURY", "MERCHANT"]);

function fail(error) {
  return { ok: false, error };
}

// Who may work a counter: a living character, able to act, standing at the
// Depot. Loaded fresh every time — a dialog and a Discord modal both outlive
// somebody walking out of the room, which is the whole reason nothing here
// trusts what it was opened with.
//
// `where` widens that last clause for the three ATM functions, and only those
// three: a cash machine now stands in the Inn's bar as well as on the counter
// (db/lib/depot.js#ATM_LOCATION_SLUGS), but ordering, selling, the drop box,
// the transfer window and the gun are all counter business and stay at the
// Depot. Default is the Depot alone, so a function that says nothing is gated
// exactly as it was before there were two machines.
const AT_THE_DEPOT = { places: null, name: "the Depot" };
const AT_AN_ATM = { places: ATM_LOCATION_SLUGS, name: "an ATM" };

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

  const held = new Set(character.tags.map((ct) => ct.tag.slug));
  return {
    ok: true,
    character,
    held,
    licensed: held.has(MERCHANT_LICENSE_SLUG),
    keycard: held.has(DEPOT_KEYCARD_SLUG),
  };
}

// How much coin is in a room's stash right now.
async function roomCoin(prisma, roomId, coinId) {
  if (!roomId || !coinId) return 0;
  const row = await prisma.roomTag.findUnique({
    where: { roomId_tagId: { roomId, tagId: coinId } },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

// Everything the three dialogs draw against, in one read, so there is a single
// answer to "what is a counter" rather than three that can disagree. Answers at
// an ATM as well as at the counter, since the ATM dialog draws against it; the
// sell and drop-box fields it also carries simply go undrawn at the Inn, and
// every write behind them keeps its own Depot gate.
async function counterState(prisma, discordUserId) {
  const actor = await counterActor(prisma, discordUserId, AT_AN_ATM);
  if (!actor.ok) return actor;
  const { character, held, licensed, keycard } = actor;

  const { room: vault, coin } = await vaultAndCoin(prisma);
  const depot = await loadDepot(prisma);
  const account = character.bankAccount;

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
          balanceObols: account.balanceObols,
          backed: account.class === TREASURY,
        }
      : null,
    heldObols,
    vaultObols: await roomCoin(prisma, vault?.id, coin?.id),
    sellable: character.tags
      .filter((ct) => ct.tag.sellablePrice != null && ct.quantity > 0)
      .map((ct) => ({ tagId: ct.tagId, name: ct.tag.name, quantity: ct.quantity, unitPrice: ct.tag.sellablePrice })),
    sellTaxRate: depot.sellTaxRate ?? 0,
    turretArmed: depot.turretArmed,
    licensed,
    keycard,
    canSellToMerchant: licensed || keycard,
    // The Merchant and his Dockers sell into his books by default; everyone
    // else into their own. A seed for the next drop, never a stored setting.
    defaultDestination: licensed || keycard ? "MERCHANT" : "SELF",
    held: [...held],
  };
}

// Opening one. Everybody with a town seat is given one at creation
// (docs/roles.yaml's `bank_account:`); this is for everybody else, and it costs
// nothing, takes one click, and opens EMPTY.
async function openCounterAccount(prisma, discordUserId, { turnNumber = null, turnId = null } = {}) {
  const actor = await counterActor(prisma, discordUserId, AT_AN_ATM);
  if (!actor.ok) return actor;
  if (actor.character.bankAccount) return fail("You already have an account here.");

  const row = await prisma.$transaction(async (tx) => {
    const account = await openAccount(tx, actor.character, { turnNumber });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "request_depot_account_open",
        targetCharacterId: actor.character.id,
        turnId,
        details: { fingerprint: account.fingerprint, class: account.class },
      },
    });
    return account;
  });

  return { ok: true, fingerprint: row.fingerprint, line: `Account ${row.fingerprint} is open.` };
}

// The ATM. A claim on one side, coins on the other.
//
// For a TREASURY account the coins are REAL and come out of the Keep's Vault,
// so a withdrawal the Vault cannot cover is refused rather than clamped — the
// claim is only worth what is behind it. An OFFSHORE account skips the Vault
// entirely: that money is held off-world.
async function bankMove(prisma, discordUserId, { direction, amount: rawAmount, turn = null } = {}) {
  const actor = await counterActor(prisma, discordUserId, AT_AN_ATM);
  if (!actor.ok) return actor;
  const { character } = actor;
  const account = character.bankAccount;
  if (!account) return fail("You don't have an account yet.");

  const withdrawing = direction !== "DEPOSIT";
  const amount = Math.trunc(Number(rawAmount));
  if (!Number.isInteger(amount) || amount < 1) return fail("That isn't an amount.");

  if (withdrawing && (account.balanceObols ?? 0) < amount) {
    return fail(`Your account holds ${account.balanceObols ?? 0} ¢.`);
  }

  const { room: vault, coin } = await vaultAndCoin(prisma);
  if (!coin) return fail("The obol isn't in the catalog yet. A GM needs to run the tag sync.");
  const backed = account.class === TREASURY;
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

      const moved = await bumpBankAccount(tx, account.id, withdrawing ? -amount : amount, {
        holderName: account.holderName,
        econ: { reason, ...stamp },
      });
      if (Math.abs(moved.delta) < amount) {
        const err = new Error("Your account was edited. Try again.");
        err.userMessage = err.message;
        throw err;
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
            fingerprint: account.fingerprint,
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
async function bankSend(prisma, discordUserId, { toAccountId, toTreasury = false, amount: rawAmount, turn = null } = {}) {
  const actor = await counterActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const account = character.bankAccount;
  if (!account) return fail("You don't have an account yet.");

  const amount = Math.trunc(Number(rawAmount));
  if (!Number.isInteger(amount) || amount < 1) return fail("That isn't an amount.");
  if ((account.balanceObols ?? 0) < amount) return fail(`Your account holds ${account.balanceObols ?? 0} ¢.`);

  let target = null;
  let otherParty = null;
  if (toTreasury) {
    const { room: vault } = await vaultAndCoin(prisma);
    if (!vault) return fail("The treasury isn't in the database yet. A GM needs to run the zone sync.");
    otherParty = roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null });
  } else {
    target = await prisma.bankAccount.findUnique({ where: { id: String(toAccountId ?? "") } });
    if (!target) return fail("There's no account with that name.");
    if (target.id === account.id) return fail("That's your own account.");
    otherParty = bankParty(target);
  }

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
      const legs = target
        ? [
            { id: account.id, holderName: account.holderName, delta: -amount, ctx: { holderName: account.holderName, econ } },
            { id: target.id, holderName: target.holderName, delta: amount, ctx: null },
          ].sort((a, b) => (a.id < b.id ? -1 : 1))
        : [{ id: account.id, holderName: account.holderName, delta: -amount, ctx: { holderName: account.holderName, econ } }];

      const moved = {};
      for (const leg of legs) {
        moved[leg.id] = await bumpBankAccount(tx, leg.id, leg.delta, leg.ctx);
      }

      // The clamp inside bumpBankAccount is a FLOOR, never a check: a balance
      // edited between the read above and here would pay out less than it
      // said, so refuse the whole thing rather than move a short amount.
      if (Math.abs(moved[account.id].delta) < amount) {
        const err = new Error("Your account was edited. Try again.");
        err.userMessage = err.message;
        throw err;
      }

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

// The drop box. A one-way door: what goes in is DELETED at once — nothing sits
// in a stash waiting to be stolen back out — and the row it leaves behind
// settles when the train next departs, at the price frozen here.
async function dropIntoBox(prisma, discordUserId, { tagId, quantity: rawQuantity, destination: rawDestination, turn = null } = {}) {
  const actor = await counterActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character, held } = actor;
  const account = character.bankAccount;
  if (!account) return fail("You don't have an account yet.");

  const quantity = Math.trunc(Number(rawQuantity));
  if (!Number.isInteger(quantity) || quantity < 1) return fail("That isn't a quantity.");

  const destination = DESTINATIONS.has(rawDestination) ? rawDestination : "SELF";
  // Selling into the Merchant's books is a job, not a favour: it wants his
  // papers or his keycard. That is the whole of the Docker's seat.
  if (destination === "MERCHANT" && !held.has(MERCHANT_LICENSE_SLUG) && !held.has(DEPOT_KEYCARD_SLUG)) {
    return fail("You don't have the Merchant's License or a Depot Keycard.");
  }

  const tag = await prisma.tag.findUnique({ where: { id: String(tagId ?? "") } });
  if (!tag) return fail("The depot doesn't know what that is.");
  if (tag.sellablePrice == null) return fail(`The depot doesn't buy ${tag.name}.`);

  const holding = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
    select: { quantity: true },
  });
  if ((holding?.quantity ?? 0) < quantity) return fail(`You're only carrying ${holding?.quantity ?? 0}.`);

  const stamp = turnStamp(turn);

  await prisma.$transaction(async (tx) => {
    // The drop IS the sale. dropCharacterTag's own hook books the goods leaving
    // the world; the money arrives at the departure, not here.
    await dropCharacterTag(tx, character.id, tag.id, quantity, {
      econ: { from: characterParty(character), to: COMPANY, reason: "DEPOT_SALE", ...stamp },
    });

    await tx.depotSale.create({
      data: {
        accountId: account.id,
        fingerprint: account.fingerprint,
        holderName: account.holderName,
        destination,
        tagId: tag.id,
        tagName: tag.name,
        quantity,
        unitPrice: tag.sellablePrice,
        droppedTurn: turn?.number ?? 0,
      },
    });

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "request_depot_drop",
        targetCharacterId: character.id,
        turnId: turn?.id ?? null,
        details: {
          tagId: tag.id,
          tagName: tag.name,
          quantity,
          unitPrice: tag.sellablePrice,
          destination,
          fingerprint: account.fingerprint,
        },
      },
    });
  });

  return {
    ok: true,
    tagName: tag.name,
    quantity,
    characterId: character.id,
    line: `${tag.name} ×${quantity} goes into the box.`,
  };
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
  DESTINATIONS,
  canReadTreasury,
  counterActor,
  counterState,
  openCounterAccount,
  bankMove,
  bankSend,
  sendableAccounts,
  dropIntoBox,
  depotTurretPanel,
  toggleDepotTurret,
};
