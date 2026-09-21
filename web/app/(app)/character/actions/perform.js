// The Play Instrument panel's three server actions (docs/systemdocs/SOUND.md,
// "Performances"). Public endpoints like every other action: the character comes from
// the session, and every rule is checked again in db/lib/performance.js whatever the
// panel already greyed out.
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import { performerKey } from "@lifeweb/db/lib/hoodToken";
import {
  startPerformance,
  setPerformanceVolume,
  stopPerformance,
} from "@lifeweb/db/lib/performance";
import { playInstrument } from "@lifeweb/db/lib/instrumentPlay";
import { placeKeyForLocation } from "@lifeweb/db/lib/placeKey";
import { UserError } from "@/lib/actionResult";
import { requireCharacter } from "./shared";

function wireShape(row, characterId) {
  return {
    id: row.id,
    performerKey: performerKey(characterId),
    instrumentSlug: row.instrumentSlug,
    songKey: row.songKey,
    volume: row.volume,
    startedAt: row.startedAt.getTime(),
    endsAt: row.endsAt.getTime(),
  };
}

// Starts a song. It is also /play: the same playInstrument runs, off the same five-minute
// AuditLog cooldown — so a start off cooldown posts the line and soothes the room, and one
// on cooldown still plays and says nothing. After the answer, so a slow Discord post never
// holds up the sound.
export async function startPerformanceImpl({ instrumentSlug, songKey, volume } = {}) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const result = await startPerformance(prisma, character, {
    instrumentSlug: typeof instrumentSlug === "string" ? instrumentSlug : null,
    songKey: typeof songKey === "string" ? songKey : "",
    volume,
  });
  if (!result.ok) throw new UserError(result.error);

  const placeKey = placeKeyForLocation(character.locationId);
  after(() =>
    playInstrument(prisma, { ...character, discordUserId: session.discordUserId }, placeKey).catch((err) =>
      console.error(`Performance: /play failed for ${character.id}:`, err),
    ),
  );
  return { performance: wireShape(result.performance, character.id) };
}

export async function setPerformanceVolumeImpl({ volume } = {}) {
  const { character } = await requireCharacter();
  await setPerformanceVolume(prisma, character.id, volume);
  return {};
}

export async function stopPerformanceImpl() {
  const { character } = await requireCharacter();
  await stopPerformance(prisma, character.id, "stopped");
  return {};
}
