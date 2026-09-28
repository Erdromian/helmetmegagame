// The Den's slot machine (docs/zones.yaml, undertown-8-3 — the Casino).
//
// Three dice behind a glass front, which is what the Casino's felt table
// already implies. A spin costs 5 ¢ in REAL COIN out of the player's hand, and
// the house is a real person: the Exactor's bank account takes the losses and
// pays the wins, so a good night at the machine costs him and a bad one keeps
// him. That is the whole reason this is not a random-number faucet — there is
// somebody to rob.
//
// Because his account is TREASURY-class, the coin leg goes through the Keep's
// Vault exactly as the infoterminal's does (db/lib/bankAccounts.js): a stake is a
// deposit into his claim, a payout is a withdrawal out of it, and the Vault
// backing stays true. Nothing here mints an obol out of nothing.
//
// The machine REFUSES A SPIN IT COULD NOT PAY OUT ON, before it takes the coins
// — see canPay below. A machine that swallows your five and then cannot hand
// over the jackpot is a con, not a game.
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/depotCounter.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a
// parameter and stays off the @lifeweb/db barrel (db/lib/dm.js); require by path.

const { rollDie } = require("./moveEffects");
const { sceneLineAt } = require("./scene");
const { postMessage } = require("./discordRest");
const { loadPresentedIdentity } = require("./presentedIdentity");
const { openAccount, bumpBankAccount, vaultAndCoin, vaultObols, takeFromVault, TREASURY } = require("./bankAccounts");
const { addToStack, dropCharacterTag, addToRoomStack } = require("./tagWrites");
const { COMPANY, characterParty, roomParty, turnStamp } = require("./economyLedger");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { blockerFor, ACT } = require("./incapacitation");
const { SFX } = require("./sfx");
// The table and the prompt live in their own zero-require file, so Chat's
// dialog can import them without dragging PrismaClient into the browser
// (db/lib/vendingText.js says the same about itself). Re-exported below, so a
// server caller keeps its one import.
const { SLOT_COST, SLOT_PAYOUTS, SLOT_MAX_PAYOUT, SLOT_PROMPT } = require("./slotText");

const CASINO_ROOM_SLUG = "undertown-8-3";

// Whose machine it is. A role slug, not a tag: the seat owns the box, and a
// key changing hands does not make you the house.
const HOUSE_ROLE_SLUG = "exactor";

const RUNS = [
  [1, 2, 3],
  [4, 5, 6],
];

/** "triple" | "run" | "pair" | null, for three die faces in the order they fell. */
function classifyRoll(faces) {
  const sorted = [...faces].sort((a, b) => a - b);
  const [a, b, c] = sorted;
  if (a === b && b === c) return "triple";
  if (RUNS.some((run) => run[0] === a && run[1] === b && run[2] === c)) return "run";
  if (a === b || b === c) return "pair";
  return null;
}

function payoutFor(outcome) {
  return SLOT_PAYOUTS[outcome] ?? 0;
}

/** The cue a result makes, heard by everyone reading the Casino. */
function sfxFor(outcome) {
  if (outcome === "triple") return SFX.SLOT_JACKPOT;
  if (outcome) return SFX.SLOT_WIN;
  return SFX.SLOT_LOSE;
}

// What the room hears. `who` is the identity the room would SEE, never the row
// — a hooded player reads as "A young man" here the same as anywhere else.
function slotLine(who, faces, outcome) {
  const rolled = `${who} rolled ${faces.join("/")}.`;
  const won = payoutFor(outcome);
  if (!won) return `${rolled} Better luck next time.`;
  if (outcome === "triple") return `${rolled} Jackpot! They gained ${won} ¢.`;
  return `${rolled} They gained ${won} ¢.`;
}

function fail(error) {
  return { ok: false, error };
}

// The living Exactor's account, opened if he has one and has never used it.
// No Exactor, or no account, and the machine simply does not run: there is
// nobody to take the money and nobody to pay it.
async function houseAccount(tx) {
  const house = await tx.character.findFirst({
    where: { status: "ALIVE", role: { slug: HOUSE_ROLE_SLUG } },
    select: { id: true, name: true, bankAccount: true },
    orderBy: { createdAt: "asc" },
  });
  if (!house) return null;
  const account = house.bankAccount ?? (await openAccount(tx, house));
  return account ? { house, account } : null;
}

// Alive, able to act, and actually standing in the Casino with the door open.
// Re-loaded on every press — a web dialog and a Discord button both outlive
// somebody walking out of the room.
async function slotActor(prisma, discordUserId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true, locationId: true, tags: { include: { tag: true } } },
  });
  if (!character) return fail("You don't have a living character.");

  const room = await prisma.room.findUnique({
    where: { slug: CASINO_ROOM_SLUG },
    select: { id: true, name: true, slug: true, locationId: true, accessTagSlugs: true, discordThreadId: true },
  });
  if (!room) return fail("There's no slot machine here.");
  if (character.locationId !== room.locationId) return fail("You're not standing in the Den.");

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(`You can't act — you're ${blocker.name}.`);

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail("You can't get in there.");
  }
  return { ok: true, character, room };
}

/**
 * One pull. `turn` is the open Turn row, for the ledger stamp and the audit row.
 * Resolves to { ok, faces, outcome, payout, line, text, sfx } — `line` is what
 * the player is told, `text` what the room reads.
 */
