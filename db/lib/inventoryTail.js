// The post-commit tail for a player verb run from Discord — the bot's twin of
// web/lib/afterInventoryChange.js and web/lib/notifyCharacter.js, which lean on
// Next's `after()` and the web's own REST helpers and so cannot be required
// from the bot. Same steps, same order, same best-effort posture: a missed sync
// is the channel doctor's problem (CHANNELS.md §6), and none of it may undo
// what the verb already committed. Never call either inside a transaction.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel.
const { settleCarry, deliverCarryDrop } = require("./carry");
const { refreshCorpseWeight } = require("./corpseWeight");
const { stopIfInstrumentGone } = require("./performance");
const { syncCharacterRoomAccess } = require("./roomAccess");
const { reconcileCorpses } = require("./corpseFollow");
const { reconcileNarrowcastAccess } = require("./locationMove");
const { stillAlive } = require("./deathTeardown");
const { sendDm } = require("./dm");

// settleCarry, the body's weight, a song whose instrument just left, the
// narrowcast overwrites and private-room threads, a dropped load, and the
// corpse follow — web/lib/afterInventoryChange.js line for line.
async function afterInventoryChangeDb(prisma, characters) {
  const ids = [
    ...new Set([].concat(characters).filter(Boolean).map((c) => (typeof c === "string" ? c : c.id))),
  ];
  for (const id of ids) {
    const settled = await settleCarry(prisma, id).catch((err) => {
      console.error(`settleCarry failed for ${id}:`, err);
      return null;
    });
    await refreshCorpseWeight(prisma, id).catch(() => {});
    await stopIfInstrumentGone(prisma, id).catch((err) => console.error(`performance stop failed for ${id}:`, err));
    const row = await prisma.character
      .findUnique({
        where: { id },
        select: { id: true, discordUserId: true, discordMirrored: true, locationId: true, status: true },
      })
      .catch(() => null);
    // Not mirrored to Discord holds this account out of every channel,
    // narrowcast included — the web's syncCharacterNarrowcastAccess guard.
    if (row?.discordUserId && row.discordMirrored && process.env.DISCORD_TOKEN) {
      await reconcileNarrowcastAccess(prisma, id, row.discordUserId).catch(() => {});
    }
    if (row) await syncCharacterRoomAccess(prisma, row).catch(() => {});
    if (settled?.drop) await deliverCarryDrop(prisma, settled).catch(() => {});
  }
  if (ids.length) await reconcileCorpses(prisma).catch((err) => console.error("corpse follow failed:", err));
}

// A notice to the character a verb happened TO. Deliberately unattributed —
// callers write what changed, never who did it (REQUESTS.md). A dead
// character whose player already controls a living one gets nothing: a notice
// about the corpse isn't a notice about them any more.
async function notifyCharacterDb(prisma, character, text, opts = {}) {
  if (!character?.discordUserId) return;
  try {
    if (character.status && character.status !== "ALIVE") {
      const reborn = await stillAlive(prisma, character.discordUserId).catch(() => false);
      if (reborn) return;
    }
    await sendDm(prisma, character.discordUserId, text, {
      source: opts.source ?? "player_event",
      kind: opts.kind,
      sfx: opts.sfx ?? null,
      components: opts.components,
      embeds: opts.embeds,
      meta: opts.meta,
    });
  } catch (err) {
    console.error(`notifyCharacter DM failed for ${character.id}:`, err?.message ?? err);
  }
}

// An offer's DM, as a db/lib create…Offer hands it back ({ discordUserId,
// content, components, meta }). Best-effort: the offer row already exists, and
// the web's DM-thread render shows it either way.
async function sendOfferDm(prisma, dm, opts = {}) {
  if (!dm?.discordUserId) return;
  await sendDm(prisma, dm.discordUserId, dm.content, {
    components: dm.components,
    meta: dm.meta,
    source: "player_event",
    sfx: opts.sfx ?? null,
  }).catch((err) => console.error("Offer DM failed:", err?.message ?? err));
}

module.exports = { afterInventoryChangeDb, notifyCharacterDb, sendOfferDm };
