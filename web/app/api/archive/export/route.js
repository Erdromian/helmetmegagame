import { prisma } from "@lifeweb/db";
import { ARCHIVE_ROW_SELECT } from "@lifeweb/db/lib/archive";
import { archiveWitnessOptions } from "@lifeweb/db/lib/archiveWitnesses";
import { readPacketBuffer } from "@lifeweb/db/lib/archiveExport";
import { bucketConfigured, getObject } from "@lifeweb/db/lib/archiveBucket";
import { factsLine, rosterLine } from "@lifeweb/db/lib/epilogue";
import { formatAntagonistLines } from "@lifeweb/db/lib/objectives";
import { loadArchiveAccess } from "@/lib/archiveAccess";
import {
  archiveCursorOf,
  archiveOrderBy,
  archivePageWhere,
  parseArchiveParams,
  searchParamsObject,
} from "@/lib/archiveQuery";
import { archiveFileName, archiveTranscriptText } from "@/lib/archiveText";

// GET /api/archive/export?…the page's own filters&tz=<IANA zone> — the transcript as a text file
// (docs/systemdocs/ARCHIVE.md §5, Export).
//
// What it writes is what the page shows: the same parseArchiveParams, the same
// archivePageWhere and the same order the scroll pages through, read to the end.
// A put-away game has no rows here any more, so its file is read out of the
// packet in the bucket instead, whole, since the page has no filters to offer it.
export const dynamic = "force-dynamic";

// Rows read per query, keyset-paged on the transcript's own cursor so a
// month-long game is never one enormous findMany.
const BATCH = 2000;

// {char:<id>} with no name frozen in it: a line from before the freeze.
const BARE_MENTION_RE = /\{char:([A-Za-z0-9_-]{1,64})\}/g;

function plainError(message, status) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function rowsFromDatabase(gameId, filters) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const batch = await prisma.archiveEntry.findMany({
      where: archivePageWhere(gameId, filters, cursor),
      select: ARCHIVE_ROW_SELECT,
      orderBy: archiveOrderBy(filters.order),
      take: BATCH,
    });
    rows.push(...batch);
    if (batch.length < BATCH) return rows;
    cursor = archiveCursorOf(batch[batch.length - 1]);
  }
}

// Deleted rows are gone from the page (archiveWhere's deletedAt: null), so they
// are gone from the file too. Oldest first, on the same (sentAt, id) order.
function rowsFromPacket(buf) {
  const { rows } = readPacketBuffer(buf);
  return rows
    .filter((r) => !r.deletedAt)
    .sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Character names for the People and Witnessed by chips in the header and for
// mentions sent before names were frozen into the token. A past game's
// characters are usually gone, so the names on the rows themselves come first.
async function namesFor(gameId, rows, filters) {
  const names = new Map();
  for (const r of rows) if (r.characterId && r.characterName && !r.concealedAlias) names.set(r.characterId, r.characterName);
  // A witness may never have said a word, so their name is only on the rows
  // they witnessed.
  if (filters.witnesses?.some((id) => !names.has(id))) {
    for (const w of await archiveWitnessOptions(prisma, gameId)) if (!names.has(w.id)) names.set(w.id, w.name);
  }
  const wanted = new Set([...(filters.characters ?? []), ...(filters.witnesses ?? [])]);
  for (const r of rows) for (const m of String(r.content ?? "").matchAll(BARE_MENTION_RE)) wanted.add(m[1]);
  const missing = [...wanted].filter((id) => !names.has(id));
  if (missing.length) {
    const found = await prisma.character.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } });
    for (const c of found) names.set(c.id, c.name);
  }
  return names;
}

function epilogueText(epilogue) {
  if (!epilogue) return null;
  return {
    closingNote: epilogue.closingNote ?? null,
    facts: epilogue.facts ? factsLine(epilogue.facts) : null,
    antagonists: epilogue.antagonists?.length ? formatAntagonistLines(epilogue.antagonists).map((l) => l.replaceAll("**", "")) : [],
    roster: (epilogue.roster ?? []).map(rosterLine),
  };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const access = await loadArchiveAccess(params.get("game") ?? "");
  if (!access.ok) {
    // The same three answers /api/archive gives.
    const message =
      access.reason === "signin" ? "Sign in first." : access.reason === "no-game" ? "No such game." : "GM only.";
    return plainError(message, access.status);
  }

  const { game, archived, isCurrent } = access;
  const filters = parseArchiveParams(searchParamsObject(params));
  let rows;
  let status;
  if (archived) {
    if (!game.exportKey) return plainError("This game was put away without a packet, so there is nothing to export.", 404);
    if (!bucketConfigured()) return plainError("The archive bucket is not set up here, so the packet can't be read.", 503);
    try {
      rows = rowsFromPacket(await getObject(game.exportKey));
    } catch (err) {
      console.error("Archive export: reading the packet failed:", err);
      return plainError("The packet could not be read from the bucket. Nothing was exported.", 502);
    }
    status = `A past game, put away. Read from its packet: ${game.exportKey}`;
  } else {
    rows = await rowsFromDatabase(game.id, filters);
    status = isCurrent ? "The current game" : "A past game";
  }

  const text = archiveTranscriptText({
    game,
    status,
    rows,
    filters,
    whole: archived,
    names: await namesFor(game.id, rows, archived ? {} : filters),
    epilogue: epilogueText(game.epilogue),
    tz: params.get("tz") ?? "",
  });

  // Narrowed means a filter chip was on: a search, days, a place, a person or a
  // witness.
  const filtered =
    !archived &&
    Boolean(
      filters.q || filters.from || filters.to || filters.zones.length || filters.locations.length ||
      filters.rooms.length || filters.characters.length || filters.witnesses.length,
    );
  const name = archiveFileName(game, { filtered });
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
