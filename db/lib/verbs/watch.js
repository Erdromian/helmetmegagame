// Laying in wait, both faces (docs/systemdocs/INTERCEPT.md): setting a watch
// and calling it off. They were web/app/(app)/character/interceptActions.js's
// setInterceptImpl / stopInterceptImpl and still are — those call the functions
// here, and so does the Discord bot (bot/src/lib/verbs/captives.js). Nothing
// here costs a Move, ⬢ or a ration: a watch is a fact about nobody until
// somebody walks in. Setting an Ambush needs combat mode, and setting any watch is shut once Moves
// lock (db/lib/combatGate.js#interceptBlock); stopping one never is. See ./common.js for the result shape.
const { cleanMessage, cleanNames } = require("../intercept");
const { logAudit } = require("../auditLog");
const { refuse, asResult } = require("./common");
const { interceptBlock } = require("../combatGate");
const { resolveTargetKey } = require("../targetKey");

// `input` is what the dialog sends: mode ("SAFE" | "AMBUSH"), message, names
// (an array — the Discord modal splits its one box by line and comma first),
// anyConcealed, anyPerson, anyUnidentified, outsideZoneOnly, autoSearch, and for an Ambush
// collaboratorKeys — people standing here, as picker keys (db/lib/targetKey.js). Written from the APPLIED
// values, never from what the client sent (REQUESTS.md §2).
function setWatch(prisma, { character, discordUserId, input, openTurn }) {
  return asResult(async () => {
    const wantAmbush = input.mode === "AMBUSH";
    // Only an Ambush needs combat mode (Combat Overhaul.docx; COMBAT-MODE.md §3), and the turn lock shuts
    // both. Setting only: stopWatch below never asks.
    const blocked = await interceptBlock(prisma, character.id, { mode: wantAmbush ? "AMBUSH" : "SAFE", turn: openTurn });
    if (blocked) refuse(blocked);
    const anyone = Boolean(input.anyPerson);
    // "Any person" subsumes both narrower dragnets, so it is stored as the only one.
    const unidentified = anyone ? false : Boolean(input.anyUnidentified);
    const concealed = anyone || unidentified ? false : Boolean(input.anyConcealed);
    const targetNames = anyone ? [] : cleanNames(input.names);
    const clean = cleanMessage(input.message);
    if (!anyone && !concealed && !unidentified && targetNames.length === 0) {
      refuse("Name somebody to watch for, or select the Anyone option.");
    }
    if (!character.locationId) refuse("You have to be standing somewhere to intercept.");
    // An Ambush's collaborators: people standing here now, resolved server-side and kept as ids that never
    // go back to a browser. They are asked to join when it springs, if they are still here then.
    const collaboratorIds = [];
    if (wantAmbush) {
      for (const key of Array.isArray(input.collaboratorKeys) ? input.collaboratorKeys.slice(0, 12) : []) {
        const id = await resolveTargetKey(prisma, character, key);
        if (!id) refuse("Somebody you picked isn't here any more.");
        if (id !== character.id && !collaboratorIds.includes(id)) collaboratorIds.push(id);
      }
    }
    const data = {
      // Stamped from where they stand, and never moved: walking away deletes the row.
      locationId: character.locationId,
      mode: wantAmbush ? "AMBUSH" : "SAFE",
      message: clean,
      targetNames,
      anyConcealed: concealed,
      anyPerson: anyone,
      anyUnidentified: unidentified,
      collaboratorIds,
      outsideZoneOnly: Boolean(input.outsideZoneOnly),
      autoSearch: Boolean(input.autoSearch),
    };
    await prisma.$transaction(async (tx) => {
      await tx.interceptWatch.upsert({
        where: { characterId: character.id },
        create: { characterId: character.id, ...data },
        update: data,
      });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_intercept_set",
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        // The collaborators as a count: the ids are kept off the log the way names are (the intercept.js rule).
        details: { ...data, collaboratorIds: undefined, collaborators: collaboratorIds.length },
      });
    });
    return { line: "You lie in wait.", watch: { ...data, collaboratorIds: undefined, collaborators: collaboratorIds.length } };
  });
}

function stopWatch(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    const gone = await prisma.interceptWatch.deleteMany({ where: { characterId: character.id } });
    if (gone.count === 0) return { line: "You weren't watching for anybody.", stopped: false };
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId,
      actionType: "request_intercept_set",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: { stopped: true },
    });
    return { line: "You stop watching the road.", stopped: true };
  });
}

// An Ambush's collaborators on their own — the Discord modal has no room for a picker, so the bot asks
// for them in a second step after the watch is saved. Keys resolved against the room as it is now.
function setWatchCollaborators(prisma, { character, discordUserId, keys, openTurn }) {
  return asResult(async () => {
    const watch = await prisma.interceptWatch.findUnique({ where: { characterId: character.id }, select: { mode: true } });
    if (!watch || watch.mode !== "AMBUSH") refuse("You aren't lying in ambush.");
    const collaboratorIds = [];
    for (const key of Array.isArray(keys) ? keys.slice(0, 12) : []) {
      const id = await resolveTargetKey(prisma, character, key);
      if (!id) refuse("Somebody you picked isn't here any more.");
      if (id !== character.id && !collaboratorIds.includes(id)) collaboratorIds.push(id);
    }
    await prisma.interceptWatch.update({ where: { characterId: character.id }, data: { collaboratorIds } });
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId,
      actionType: "request_intercept_set",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: { collaborators: collaboratorIds.length },
    });
    return {
      line: collaboratorIds.length ? "When it springs, they'll be asked to join you." : "You'll spring it alone.",
    };
  });
}

module.exports = { setWatch, stopWatch, setWatchCollaborators };
