import { prisma, Prisma } from "@lifeweb/db";

// SERVER ONLY. One read of the database's own clock.
//
// Every "as of when" stamp a live surface reconciles against has to come from
// Postgres, never from Date.now(). The web container and the database are
// different machines, and a few hundred milliseconds of drift the wrong way is
// enough to make a fresh row look older than the stale one it should replace —
// which, on the desk store, means a GM's own write quietly losing to the page
// payload that was already in flight when they made it.
//
// This lived inside inboxDelta.js first; it is out here now because the
// adjudication desk needs the same stamp, and two copies of the same query
// would be two clocks to keep honest.

const clockSql = Prisma.sql`SELECT (EXTRACT(EPOCH FROM now()) * 1000)::double precision AS "nowMs"`;

export async function pgNowMs() {
  const rows = await prisma.$queryRaw(clockSql);
  return Number(rows[0]?.nowMs ?? Date.now());
}
