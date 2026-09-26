// The verbs a role or a rare item gives, on Discord: the datacard and the
// pointer device, the Thanati's Recall / Recover / Set hideout, the Cerberon's
// warrant book, the Bishop's excommunications and the Bastard's reinforcements.
// Every rule is db/lib/verbs/roles.js's (or self.js's, for the pointer device),
// shared with the web's buttons.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const {
  readDatacard,
  armNuke,
  disarmNuke,
  recallComrades,
  recoverEquipment,
  hideoutChoices,
  setHideout,
  arrestWarrant,
  removeWarrant,
  checkWanted,
  excommunicate,
  liftExcommunication,
  callReinforcements,
} = require("@lifeweb/db/lib/verbs/roles");
const { readPointerDevice } = require("@lifeweb/db/lib/verbs/self");
const { listExcommunications } = require("@lifeweb/db/lib/excommunication");
const { REINFORCEMENTS, MAX_REINFORCEMENTS_PER_CALL } = require("@lifeweb/db/lib/lateJoin");
const { FULL_NAME_LIMIT } = require("@lifeweb/db/lib/characterName");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { ack } = require("../respond");
const { prisma, openTurn, done, pickFrom, confirm, ackStep, picked, actorOrRefuse, finish, modalId } = require("./context");

// --- The datacard and the pointer device ---------------------------------------------

// Reading an instrument is not an act: no gate, and the answer is also DM'd, so
// reading the card in a room full of people gives nothing away.
const pointer = {
  needs: null,
  async start(interaction, { character }) {
    const result = await readDatacard(prisma, { character });
    if (!result.ok) return done(interaction, result.error);
    if (result.dm?.discordUserId) {
      await sendDm(prisma, result.dm.discordUserId, result.dm.content, { source: "player_event" }).catch(() => {});
    }
    return done(interaction, result.line);
  },
};

const pointerdevice = {
  needs: null,
  async start(interaction, { character }) {
    return finish(interaction, await readPointerDevice(prisma, { character }));
  },
};

function nukeSwitch(mode, verb, sure) {
  return {
    start: (interaction) => confirm(interaction, mode, null, { ...sure, danger: true }),
    steps: {
      async go(interaction) {
        await ackStep(interaction);
        const character = await actorOrRefuse(interaction);
        if (!character) return;
        return finish(
          interaction,
          await verb(prisma, { character, discordUserId: character.discordUserId, openTurn: await openTurn() }),
        );
      },
    },
  };
}

const arm = nukeSwitch("arm", armNuke, {
  prompt: "Put the card in and start the count? It goes off at the close of the turn after next, and kills everyone who isn't underground.",
  label: "Arm",
});
const disarm = nukeSwitch("disarm", disarmNuke, { prompt: "Take the card out and stop the count?", label: "Disarm" });

// --- The Thanati -------------------------------------------------------------------------

const recall = {
  needs: null,
  async start(interaction, { character }) {
    const result = await recallComrades(prisma, { character, discordUserId: character.discordUserId });
    if (!result.ok) return done(interaction, result.error);
    const lines = result.roster.map((r) => `-# ${r.name}${r.role ? ` — ${r.role}` : ""}${r.leader ? " (leader)" : ""}`);
    return done(interaction, [`**${result.line}**`, ...lines].join("\n"));
  },
};

const recover = {
  start: (interaction) =>
    confirm(interaction, "recover", null, {
      prompt: "Spend your Move recovering your mask and robes?",
      label: "Recover",
    }),
  steps: {
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return finish(
        interaction,
        await recoverEquipment(prisma, { character, discordUserId: character.discordUserId, openTurn: await openTurn() }),
      );
    },
  },
};

const hideout = {
  async start(interaction, { character }) {
    const rooms = await hideoutChoices(prisma, character);
    return pickFrom(interaction, "hideout", "go", {
      prompt: "Which room is the hideout?",
      options: rooms.map((r) => ({ label: r.name, value: r.id })),
      empty: "There's no room here you can get into.",
    });
  },
  steps: {
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return finish(
        interaction,
        await setHideout(prisma, { character, discordUserId: character.discordUserId, roomId: picked(interaction).value }),
      );
    },
  },
};

