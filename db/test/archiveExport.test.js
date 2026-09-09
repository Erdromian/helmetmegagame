// The archive packet round-trip.
//
// WHAT A FAILURE HERE MEANS. A packet is the ONLY copy of a finished game's
// transcript once Restart Game has deleted its rows (docs/systemdocs/ARCHIVE.md).
// So the thing this test defends is not "the exporter runs" — it is that a file
// written today can still be read back into a schema that has moved on, and
// that a damaged one is refused rather than half-loaded. The failure mode of an
// importer nobody exercises is silence: it rots as columns come and go, and you
// find out on the one day you need it.
//
// This is the only test in db/test/ that wants a real Postgres, because the
// things most likely to break are things a fake client cannot have: BigInt seq
// round-tripping, the unique indexes, and createMany's skipDuplicates. It skips
// itself unless you point it at a THROWAWAY database:
//
//   ARCHIVE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/scratch \
//     npm test --workspace=db
//
// It refuses anything that looks like Railway, the same guard restore.sh uses.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const URL_ = process.env.ARCHIVE_TEST_DATABASE_URL || "";
const LOOKS_LIVE = /rlwy\.net|railway/i.test(URL_);
const SKIP = !URL_ || LOOKS_LIVE;

test("archive packet round-trip", { skip: SKIP && "set ARCHIVE_TEST_DATABASE_URL to a throwaway database" }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const {
    exportGame, verifyPacket, importPacket, archiveFields,
  } = require("../lib/archiveExport");

  const prisma = new PrismaClient({ datasources: { db: { url: URL_ } } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-packet-"));
  const packet = path.join(dir, "game.jsonl.gz");

  const gameId = `test-game-${Date.now()}`;
  const number = Math.floor(Date.now() / 1000) % 2000000000;

  // Content chosen to break a CSV exporter: newlines, commas, quotes, the `»`
  // quote prefix, `-#` subtext, a resource glyph and a mention token.
  const CONTENT = [
    'He said "no", then left.\nA second line, with a comma.',
    "» a quoted line",
    "-# subtext, per line",
    "3 ⬢ for the {char:abc|Sir Alder} of it",
  ];

  // GameState is a single row keyed on id 1, and the seq guard reads it to
  // decide whether a packet reaches into the CURRENT game. So the test has to
  // own it for the duration, and put back exactly what was there — deleting it
  // outright would wipe the open game of anyone who pointed this at a dev
  // database that had one.
  const priorState = await prisma.gameState.findUnique({ where: { id: 1 } });

  t.after(async () => {
    if (priorState) {
      await prisma.gameState.upsert({ where: { id: 1 }, update: priorState, create: priorState }).catch(() => {});
    } else {
      await prisma.gameState.deleteMany({ where: { id: 1 } }).catch(() => {});
    }
    await prisma.archiveEntry.deleteMany({ where: { gameId } }).catch(() => {});
    await prisma.game.deleteMany({ where: { id: gameId } }).catch(() => {});
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await prisma.game.create({ data: { id: gameId, number, closingNote: "It ended, badly." } });
  // Make it the current game, so the round-trip below is the ordinary
  // "re-import the game you just exported" case rather than the cross-game one
  // the seq guard exists to refuse. The guard gets its own subtest further down.
  await prisma.gameState.upsert({
    where: { id: 1 },
    update: { gameId },
    create: { id: 1, gameId },
  });
  await prisma.archiveEntry.createMany({
    data: CONTENT.map((content, i) => ({
      gameId,
      content,
      kind: i === 0 ? "TURN_START" : "MESSAGE",
      source: i === 3 ? "SYSTEM" : "DISCORD",
      turnNumber: i + 1,
      zoneName: "Town",
      characterName: i === 3 ? null : "Sir Alder",
      // The null that must survive as a null: an empty string here would mean
      // a mask with no name rather than no mask at all.
      concealedAlias: i === 1 ? "Young Man" : null,
      deletedAt: i === 2 ? new Date() : null,
      placeKey: `zone:${i}`,
    })),
  });

  const before = await prisma.archiveEntry.findMany({ where: { gameId }, orderBy: { seq: "asc" } });
  assert.equal(before.length, 4);

  await t.test("exports and verifies", async () => {
    const manifest = await exportGame(prisma, { gameId, outPath: packet });
    assert.equal(manifest.entryCount, 4);
    assert.equal(manifest.gameId, gameId);
    assert.deepEqual(manifest.fields, archiveFields().map((f) => f.name));
    // maxSeq is what bounds the wipe's delete, so it has to be the real one.
    assert.equal(manifest.maxSeq, before[3].seq.toString());
    const reread = await verifyPacket(packet);
    assert.equal(reread.sha256, manifest.sha256);
  });

  await t.test("refuses a damaged packet", async () => {
    const hurt = path.join(dir, "hurt.jsonl.gz");
    const raw = fs.readFileSync(packet);
    fs.writeFileSync(hurt, raw.subarray(0, raw.length - 20));
    await assert.rejects(() => verifyPacket(hurt));
  });

  await t.test("round-trips every column, seq included", async () => {
    await prisma.archiveEntry.deleteMany({ where: { gameId } });
    assert.equal(await prisma.archiveEntry.count({ where: { gameId } }), 0);

    const report = await importPacket(prisma, packet);
    assert.equal(report.written, 4);
    assert.deepEqual(report.droppedColumns, []);
    assert.deepEqual(report.defaultedColumns, []);

    const after = await prisma.archiveEntry.findMany({ where: { gameId }, orderBy: { seq: "asc" } });
    assert.equal(after.length, 4);
    for (let i = 0; i < before.length; i += 1) {
      for (const f of archiveFields()) {
        const a = before[i][f.name];
        const b = after[i][f.name];
        const norm = (v) => (v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : v);
        assert.deepEqual(norm(b), norm(a), `${f.name} on row ${i}`);
      }
    }
  });

  await t.test("re-importing writes nothing and does not throw", async () => {
    const report = await importPacket(prisma, packet);
    assert.equal(report.written, 0);
    assert.equal(report.skipped, 4);
  });

  // The finding this exists for: every feed reader leans on "seq only climbs,
  // so a finished game sits below the current one" (CHAT.md §7), and
  // previousGameFloor turns that into the floor /play filters above. A packet
  // whose seq reaches into the live game lifts that floor above the live rows
  // and blanks the feed, the SSE stream, history and the unread dots at once.
  //
  // The live game here is given a seq BELOW the packet's range, which is the
  // real shape of the hazard: a database whose sequence restarted, or a packet
  // carried over from a different lineage. A live game written after the packet
  // is the safe case, and the guard correctly says nothing about it.
  await t.test("refuses a packet whose seq reaches into the current game", async () => {
    const liveId = `test-live-${Date.now()}`;
    try {
      await prisma.archiveEntry.deleteMany({ where: { gameId } });
      await prisma.game.create({ data: { id: liveId, number: number + 1 } });
      await prisma.archiveEntry.create({
        data: { gameId: liveId, content: "live", seq: before[0].seq - 1n },
      });
      await prisma.gameState.upsert({
        where: { id: 1 },
        update: { gameId: liveId },
        create: { id: 1, gameId: liveId },
      });
      await assert.rejects(() => importPacket(prisma, packet), /reaches into the current game/);
      assert.equal(await prisma.archiveEntry.count({ where: { gameId } }), 0, "refused, and wrote nothing");

      // ...and the escape hatch does the job, with fresh seq values.
      const report = await importPacket(prisma, packet, { remapSeq: true });
      assert.equal(report.written, 4);
      assert.equal(report.remapped, true);
      const fresh = await prisma.archiveEntry.findMany({ where: { gameId }, orderBy: { seq: "asc" } });
      assert.ok(fresh[0].seq > before[3].seq, "remapped rows sit above the old range");
    } finally {
      await prisma.gameState.update({ where: { id: 1 }, data: { gameId } }).catch(() => {});
      await prisma.archiveEntry.deleteMany({ where: { gameId: liveId } }).catch(() => {});
      await prisma.game.deleteMany({ where: { id: liveId } }).catch(() => {});
    }
  });

  await t.test("the sequence never moves backward", async () => {
    const [{ last_value: before_ }] = await prisma.$queryRawUnsafe(
      `SELECT last_value FROM pg_sequences WHERE sequencename = 'ArchiveEntry_seq_seq'`,
    );
    const { bumpSeqSequence } = require("../lib/archiveExport");
    await bumpSeqSequence(prisma);
    const [{ last_value: after_ }] = await prisma.$queryRawUnsafe(
      `SELECT last_value FROM pg_sequences WHERE sequencename = 'ArchiveEntry_seq_seq'`,
    );
    assert.ok(BigInt(after_) >= BigInt(before_), "setval moved the sequence backward");
  });
});
