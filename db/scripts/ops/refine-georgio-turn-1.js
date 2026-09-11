// One-off repair, 2026-09-11. Georgio Novak spent turn 1 standing on the Godard
// Factory floor and filed his Move as a ROUTINE reading "Refine Godflesh into
// Squeeze". A Routine applies nothing, and having filed one he was skipped by
// the auto-labor pass too (db/lib/autoLaborPass.js), so the shift he described
// never happened. Every gate would have let it: the Logistics Room held the
// Godflesh, he carries the factory-key that opens it, and a refinery has asked
// for no Laboring tag since 2026-09-10 (db/lib/laborAccess.js).
//
// This runs that shift by hand. It is deliberately the SAME two writes
// db/lib/refinery.js#applyRefinery makes, in one transaction, so the lump and
// the cubes can never end up separated — which is the whole reason this is a
// script and not two clicks. It is written for this one repair and names its
// ids, rather than being a general "move a tag between a room and a person"
// tool that nobody asked for.
//
//   node db/scripts/ops/refine-georgio-turn-1.js              # dry run
//   node db/scripts/ops/refine-georgio-turn-1.js --apply      # write
//
// Dry-run-by-default with an --apply flag matches db:prune-tags and
// db:prune-orphan-roles, the other scripts that touch live rows.

const { prisma } = require("../../index");
const { addToStack, dropRoomTag } = require("../../lib/tagWrites");
const { REFINERY_YIELD, REFINERY_OUTPUT_SLUG } = require("../../lib/refinery");
const { GODFLESH_SLUG } = require("../../lib/godflesh");

const CHARACTER_ID = "cmtw1bvy2005xp80p5qebxnf6"; // Georgio Novak
const ROOM_ID = "cmtohb3iq00anj1233k7r460c"; // Godard Factory · Logistics Room

async function main() {
  const apply = process.argv.includes("--apply");

  // The host, printed before anything else. `dotenv.config()` does not override
  // an exported DATABASE_URL, so a .env sitting beside this file proves nothing
  // about where it is actually writing — see CLAUDE.md.
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").split("/")[0];
  console.log(`Database: ${host || "(unset)"}\n`);

  const [character, room, input, output] = await Promise.all([
    prisma.character.findUnique({
      where: { id: CHARACTER_ID },
      select: { id: true, name: true, location: { select: { name: true } } },
    }),
    prisma.room.findUnique({
      where: { id: ROOM_ID },
      select: { id: true, name: true, location: { select: { name: true } } },
    }),
    prisma.tag.findUnique({ where: { slug: GODFLESH_SLUG }, select: { id: true, name: true } }),
    prisma.tag.findUnique({
      where: { slug: REFINERY_OUTPUT_SLUG },
      select: { id: true, name: true, stackable: true },
    }),
  ]);

  if (!character) throw new Error(`No character ${CHARACTER_ID}`);
  if (!room) throw new Error(`No room ${ROOM_ID}`);
  if (!input || !output) throw new Error("Missing the godflesh or squeeze tag — run npm run db:sync-tags.");

  const before = await readState(input.id, output.id);
  console.log(`${character.name} — ${character.location?.name ?? "nowhere"}`);
  console.log(`${room.location?.name ?? "?"} · ${room.name}\n`);
  console.log("Before:");
  console.log(`  ${input.name} in the room:  ${before.roomGodflesh}`);
  console.log(`  ${output.name} on ${character.name}: ${before.heldSqueeze}\n`);

  if (before.roomGodflesh < 1) {
    console.log("Nothing to take — the room holds no Godflesh. Stopping.");
    return;
  }

  console.log(`Would take 1 ${input.name} from the room and add ${REFINERY_YIELD} ${output.name} to ${character.name}.`);

  if (!apply) {
    console.log("\nDry run. Re-run with `--apply` to write.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction rather than trusting the count above: this
    // is live, and the turn is open.
    const dropped = await dropRoomTag(tx, ROOM_ID, input.id, 1);
    if (!dropped.ok) throw new Error("The room no longer holds a Godflesh to take — nothing was written.");

    await addToStack(tx, CHARACTER_ID, output.id, REFINERY_YIELD, {
      source: "EVENT",
      stackable: output.stackable,
    });

    // The ledger. AuditLog is the whole record of what happened to a character
    // (CLAUDE.md), and a repair that leaves no row behind is a repair nobody
    // can later explain. Actor "system": no GM pressed a button for this.
    await tx.auditLog.create({
      data: {
        actionType: "refinery_repair",
        actorDiscordUserId: "system",
        targetCharacterId: CHARACTER_ID,
        details: {
          characterName: character.name,
          roomId: ROOM_ID,
          consumed: { slug: GODFLESH_SLUG, quantity: 1 },
          produced: { slug: REFINERY_OUTPUT_SLUG, quantity: REFINERY_YIELD },
          why: "Turn 1 was filed as a Routine describing a refining shift; run by hand.",
        },
      },
    });
  });

  const after = await readState(input.id, output.id);
  console.log("\nAfter:");
  console.log(`  ${input.name} in the room:  ${after.roomGodflesh}`);
  console.log(`  ${output.name} on ${character.name}: ${after.heldSqueeze}`);
}

async function readState(godfleshTagId, squeezeTagId) {
  const [roomRow, heldRow] = await Promise.all([
    prisma.roomTag.findUnique({
      where: { roomId_tagId: { roomId: ROOM_ID, tagId: godfleshTagId } },
      select: { quantity: true },
    }),
    prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: CHARACTER_ID, tagId: squeezeTagId } },
      select: { quantity: true },
    }),
  ]);
  return { roomGodflesh: roomRow?.quantity ?? 0, heldSqueeze: heldRow?.quantity ?? 0 };
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
