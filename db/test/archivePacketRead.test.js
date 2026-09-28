// Reading a packet that is already in memory (db/lib/archiveExport.js#readPacketBuffer),
// which is how /archive's text export reads a game that was put away. No database:
// the packet is built here, the way exportGame writes one.
//
// What it defends: a damaged packet is refused whole. The export prints what
// it reads as the record of a game, so half a packet printed as if it were all
// of it would be a quiet lie in exactly the file somebody keeps.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const zlib = require("zlib");

const { readPacketBuffer } = require("../lib/archiveExport");

const ROWS = [
  { id: "e1", seq: "11", gameId: "g1", kind: "MESSAGE", content: "Hello.", sentAt: "2026-09-20T10:00:00.000Z", deletedAt: null },
  { id: "e2", seq: "12", gameId: "g1", kind: "MESSAGE", content: "Two, with a\nnewline.", sentAt: "2026-09-20T10:01:00.000Z", deletedAt: null },
];

function packet(rows, { entryCount = rows.length, tamper = null } = {}) {
  const body = rows.map((r) => JSON.stringify(r) + "\n").join("");
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");
  const manifest = { kind: "bascinet-archive", packet: 1, gameId: "g1", entryCount, sha256, game: { id: "g1" } };
  const text = JSON.stringify(manifest) + "\n" + (tamper ? tamper(body) : body);
  return zlib.gzipSync(Buffer.from(text, "utf8"));
}

test("a good packet reads back into typed rows", () => {
  const { manifest, rows } = readPacketBuffer(packet(ROWS));
  assert.equal(manifest.gameId, "g1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].seq, 11n);
  assert.ok(rows[1].sentAt instanceof Date);
  assert.equal(rows[1].content, "Two, with a\nnewline.");
});

test("a truncated packet is refused", () => {
  assert.throws(() => readPacketBuffer(packet(ROWS, { entryCount: 3 })), /holds 2 entries, manifest claims 3/);
});

test("a tampered packet is refused", () => {
  const buf = packet(ROWS, { tamper: (body) => body.replace("Hello.", "Goodbye.") });
  assert.throws(() => readPacketBuffer(buf), /hash does not match/);
});

test("something that is not a packet is refused", () => {
  assert.throws(() => readPacketBuffer(Buffer.from("not gzip")), /not readable gzip/);
  assert.throws(() => readPacketBuffer(zlib.gzipSync(Buffer.from(""))), /empty packet/);
  assert.throws(() => readPacketBuffer(zlib.gzipSync(Buffer.from('{"kind":"other"}\n'))), /not an archive packet/);
});
