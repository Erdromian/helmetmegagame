"use server";

import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { sessionGate } from "@lifeweb/db/lib/betweenSessions";
import {
  passageView,
  requestPassage,
  processView,
  approvePassage,
  denyPassage,
  pourMagma,
  passageHistory,
  submitDocumentation,
  documentsView,
  approveDocumentation,
  denyDocumentation,
  finishGatehouse,
} from "@lifeweb/db/lib/gatehouse";
import { GATE_ROOM_SLUG, GATEHOUSE_WINDOW_ROOM_SLUG, GATEHOUSE_TEXT } from "@lifeweb/db/lib/gatehouseText";

// The Town Gatehouse's windows and terminal, as Chat's place panel works them
// (./GatehouseDialogs.js, docs/systemdocs/GATEHOUSE.md). Every rule is in
// db/lib/gatehouse.js, shared with the Discord panels; what is left here is the
// web's own half — the session, the between-sittings gate, the turn, and the
// work that has to happen once a write has landed.
//
// Same contract as ./actions.js: the acting character comes from the session,
// never from the client, and every answer is `{ ok: true, … }` or
// `{ ok: false, error }`.

// Readers stay open between sittings; every write passes { acting: true }.
async function whoAmI({ acting = false } = {}) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
  if (acting) {
    const gate = await sessionGate(prisma, { acting: true });
    if (!gate.ok) return { error: gate.message };
  }
  return { discordUserId: session.discordUserId };
}

function openTurn() {
  return prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }).catch(() => null);
}

// The window a Request Passage button was on, by the room id it carried. Only
// the two windows are accepted; which side of it the asker is on is decided
// in db/lib/gatehouse.js from where they stand.
async function windowSlug(roomId) {
  const room = await prisma.room
    .findUnique({ where: { id: String(roomId ?? "") }, select: { slug: true } })
    .catch(() => null);
  return room && (room.slug === GATE_ROOM_SLUG || room.slug === GATEHOUSE_WINDOW_ROOM_SLUG) ? room.slug : null;
}

// After a write: settle what changed hands, then the Discord half off the response.
async function landed(result) {
  const { after: deferred, touched, ...rest } = result;
  if (touched?.length) await afterInventoryChange(touched);
  if (deferred) after(() => finishGatehouse(prisma, deferred));
  return rest;
}

// ─── Request Passage ──────────────────────────────────────────────────────

export async function gatePassageView({ roomId } = {}) {
  const me = await whoAmI();
  if (me.error) return { ok: false, error: me.error };
  const roomSlug = await windowSlug(roomId);
  if (!roomSlug) return { ok: false, error: GATEHOUSE_TEXT.requestNotHere };
  return passageView(prisma, me.discordUserId, { roomSlug });
}

export async function gateRequestPassage({ roomId, text, offered } = {}) {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  const roomSlug = await windowSlug(roomId);
  if (!roomSlug) return { ok: false, error: GATEHOUSE_TEXT.requestNotHere };
  return requestPassage(prisma, me.discordUserId, { roomSlug, text, offered, turn: await openTurn() });
}

export async function gateSubmitDocumentation() {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  return submitDocumentation(prisma, me.discordUserId, { turn: await openTurn() });
}

// ─── Process Requests ─────────────────────────────────────────────────────

export async function gateProcessView() {
  const me = await whoAmI();
  if (me.error) return { ok: false, error: me.error };
  return processView(prisma, me.discordUserId);
}

export async function gateHistory() {
  const me = await whoAmI();
  if (me.error) return { ok: false, error: me.error };
  return passageHistory(prisma, me.discordUserId);
}

export async function gateApprove({ passageId, keep, give } = {}) {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await approvePassage(prisma, me.discordUserId, { passageId, keep, give, turn: await openTurn() });
  return result.ok ? landed(result) : result;
}

export async function gateDeny({ passageId } = {}) {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await denyPassage(prisma, me.discordUserId, { passageId, turn: await openTurn() });
  return result.ok ? landed(result) : result;
}

export async function gateMagma() {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await pourMagma(prisma, me.discordUserId, { turn: await openTurn() });
  return result.ok ? landed(result) : result;
}

// ─── Create Documents ─────────────────────────────────────────────────────

export async function gateDocumentsView() {
  const me = await whoAmI();
  if (me.error) return { ok: false, error: me.error };
  return documentsView(prisma, me.discordUserId);
}

export async function gateApproveDocuments({ submissionId, name, occupation } = {}) {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await approveDocumentation(prisma, me.discordUserId, {
    submissionId,
    name,
    occupation,
    turn: await openTurn(),
  });
  return result.ok ? landed(result) : result;
}

export async function gateDenyDocuments({ submissionId } = {}) {
  const me = await whoAmI({ acting: true });
  if (me.error) return { ok: false, error: me.error };
  const result = await denyDocumentation(prisma, me.discordUserId, { submissionId, turn: await openTurn() });
  return result.ok ? landed(result) : result;
}
