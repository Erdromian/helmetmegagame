import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { presentationStamp } from "@lifeweb/db/lib/gmPresentation";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import { resolveTargetKey } from "@lifeweb/db/lib/targetKey";
import { getGmSession } from "@/lib/discordGuild";
import { UserError } from "@/lib/actionResult";
import { blockerFor, SPEAK } from "@lifeweb/db/lib/incapacitation";
import {
  MOVE_SPENT,
  lockCharacter,
  craftLedgerDescription,
  checkLedgerMove,
  spendLedgerMove,
} from "@lifeweb/db/lib/moveLedger";
import { after } from "next/server";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { autoMovesOpen } from "@lifeweb/db/lib/turnGate";

// Helpers shared by 2+ action groups under actions/ (requestActions.js has the public server-action wrappers). Each action re-validates everything the client sent (a server action is a public endpoint) and writes its effect + AuditLog row in ONE transaction.

// `needs` (db/lib/incapacitation.js): pass ACT and the action refuses for anyone Bound, Dying, Paralyzed, Catatonic, mid-Seizure or out cold, naming the blocking tag. Omit for the few that aren't an act (reading your sheet, paperwork).
export async function requireCharacter({ needs = null } = {}) {
  const { session, inGuild } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  // Left the guild: the session is still valid but web access isn't (root
  // CLAUDE.md "Web app auth") — covers a dozen action files at this one hub.
  if (!inGuild) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // Held tags carry their GROUP too: resolveRecipeItems matches a recipe's `{ group }` ingredient, and isCorpseTag is a group check.
    include: {
      tags: {
        include: { tag: { include: { group: { select: { slug: true } } } } },
      },
      // Half of db/lib/reading.js's `where` — it still takes a roof, though nothing reads it now.
      location: { select: { indoors: true } },
      role: { select: { slug: true } },
    },
  });
  if (!character) redirect("/character");
  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) {
      throw new UserError(
        needs === SPEAK
          ? `You can't speak right now — you're ${blocker.name}.`
          : `You can't do that right now. You're ${blocker.name}.`,
      );
    }
  }
  return { session, character };
}