// --- The Cerberon and the Bishop: a typed name, never a picker ------------------------------

const NAME_FIELD = "act:name";

// Engrave's reasoning: a dropdown would be the roster handed to anyone with the
// badge or the mitre. The whole name, so the wrong Jorren is not one click away.
function typedName(mode, { title, label, run }) {
  return {
    modalFirst: true,
    start(interaction) {
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId(mode))
          .setTitle(title)
          .addLabelComponents(
            new LabelBuilder()
              .setLabel(label)
              .setTextInputComponent(
                new TextInputBuilder().setCustomId(NAME_FIELD).setStyle(TextInputStyle.Short).setMaxLength(FULL_NAME_LIMIT).setRequired(true),
              ),
          ),
      );
    },
    async modal(interaction) {
      await ack(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return finish(
        interaction,
        await run(prisma, {
          character,
          discordUserId: character.discordUserId,
          name: interaction.fields.getTextInputValue(NAME_FIELD),
          openTurn: await openTurn(),
        }),
      );
    },
  };
}

const warrant = typedName("warrant", { title: "Arrest warrant", label: "Their whole name", run: arrestWarrant });
const unwarrant = typedName("unwarrant", { title: "Remove a warrant", label: "Their whole name", run: removeWarrant });
const excommunicateVerb = typedName("excommunicate", { title: "Excommunicate", label: "Their whole name", run: excommunicate });

const wantedlist = {
  needs: null,
  async start(interaction, { character }) {
    const result = await checkWanted(prisma, { character, discordUserId: character.discordUserId });
    if (!result.ok) return done(interaction, result.error);
    return done(interaction, [`**${result.line}**`, ...result.roster.map((r) => `-# ${r.name}`)].join("\n"));
  },
};

// Lifting is from the Bishop's own list, so there is no name to get wrong.
const unexcommunicate = {
  async start(interaction, { character }) {
    const rows = await listExcommunications(prisma, character.id);
    return pickFrom(interaction, "unexcommunicate", "go", {
      prompt: "Whose excommunication do you lift?",
      options: rows.map((r) => ({ label: r.name, value: r.id })),
      empty: "You haven't excommunicated anybody.",
    });
  },
  steps: {
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return finish(
        interaction,
        await liftExcommunication(prisma, {
          character,
          discordUserId: character.discordUserId,
          targetId: picked(interaction).value,
          openTurn: await openTurn(),
        }),
      );
    },
  },
};

// --- The Bastard's reinforcements ---------------------------------------------------------

const reinforce = {
  start: (interaction) =>
    pickFrom(interaction, "reinforce", "pick", {
      prompt: "Who do you call? You buy a seat, and a real player walks into it.",
      options: REINFORCEMENTS.map((r) => ({ label: r.name, value: r.roleSlug, description: `${r.price} ¢ a seat` })),
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const roleSlug = picked(interaction).value;
      const price = REINFORCEMENTS.find((r) => r.roleSlug === roleSlug)?.price ?? 0;
      const counts = Array.from({ length: MAX_REINFORCEMENTS_PER_CALL }, (_, i) => i + 1);
      return pickFrom(interaction, "reinforce", "go", {
        prompt: "How many seats?",
        payload: roleSlug,
        options: counts.map((n) => ({ label: String(n), value: String(n), description: `${n * price} ¢` })),
      });
    },
    async go(interaction, roleSlug) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return finish(
        interaction,
        await callReinforcements(prisma, {
          character,
          discordUserId: character.discordUserId,
          roleSlug,
          quantity: Number(picked(interaction).value),
        }),
      );
    },
  },
};

module.exports = {
  pointer,
  pointerdevice,
  arm,
  disarm,
  recall,
  recover,
  hideout,
  warrant,
  unwarrant,
  wantedlist,
  excommunicate: excommunicateVerb,
  unexcommunicate,
  reinforce,
};
