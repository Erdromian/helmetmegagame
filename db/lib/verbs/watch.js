// Laying in wait, both faces (docs/systemdocs/INTERCEPT.md): setting a watch
// and calling it off. They were web/app/(app)/character/interceptActions.js's
// setInterceptImpl / stopInterceptImpl and still are — those call the functions
// here, and so does the Discord bot (bot/src/lib/verbs/captives.js). Nothing
// here costs a Move, ⬢ or a ration: a watch is a fact about nobody until
// somebody walks in. Setting one needs combat mode (db/lib/combatGate.js#interceptBlock); stopping
// one never does. See ./common.js for the result shape.
const { cleanMessage, cleanNames } = require("../intercept");
const { logAudit } = require("../auditLog");
const { refuse, asResult } = require("./common");
const { interceptBlock } = require("../combatGate");

// `input` is what the dialog sends: mode ("SAFE" | "AMBUSH"), message, names
// (an array — the Discord modal splits its one box by line and comma first),
// anyConcealed, anyPerson, outsideZoneOnly, autoSearch. Written from the APPLIED values, never from what
// the client sent (REQUESTS.md §2).
function setWatch(prisma, { character, discordUserId, input, openTurn }) {
  return asResult(async () => {
    // Combat mode is required to lie in wait (COMBAT-MODE.md §3). Setting only: stopWatch below never asks.
    const notAlert = await interceptBlock(prisma, character.id);
    if (notAlert) refuse(notAlert);
    const wantAmbush = input.mode === "AMBUSH";
    const anyone = Boolean(input.anyPerson);
    // "Any person" subsumes "any concealed person", so it is stored as the only one.
    const concealed = anyone ? false : Boolean(input.anyConcealed);
    const targetNames = anyone ? [] : cleanNames(input.names);
    const clean = cleanMessage(input.message);
    if (!anyone && !concealed && targetNames.length === 0) {
      refuse("Name somebody to watch for, or select the Anyone option.");
    }
    if (!character.locationId) refuse("You have to be standing somewhere to intercept.");
    const data = {
      // Stamped from where they stand, and never moved: walking away deletes the row.
      locationId: character.locationId,
      mode: wantAmbush ? "AMBUSH" : "SAFE",
      message: clean,
      targetNames,
      anyConcealed: concealed,
      anyPerson: anyone,
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
        details: { ...data },
      });
    });
    return { line: "You lie in wait.", watch: data };
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

module.exports = { setWatch, stopWatch };
