// The Friends section of /memories: who a character already knows when they
// are made, and the infoterminal PIN minted beside it (docs/systemdocs/MEMORIES.md §2a
// and §3). Learning from what is said in a room is db/lib/memoryHearing.js.
//
// Takes `prisma` as a parameter, like archive.js, so db/index.js can re-export
// it without a require cycle. Deliberately NOT spread into the barrel —
// require it by path.
//
// Seeding runs BOTH ways. A new character gets an entry for every living
// holder of a seat their role knows (Role.knowsRoleSlugs, from `knows:` in
// docs/roles.yaml), and every living character whose role knows the new seat
// gets an entry for them — "the town's memories update to include an entry for
// them", which is what makes a Serpent spawned on day ten as familiar as one
// who was there at the start.

const { randomInt } = require("node:crypto");
const { formatBareName } = require("./characterName");
const { teachableRoleText } = require("./memoryLessons");

// Who counts as somebody you already know. ASLEEP is on the Charon and still a
// person; a DEAD character is left out, since the doc's test is who you would
// realistically know now, and a funeral is how anyone learns of the rest.
const LIVING = ["ALIVE", "ASLEEP"];

// The columns the pure half reads off each side.
const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  name: true,
  roleTitle: true,
  roleUnteachable: true,
  role: { select: { slug: true, name: true, knowsRoleSlugs: true } },
};

// What an entry remembers of `subject`: their name, and the seat they hold
// — the Tribunal's and the Bastard's included, since those are open invaders a
// town can learn to recognise. A SECRET seat (a Thanati, a Vampire…) is never
// the seat anybody holds, only a hidden tag under a cover role, so it cannot
// reach an entry from here; teachableRoleText also refuses a title naming one
// (docs/systemdocs/MEMORIES.md §2d).
function seededEntry(ownerId, subject) {
  const role = subject.role ?? null;
  const roleText = teachableRoleText(subject);
  return {
    ownerId,
    subjectId: subject.id,
    name: formatBareName(subject) || subject.name || "Someone",
    roleText,
    roleSlug: roleText ? (role?.slug ?? null) : null,
    source: "SEED",
  };
}

// Pure: the rows seeding `character` writes, given everybody else alive. Both
// directions, never an entry about yourself, and never one about somebody who
// drank a Mulligan Potion: nobody knows that face from their seat, and an entry
// seeded now would undo the unlinking the potion did (MEMORIES.md §2e). The
// drinker still knows the people their own seat knows. Exported for
// db/test/roleKnows.test.js.
function seedRows(character, others) {
  const mine = character?.role?.slug ?? null;
  const knows = new Set(character?.role?.knowsRoleSlugs ?? []);
  const rows = [];
  for (const other of others ?? []) {
    if (!other?.id || other.id === character.id) continue;
    const theirs = other.role?.slug ?? null;
    if (theirs && knows.has(theirs) && !other.roleUnteachable) rows.push(seededEntry(character.id, other));
    if (mine && !character.roleUnteachable && (other.role?.knowsRoleSlugs ?? []).includes(mine)) {
      rows.push(seededEntry(other.id, character));
    }
  }
  return rows;
}

// Four digits, leading zeros kept — a PIN is a string, not a number.
function newPin() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

// Mints a PIN only where there is none, so a second call is a no-op and a
// race between two callers keeps whichever landed first.
async function ensurePin(prisma, characterId) {
  if (!characterId) return;
  await prisma.character.updateMany({ where: { id: characterId, pin: null }, data: { pin: newPin() } });
}

// Seeds one character's Friends entries both ways and mints their PIN. Safe to
// run twice: `skipDuplicates` on the (owner, subject) unique means an entry a
// player has since rewritten is left exactly as they left it. One query to
// read and one to write, so it fits inside reincarnate()'s staged-push
// transaction without stretching it.
async function seedAcquaintances(prisma, characterId) {
  if (!characterId) return { created: 0 };
  const character = await prisma.character.findUnique({ where: { id: characterId }, select: PERSON_SELECT });
  if (!character) return { created: 0 };
  await ensurePin(prisma, characterId);
  const mine = character.role?.slug ?? null;
  const knows = character.role?.knowsRoleSlugs ?? [];
  if (!mine) return { created: 0 };
  const others = await prisma.character.findMany({
    where: {
      id: { not: characterId },
      status: { in: LIVING },
      OR: [{ role: { slug: { in: knows } } }, { role: { knowsRoleSlugs: { has: mine } } }],
    },
    select: PERSON_SELECT,
  });
  const rows = seedRows(character, others);
  if (rows.length === 0) return { created: 0 };
  const { count } = await prisma.acquaintance.createMany({ data: rows, skipDuplicates: true });
  return { created: count };
}

module.exports = { seedAcquaintances, seedRows, seededEntry, ensurePin, newPin, LIVING };
