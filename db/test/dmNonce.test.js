// The partial unique index on DirectMessage.clientNonce.
//
// WHAT A FAILURE HERE MEANS. The nonce is what makes a re-send safe: a
// composer that never heard the answer to its send tries again with the same
// id, and the second attempt must be unable to add a second row. That promise
// lives entirely in an index, and the index lives entirely in migration SQL —
// Prisma's schema language cannot say WHERE, so nothing in schema.prisma
// asserts it and `prisma migrate diff` actively offers to drop it. If that
// drop is ever accepted, everything still compiles and a retried message
// quietly reaches the player twice.
//
// The partial half matters just as much: every other DM writer in the tree
// passes null, so a plain UNIQUE would let exactly one of them write a row and
// refuse the rest.
//
// Wants a real Postgres, and skips itself unless DATABASE_URL is a local one —
// the same allowlist db/lib/localDatabase.js uses everywhere else.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalDatabase } = require("../lib/localDatabase");

const SKIP = !isLocalDatabase() && "point DATABASE_URL at a local Postgres";

test("clientNonce is unique, and null is exempt", { skip: SKIP }, async (t) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const nonce = `test-nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const discordUserId = `test-user-${Date.now()}`;
  const written = [];

  t.after(async () => {
    await prisma.directMessage.deleteMany({ where: { id: { in: written } } });
    await prisma.$disconnect();
  });

  const row = async (data) => {
    const created = await prisma.directMessage.create({
      data: { discordUserId, direction: "OUTBOUND", content: "ok", kind: "CONVERSATION", ...data },
    });
    written.push(created.id);
    return created;
  };

  const first = await row({ clientNonce: nonce });
  assert.equal(first.clientNonce, nonce);

  // The same nonce again — what a retry of a send that DID get through looks
  // like from the database's side.
  await assert.rejects(
    () => row({ clientNonce: nonce }),
    (err) => err.code === "P2002",
    "a second row with the same clientNonce must be refused",
  );

  // And null as many times as anybody likes, because every writer without a
  // composer behind it passes null.
  const a = await row({ clientNonce: null });
  const b = await row({ clientNonce: null });
  assert.notEqual(a.id, b.id);

  // The nonce is the lookup key the send path re-reads by.
  const found = await prisma.directMessage.findFirst({ where: { clientNonce: nonce } });
  assert.equal(found.id, first.id);
});