export function revalidateAll() {
  revalidatePath("/character");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

export function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Parties ------------------------------------------------------------

// "character:<id>" / "room:<id>" / "hood:<token>"; re-exported here (prisma bound) from db/lib/parties.js beside applyTransfer.
//
// The hood arm used to live inside transfer.js as its own `hoodedKey`, which
// meant Transfer was the only party surface that could name a person in a mask:
// a masked stranger could not be asked to pay for a cure or a craft, because
// resolveParty split the key on ":" and answered null for a "hood" kind. It is
// one question, so it gets one answer here — pass `actor` and a hood token
// resolves to the character standing in front of them, or to nobody.
//
// resolveHoodToken re-checks co-presence itself, so a token minted in a room
// this character has since left names no one; `allowDead` widens it to an
// unburied body, which only a source-side loot ever wants.
//
// A plain "character:<id>" goes through the same resolver when there is an
// actor, so it cannot reach somebody standing here in a hood — only the token
// can (db/lib/targetKey.js). Before, a masked stranger's id posted by hand
// paid, or took, exactly as their token did.
export async function resolveParty(key, { actor = null, ...opts } = {}) {
  const raw = String(key ?? "");
  if (raw.startsWith("hood:")) {
    if (!actor) return null;
    const id = await resolveHoodToken(prisma, actor, raw.slice("hood:".length), {
      includeDead: opts.allowDead === true,
    });
    if (!id) return null;
    return dbResolveParty(prisma, `character:${id}`, opts);
  }
  if (actor && raw.startsWith("character:")) {
    const id = await resolveTargetKey(prisma, actor, raw, { allowDead: opts.allowDead === true });
    if (!id) return null;
    return dbResolveParty(prisma, `character:${id}`, opts);
  }
  return dbResolveParty(prisma, raw, opts);
}

// The row lock, the ledger check and the two writers live in
// db/lib/moveLedger.js now, shared with the Discord face (a room search costs
// a quarter Move from a button — SEARCH.md §9). These keep every caller's
// import path and turn a db-style refusal into the UserError they expect.
export { lockCharacter, craftLedgerDescription };

// --- The craft Move budget (docs/systemdocs/CRAFTING.md §2a) -----------
// A craft under a whole Move files the same auto:craft Action every craft with turns files, writing a LEDGER (`Action.craftBudget`): Move spent and what was made, one entry per family. The row IS the record — no derive/cache, no per-craft Undo; a GM Reject hands the whole turn back with one delete.

export { MOVE_SPENT };

export function craftLedgerEntry(tag, cost) {
  return {
    tagId: tag.id,
    name: tag.name,
    family: cost.family,
    qty: cost.freeQty + cost.billedQty, // free half of a straddling order is derivable: qty - num billed
    num: cost.num,
    den: cost.den,
  };
}

// Reads the turn's Action against what this craft needs; returns the ledger to extend (null if no Action yet) or throws the refusal. Called TWICE per budget craft: once outside the transaction (fast fail), again inside under the Character row lock (the answer that counts).
export function checkCraftMove(action, need) {
  const out = checkLedgerMove(action, need);
  if (!out.ok) throw new UserError(out.reason);
  return out.ledger;
}

// The fast fail, outside the transaction. Replaces requireFreeMove wherever a verb costs a FRACTION of the Move: every craft, plus Bury and Engrave at a half each. Extract and the build sites still take a whole clean Move.
export async function resolveCraftMove(character, openTurn, need) {
  if (!openTurn) throw new UserError("No turn is open.");
  // One gate, one sentence — db/lib/turnGate.js. The `auto` half: this verb settles itself with no GM, so the Move lock
  // does not stop it, but the game being out of session still does.
  const gate = await autoMovesOpen(prisma, { turn: openTurn });
  if (!gate.ok) throw new UserError(gate.message);
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  checkCraftMove(action, need);
}

// Claims the Move (or slice) this craft needs, inside the caller's transaction, re-checked under the Character row lock since two tabs can both have passed the cheap check a moment ago (`@@unique([characterId, turnId])` P2002 catch in fileAutoRoutine is the backstop under even that).
// `description`: a project passes its own "(2/3)" line and keeps it; a fractional craft passes none and gets the running made-this-turn list.
// `notes`: what lands in Action.gmNotes. It must CONTAIN "auto:craft" — that
// string is what checkLedgerMove recognises as a shareable ledger — so a
// non-craft verb on this budget appends its own marker rather than replacing
// it ("auto:craft auto:bury").
export async function spendCraftMove(
  tx,
  { character, openTurn, need, entry, description = null, notes = "auto:craft" },
) {
  // How they look as it is filed, for the GM desk (db/lib/gmPresentation.js).
  const presentedAs = await presentationStamp(tx, character.id);
  const out = await spendLedgerMove(tx, { character, turn: openTurn, need, entry, description, notes, presentedAs });
  if (!out.ok) throw new UserError(out.reason);
  return { action: out.action, budget: out.budget };
}

// The ground, with everything canBuildHere() judges plus the channel the site speaks into.
export async function loadBuildGround(locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      slug: true, // site gate matches on this (placement.locations)
      indoors: true,
      attributes: true,
      discordChannelId: true,
      zone: { select: { kind: true } },
    },
  });
}

// Scenery into the Location's own channel, post-commit and catch-logged: a Discord outage must never roll back work that really happened (ARCHITECTURE.md §5).
export function speakAtSite(channelId, line) {
  if (!channelId || !line) return;
  after(() =>
    postMessage(channelId, line).catch((err) =>
      console.error("Structure ambient line failed:", err),
    ),
  );
}
