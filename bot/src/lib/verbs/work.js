// A day's work at a place that offers it, on Discord: Mine (or Gather), Farm,
// Refine, Break In and Harvest Godflesh. Each rule is db/lib/verbs/work.js's,
// shared with the web's buttons. The three that spend the whole Move ask to be
// sure first — from a menu, a misclick would cost the day.
const { mineHere, farmHere, refineHere, breakInArelitz, unrulyArelitzInReach, extractGodflesh } = require("@lifeweb/db/lib/verbs/work");
const { workVerbByKey } = require("@lifeweb/db/lib/gathering");
const { prisma, openTurn, pickFrom, confirm, ackStep, picked, actorOrRefuse, finish } = require("./context");

// Bound, Dying and the rest are refused by the rule itself, with its own
// sentence ("You're in no state to work"), so these skip the generic gate.
function dayOfWork(mode, { prompt, label, run }) {
  return {
    needs: null,
    start: (interaction, ctx) => confirm(interaction, mode, null, { prompt: prompt(ctx), label }),
    steps: {
      async go(interaction) {
        await ackStep(interaction);
        const character = await actorOrRefuse(interaction, { needs: null });
        if (!character) return;
        return finish(interaction, await run(character));
      },
    },
  };
}

const mine = dayOfWork("mine", {
  prompt: ({ pools }) => `Spend your Move ${workVerbByKey(pools?.workVerb).key === "gather" ? "gathering" : "mining"} here?`,
  label: "Go to work",
  run: async (character) => mineHere(prisma, { character, discordUserId: character.discordUserId, openTurn: await openTurn() }),
});

const farm = dayOfWork("farm", {
  prompt: () => "Spend your Move sowing the fields?",
  label: "Farm",
  run: async (character) => farmHere(prisma, { character, discordUserId: character.discordUserId, openTurn: await openTurn() }),
});

const refine = dayOfWork("refine", {
  prompt: () => "Spend your Move on the Factory floor, refining Godflesh?",
  label: "Refine",
  run: async (character) => refineHere(prisma, { character, discordUserId: character.discordUserId, openTurn: await openTurn() }),
});

// Once a turn and no Move, so no confirm: the web's button runs on the click too.
const extract = {
  needs: null,
  async start(interaction, { character }) {
    const result = await extractGodflesh(prisma, {
      character,
      discordUserId: character.discordUserId,
      openTurn: await openTurn(),
    });
    return finish(interaction, result);
  },
};

// Which unruly arelitz — held, or in a stable here.
const breakin = {
  async start(interaction, { character }) {
    const rows = await unrulyArelitzInReach(prisma, character);
    return pickFrom(interaction, "breakin", "go", {
      prompt: "Which arelitz do you work? It spends your Move, and you'll know how it went at the end of the turn.",
      options: rows.map((r) => ({ label: r.tagName, value: `${r.tagId}|${r.sourceKey}` })),
      empty: "There's no unruly arelitz here.",
    });
  },
  steps: {
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const [tagId, sourceKey] = picked(interaction).value.split("|");
      const result = await breakInArelitz(prisma, {
        character,
        discordUserId: character.discordUserId,
        tagId,
        sourceKey,
        openTurn: await openTurn(),
      });
      return finish(interaction, result);
    },
  },
};

module.exports = { mine, farm, refine, extract, breakin };
