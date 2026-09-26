// A number for every phone, and the Phonebook that lists them
// (docs/systemdocs/PHONES.md §2).
//
// ROLLED AT START GAME, NEVER AUTHORED. docs/zones.yaml is public, and so is
// this repository: a number written down anywhere, or derived from anything a
// player could read (a room id, a game id), is a number somebody could look up
// before the game began. So they are random, stored on Room.phoneNumber, and
// rolled afresh for every phone by db/lib/lobby.js#commitAssignment — the same
// step that hands out the roles — and last game's numbers are worthless.
//
// A phone added mid-game (a GM typing a name at /gm/dev/zones), or every phone
// in a game already running when this landed, has no number until somebody
// picks it up; ensurePhoneNumbers gives it one then, and reprints the book.
//
// Requires nothing but crypto, so db/lib/lobby.js can take it without pulling
// the ledger and the Discord client in behind it. Takes `prisma` as a parameter
// for the db/lib/dm.js reason; require by path.

const { randomInt } = require("node:crypto");

const PHONE_NUMBER_MIN = 1000;
const PHONE_NUMBER_MAX = 9999;

// The book every copy of which is one Tag row, so one write reprints them all
// (PAPERWORK.md). `gameWritesText` in docs/tags.yaml keeps the sync off it.
const PHONEBOOK_SLUG = "phonebook";

/**
 * A number nobody in `taken` holds. `random(min, maxExclusive)` is injectable
 * so a test can drive it; the default is crypto's, because a guessable
 * generator is a guessable exchange.
 */
function pickPhoneNumber(taken, random = randomInt) {
  const span = PHONE_NUMBER_MAX - PHONE_NUMBER_MIN + 1;
  if (taken.size >= span) throw new Error("Every phone number is taken.");
  for (;;) {
    const n = random(PHONE_NUMBER_MIN, PHONE_NUMBER_MAX + 1);
    if (!taken.has(n)) return n;
  }
}

/**
 * The Phonebook's text, from `phones` ([{ phone, payphone, phoneNumber }]).
 * Pure, so the layout is testable without a database. Named phones first,
 * then the payphones, each alphabetical; a phone with no number yet is left
 * out rather than printed with a blank.
 */
function phonebookText(phones) {
  const line = (p) => `${p.phone} — ${p.phoneNumber}`;
  const byName = (a, b) => a.phone.localeCompare(b.phone);
  const numbered = (phones ?? []).filter((p) => p?.phone && p.phoneNumber != null);
  const named = numbered.filter((p) => !p.payphone).sort(byName);
  const pay = numbered.filter((p) => p.payphone).sort(byName);
  const blocks = ["**The Exchange**"];
  if (named.length) blocks.push(named.map(line).join("\n"));
  if (pay.length) blocks.push(`**Payphones**\n${pay.map(line).join("\n")}`);
  return blocks.join("\n\n");
}

/** Reprint every copy of the Phonebook from the numbers on the walls now. */
async function writePhonebook(tx) {
  const phones = await tx.room.findMany({
    where: { phone: { not: null }, retiredAt: null },
    select: { phone: true, payphone: true, phoneNumber: true },
  });
  const { count } = await tx.tag.updateMany({
    where: { slug: PHONEBOOK_SLUG },
    data: { paperText: phonebookText(phones) },
  });
  return count;
}

/**
 * A fresh number for every phone, and none for any room without one, then the
 * book reprinted. Called inside Start Game's transaction, so the numbers and
 * the roles change together. Everything is cleared first: the column is
 * unique, and handing room A the number room B holds until B's own update
 * would collide.
 */
async function rollPhoneNumbers(tx, random = randomInt) {
  const rooms = await tx.room.findMany({ where: { phone: { not: null } }, select: { id: true } });
  await tx.room.updateMany({ where: { phoneNumber: { not: null } }, data: { phoneNumber: null } });
  const taken = new Set();
  for (const room of rooms) {
    const n = pickPhoneNumber(taken, random);
    taken.add(n);
    await tx.room.update({ where: { id: room.id }, data: { phoneNumber: n } });
  }
  await writePhonebook(tx);
  return rooms.length;
}

/**
 * Give any phone that has no number one, and reprint the book if that changed
 * anything. Usually one query and no writes.
 *
 * The write is conditional on the number still being null, and the column is
 * unique, so two people picking up two new phones in the same second can
 * neither both number the same phone nor land on the same number — the loser
 * rolls again.
 */
async function ensurePhoneNumbers(prisma) {
  const rooms = await prisma.room.findMany({
    where: { OR: [{ phone: { not: null } }, { phoneNumber: { not: null } }] },
    select: { id: true, phone: true, phoneNumber: true },
  });
  const taken = new Set(rooms.map((r) => r.phoneNumber).filter((n) => n != null));
  let assigned = 0;
  for (const room of rooms) {
    if (!room.phone || room.phoneNumber != null) continue;
    for (let tries = 0; tries < 5; tries += 1) {
      const pick = pickPhoneNumber(taken);
      taken.add(pick);
      try {
        const { count } = await prisma.room.updateMany({
          where: { id: room.id, phoneNumber: null },
          data: { phoneNumber: pick },
        });
        if (count) assigned += 1;
        break;
      } catch (err) {
        if (err?.code !== "P2002") throw err;
      }
    }
  }
  if (assigned) await writePhonebook(prisma);
  return assigned;
}

/**
 * A new game, a quiet exchange: every receiver back on its hook, every line
 * closed and every payphone's paid time gone. Called from Start Game
 * (db/lib/lobby.js) inside its transaction, beside the number roll — here and
 * not in db/lib/phone.js so the lobby does not pull the ledger and the Discord
 * client in behind it.
 */
async function resetExchange(tx) {
  await tx.phoneCall.updateMany({
    where: { status: { in: ["RINGING", "CONNECTED"] } },
    data: { status: "ENDED", endedAt: new Date(), endedReason: "newgame" },
  });
  await tx.room.updateMany({
    where: { OR: [{ phoneHolderId: { not: null } }, { phoneDeadSince: { not: null } }, { phonePaidUntil: { not: null } }] },
    data: {
      phoneHolderId: null,
      phoneHeldAt: null,
      phoneHeldVia: null,
      phoneIdleSince: null,
      phoneDeadSince: null,
      phonePaidUntil: null,
      phoneObolPrompted: false,
    },
  });
}

module.exports = {
  resetExchange,
  PHONE_NUMBER_MIN,
  PHONE_NUMBER_MAX,
  PHONEBOOK_SLUG,
  pickPhoneNumber,
  phonebookText,
  writePhonebook,
  rollPhoneNumbers,
  ensurePhoneNumbers,
};