async function playSlots(prisma, discordUserId, { turn = null } = {}) {
  const actor = await slotActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character, room } = actor;

  const { room: vault, coin } = await vaultAndCoin(prisma);
  if (!coin) return fail("The obol isn't in the catalog yet. A GM needs to run the tag sync.");

  const holding = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: coin.id } },
    select: { quantity: true },
  });
  if ((holding?.quantity ?? 0) < SLOT_COST) {
    return fail(`Playing slots costs ${SLOT_COST} ¢ and you're carrying ${holding?.quantity ?? 0} ¢.`);
  }

  const seat = await houseAccount(prisma);
  if (!seat) return fail("The machine's coin box is locked and its owner is nowhere to be found.");
  const backed = seat.account.class === TREASURY;
  if (backed && !vault) return fail("The treasury isn't in the database yet. A GM needs to run the zone sync.");

  // Refuse a spin the house could not settle. Checked against the JACKPOT, not
  // against what this pull happens to roll — the machine either honours its own
  // table or it stays dark. The stake lands first, so it counts toward the pot.
  const pot = (seat.account.balanceObols ?? 0) + SLOT_COST;
  const coinBehindIt = backed ? (await vaultObols(prisma)) + SLOT_COST : Infinity;
  if (pot < SLOT_MAX_PAYOUT || coinBehindIt < SLOT_MAX_PAYOUT) {
    return fail("The machine's hopper is light. It won't take your coins.");
  }

  const faces = [rollDie(6), rollDie(6), rollDie(6)];
  const outcome = classifyRoll(faces);
  const payout = payoutFor(outcome);

  const me = characterParty(character);
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;
  const stamp = turnStamp(turn);
  const econ = { reason: "SLOTS", ...stamp };

  try {
    await prisma.$transaction(async (tx) => {
      // ROOM LOCK FIRST, ALWAYS, then the account — db/lib/tagWrites.js takes
      // the room lock first, and the other order deadlocks against the infoterminal.
      if (backed) await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${vault.id} FOR UPDATE`;

      // The stake: real coin out of a hand, into the Vault, credited to the house.
      await dropCharacterTag(tx, character.id, coin.id, SLOT_COST, {
        econ: { from: me, to: backed ? vaultParty : COMPANY, ...econ },
      });
      if (backed) await addToRoomStack(tx, vault.id, coin.id, SLOT_COST, { econ });
      const taken = await bumpBankAccount(tx, seat.account.id, SLOT_COST, {
        holderName: seat.account.holderName,
        econ,
      });
      if (taken.delta < SLOT_COST) {
        const err = new Error("The machine jammed. Try again.");
        err.userMessage = err.message;
        throw err;
      }

      if (payout > 0) {
        const paid = await bumpBankAccount(tx, seat.account.id, -payout, {
          holderName: seat.account.holderName,
          econ,
        });
        if (Math.abs(paid.delta) < payout) {
          const err = new Error("The machine's hopper is light. It won't take your coins.");
          err.userMessage = err.message;
          throw err;
        }
        // The Vault pays out FIRST, so a short Vault throws before any coin is
        // minted into a hand — and rolls the whole spin back with it.
        if (backed) await takeFromVault(tx, payout, { coin, room: vault });
        await addToStack(tx, character.id, coin.id, payout, {
          source: "EVENT",
          stackable: true,
          econ: { from: backed ? vaultParty : COMPANY, to: me, ...econ },
        });
      }

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: discordUserId,
          actionType: "slot_machine",
          targetCharacterId: character.id,
          turnId: turn?.id ?? null,
          // `game` is a fixed word the Desire desk's audit filter can search for
          // ("slots" — DESIRES.md §10); the house's name changes with the Exactor.
          details: { game: "slots", faces, outcome: outcome ?? "nothing", stake: SLOT_COST, payout, house: seat.house.name },
        },
      });
    });
  } catch (err) {
    return fail(err?.userMessage ?? "The machine jammed. Try again.");
  }

  // The identity the ROOM would see, re-read off its own select — a hooded
  // player reads as "A young man" here exactly as they do anywhere else, and
  // handing presentedIdentity a short row is how /ooc once outed one.
  const { identity } = await loadPresentedIdentity(prisma, character.id);
  const who = identity?.name ?? character.name ?? "Somebody";
  const text = slotLine(who, faces, outcome);
  const sfx = sfxFor(outcome);

  await sceneLineAt(prisma, { roomId: room.id, text, sfx }).catch(() => {});
  if (room.discordThreadId) {
    await postMessage(room.discordThreadId, text, undefined, { parse: [] }).catch(() => {});
  }

  return {
    ok: true,
    faces,
    outcome,
    payout,
    text,
    sfx,
    line: payout
      ? `You rolled ${faces.join("/")} and the tray fills: ${payout} ¢.`
      : `You rolled ${faces.join("/")}. Nothing.`,
  };
}

module.exports = {
  CASINO_ROOM_SLUG,
  HOUSE_ROLE_SLUG,
  SLOT_COST,
  SLOT_PROMPT,
  SLOT_MAX_PAYOUT,
  SLOT_PAYOUTS,
  classifyRoll,
  payoutFor,
  slotLine,
  playSlots,
};
