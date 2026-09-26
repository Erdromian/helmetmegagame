// Paper on Discord (PAPERWORK.md): reading something you carry, writing on a
// sheet or a blank book, sealing a letter, and answering a letter a bird
// brought. The rules are db/lib/verbs/paper.js's and db/lib/birdReply.js's,
// shared with the web's dialogs.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { writableTags, sealableTags, writePaper, sealLetter, readHeldPaper } = require("@lifeweb/db/lib/verbs/paper");
const { isPaper, WRITE_MAX, BOOK_MAX, TITLE_MAX, BLANK_BOOK_SLUG, PAPER_SLUG } = require("@lifeweb/db/lib/paper");
const { handleBirdReplyOpen } = require("../birdReply");
const { ack, respond } = require("../respond");
const { prisma, done, pickFrom, ackStep, picked, actorOrRefuse, loadActor, finish, modalId } = require("./context");

// Discord caps one modal box at 4000 characters; a book holds more on the web.
const MODAL_TEXT_MAX = 4000;

const readpaper = {
  needs: null,
  start: (interaction, { character }) =>
    pickFrom(interaction, "readpaper", "pick", {
      prompt: "What do you read?",
      options: character.tags.filter((ct) => isPaper(ct.tag)).map((ct) => ({ label: ct.tag.name, value: ct.tagId })),
      empty: "You aren't carrying anything to read.",
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await loadActor(interaction);
      if (!character) return done(interaction, "You don't have a living character.");
      const result = await readHeldPaper(prisma, { character, tagId: picked(interaction).value });
      if (!result.ok) return done(interaction, result.error);
      // A readout, not a notice: it keeps its own shape (respond.js leaves a
      // multi-line answer alone). Not fleeting — somebody reading wants time.
      return respond(
        interaction,
        { content: `**${result.name}**\n${result.text ?? ""}`.slice(0, 2000), components: [] },
        { fleeting: false },
      );
    },
  },
};

const TEXT_FIELD = "act:write:text";
const TITLE_FIELD = "act:write:title";

const write = {
  start: (interaction, { character }) =>
    pickFrom(interaction, "write", "pick", {
      prompt: "What do you write on?",
      options: writableTags(character).map((ct) => ({
        label: ct.tag.slug === PAPER_SLUG ? `${ct.tag.name} (blank)` : ct.tag.name,
        value: ct.tagId,
      })),
      empty: "You have nothing to write on.",
    }),
  steps: {
    // Opens a modal, so it must NOT be acked first.
    async pick(interaction) {
      const tagId = picked(interaction).value;
      const character = await loadActor(interaction);
      const held = character?.tags.find((ct) => ct.tagId === tagId);
      const book = held?.tag.slug === BLANK_BOOK_SLUG;
      const titled = Boolean(held && (held.tag.paperKind === "PAPER" || held.tag.paperTitle));
      const textLabel = new LabelBuilder().setLabel(book ? "What the book says" : "What you write");
      if (held?.tag.paperKind === "PAPER") textLabel.setDescription("It's added after what's already there.");
      const labels = [
        textLabel.setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(TEXT_FIELD)
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(Math.min(book ? BOOK_MAX : WRITE_MAX, MODAL_TEXT_MAX))
              .setRequired(true),
          ),
      ];
      // A book must be named; a fresh sheet may be. A sheet already written on keeps its name.
      if (!titled) {
        labels.push(
          new LabelBuilder()
            .setLabel(book ? "Title" : "Title (optional)")
            .setTextInputComponent(
              new TextInputBuilder().setCustomId(TITLE_FIELD).setStyle(TextInputStyle.Short).setMaxLength(TITLE_MAX).setRequired(book),
            ),
        );
      }
      return interaction.showModal(
        new ModalBuilder().setCustomId(modalId("write", tagId)).setTitle(book ? "Write the book" : "Write").addLabelComponents(...labels),
      );
    },
  },
  async modal(interaction, tagId) {
    await ack(interaction);
    const character = await actorOrRefuse(interaction);
    if (!character) return;
    let title = null;
    try {
      title = interaction.fields.getTextInputValue(TITLE_FIELD);
    } catch {
      title = null;
    }
    const result = await writePaper(prisma, {
      character,
      tagId,
      text: interaction.fields.getTextInputValue(TEXT_FIELD),
      title,
    });
    return finish(interaction, result);
  },
};

const seal = {
  start: (interaction, { character }) =>
    pickFrom(interaction, "seal", "pick", {
      prompt: "Which letter do you seal?",
      options: sealableTags(character).letters.map((ct) => ({ label: ct.tag.name, value: ct.tagId })),
      empty: "You have no written letter to close.",
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return pickFrom(interaction, "seal", "go", {
        prompt: "With which stamp?",
        payload: picked(interaction).value,
        options: sealableTags(character).stamps.map((ct) => ({ label: ct.tag.name, value: ct.tagId })),
        empty: "You have no wax stamp.",
      });
    },
    async go(interaction, tagId) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return finish(interaction, await sealLetter(prisma, { character, tagId, stampTagId: picked(interaction).value, title: null }));
    },
  },
};

// Answering a letter a bird brought: the same picker the DM's Reply button
// opens (bot/src/lib/birdReply.js), for whichever letter is waiting.
const birdReply = {
  needs: null,
  async start(interaction, { character, openTurn }) {
    const waiting = await prisma.birdMessage.findMany({
      where: {
        recipientId: character.id,
        delivered: true,
        repliedAt: null,
        ...(openTurn ? { replyDeadlineTurn: { gte: openTurn.number } } : { replyDeadlineTurn: { not: null } }),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, senderName: true },
    });
    if (waiting.length === 1) return handleBirdReplyOpen(interaction, waiting[0].id);
    return pickFrom(interaction, "birdReply", "pick", {
      prompt: "Which letter do you answer?",
      options: waiting.map((m) => ({ label: `From ${m.senderName}`, value: m.id })),
      empty: "No bird is waiting on you.",
    });
  },
  steps: {
    async pick(interaction) {
      return handleBirdReplyOpen(interaction, picked(interaction).value);
    },
  },
};

module.exports = { readpaper, write, seal, birdReply };
