// The Town Gatehouse on Discord (Incarn and gates.docx, docs/systemdocs/GATEHOUSE.md).
//
// The twin of Chat's dialogs (web/app/(app)/chat/GatehouseDialogs.js): asking
// to pass at a window, the finger-prick, the clerk's Grant Passage terminal
// and Documents. Every rule and every refusal lives in
// db/lib/gatehouse.js, so this face and Chat's cannot drift — this file is
// buttons, selects and modals only. The lever and the portcullis are ordinary
// gate buttons (loc:gate:, bot/src/events/interactions/travel.js).
//
// Discord cannot carry a quantity in a select, so an offer or a hand-over here
// moves whole stacks; the web dialog is where a clerk takes 5 obols of 12.
//
// ACK FIRST on everything (bot/src/lib/respond.js), except what opens a MODAL:
// showModal IS the acknowledgement (CLAUDE.md, "Slash commands").
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { ack, respond } = require("../../lib/respond");
const { afterInventoryChangeDb } = require("@lifeweb/db/lib/inventoryTail");
const {
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
} = require("@lifeweb/db/lib/gatehouse");
const {
  GATE_ROOM_SLUG,
  GATEHOUSE_WINDOW_ROOM_SLUG,
  REQUEST_TEXT_MAX,
  DOCUMENT_FIELD_MAX,
  GATEHOUSE_TEXT: T,
} = require("@lifeweb/db/lib/gatehouseText");

const GH_PASSAGE_MODAL = "gh:passagemodal:";
const GH_OFFER_PICK = "gh:offer:";
const GH_BLOOD_YES = "gh:blood:yes";
const GH_REQ_PICK = "gh:req";
const GH_APPROVE = "gh:approve:";
const GH_KEEP_PICK = "gh:keep:";
const GH_GIVE_PICK = "gh:give:";
const GH_THROUGH = "gh:through:";
const GH_DENY = "gh:deny:";
const GH_MAGMA = "gh:magma";
const GH_MAGMA_YES = "gh:magma:yes";
const GH_HISTORY = "gh:history";
const GH_SUB_PICK = "gh:sub";
const GH_PRINT = "gh:print:";
const GH_PRINT_MODAL = "gh:printmodal:";
const GH_SUB_DENY = "gh:subdeny:";

const SELECT_CAP = 25;

// What a clerk has picked on the Approve screen, between clicks. Discord hands
// a select's values only to that select's own interaction, so the two lists
// are held here until Let them through reads them. Process memory: a restart
// forgets a half-made choice, which costs one more click.
const approveDrafts = new Map();
const draftKey = (userId, passageId) => `${userId}:${passageId}`;

function openTurn() {
  return prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
}

function linesText(lines) {
  if (!lines?.length) return null;
  return lines.map((l) => (l.quantity > 1 ? `${l.name} x ${l.quantity}` : l.name)).join(", ");
}

// A write landed: settle the hands it touched, then the Discord half.
async function landed(result) {
  if (result?.touched?.length) await afterInventoryChangeDb(prisma, result.touched);
  if (result?.after) await finishGatehouse(prisma, result.after);
}

async function windowSlug(roomId) {
  const room = await prisma.room
    .findUnique({ where: { id: String(roomId ?? "") }, select: { slug: true } })
    .catch(() => null);
  return room && (room.slug === GATE_ROOM_SLUG || room.slug === GATEHOUSE_WINDOW_ROOM_SLUG) ? room.slug : null;
}

function itemOptions(rows) {
  return rows.slice(0, SELECT_CAP).map((row) => ({
    label: (row.quantity > 1 ? `${row.name} x ${row.quantity}` : row.name).slice(0, 100),
    value: row.tagId,
  }));
}

// ─── Request Passage ──────────────────────────────────────────────────────

// room:passage:{roomId} — the text first, in a modal. showModal is the ack.
async function handlePassageOpen(interaction, roomId) {
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${GH_PASSAGE_MODAL}${roomId}`)
      .setTitle(T.requestTitle)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("text")
            .setLabel(T.requestTextLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(REQUEST_TEXT_MAX)
            .setRequired(true),
        ),
      ),
  );
}

// The words are sent at once, with nothing offered; the select that follows
// adds an offer by sending the same words again (a request replaces itself).
async function handlePassageSubmit(interaction, roomId) {
  await ack(interaction);
  const roomSlug = await windowSlug(roomId);
  if (!roomSlug) return void (await respond(interaction, T.requestNotHere));
  const result = await requestPassage(prisma, interaction.user.id, {
    roomSlug,
    text: interaction.fields.getTextInputValue("text"),
    offered: [],
    turn: await openTurn(),
  });
  if (!result.ok) return void (await respond(interaction, result.error));
  const view = await passageView(prisma, interaction.user.id, { roomSlug });
  const options = view.ok ? itemOptions(view.things) : [];
  if (options.length === 0) return void (await respond(interaction, result.line));
  await respond(interaction, {
    content: `${result.line}\n-# ${T.requestOfferLabel}: pick anything you want to offer with it.`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${GH_OFFER_PICK}${roomId}`)
          .setPlaceholder(T.requestOfferLabel)
          .setMinValues(0)
          .setMaxValues(options.length)
          .addOptions(options),
      ),
    ],
  });
}

async function handleOfferPick(interaction, roomId) {
  await ack(interaction, { update: true });
  const roomSlug = await windowSlug(roomId);
  const view = roomSlug ? await passageView(prisma, interaction.user.id, { roomSlug }) : null;
  if (!view?.ok || !view.pending) {
    return void (await respond(interaction, { content: view?.error ?? T.requestGone, components: [] }));
  }
  const held = new Map(view.things.map((t) => [t.tagId, t.quantity]));
  const offered = (interaction.values ?? []).map((tagId) => ({ tagId, quantity: held.get(tagId) ?? 1 }));
  const result = await requestPassage(prisma, interaction.user.id, {
    roomSlug,
    text: view.pending.text,
    offered,
    turn: await openTurn(),
  });
  await respond(interaction, { content: result.ok ? result.line : result.error, components: [] });
}

// ─── Submit for Documentation ─────────────────────────────────────────────

async function handleBloodOpen(interaction) {
  await ack(interaction);
  await respond(interaction, {
    content: T.documentConfirm,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(GH_BLOOD_YES).setLabel(T.documentConfirmLabel).setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function handleBloodYes(interaction) {
  await ack(interaction, { update: true });
  const result = await submitDocumentation(prisma, interaction.user.id, { turn: await openTurn() });
  await respond(interaction, { content: result.ok ? result.line : result.error, components: [] });
}

// ─── Grant Passage ─────────────────────────────────────────────────────

function requestLine(row, i) {
  const offer = linesText(row.offered) ?? T.offeredNone;
  return `**${i + 1}.** ${row.who} — ${row.text}\n-# ${T.requestOfferLabel}: ${offer}`;
}

async function processPanel(discordUserId, note = null) {
  const view = await processView(prisma, discordUserId);
  if (!view.ok) return { content: view.error, components: [] };
  const all = [...view.into, ...view.outOf];
  const block = (title, rows, start) =>
    [`__${title}__`, ...(rows.length ? rows.map((r, i) => requestLine(r, start + i)) : [`-# ${T.groupEmpty}`])].join("\n");
  const content = [
    note,
    `**${T.processTitle}**`,
    block(T.groupIn, view.into, 0),
    block(T.groupOut, view.outOf, view.into.length),
  ]
    .filter(Boolean)
    .join("\n\n");

  const components = [];
  if (all.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(GH_REQ_PICK)
          .setPlaceholder(T.pickOne)
          .addOptions(
            all.slice(0, SELECT_CAP).map((r, i) => ({
              label: `${i + 1}. ${r.who}`.slice(0, 100),
              description: r.text.slice(0, 100),
              value: r.id,
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(GH_MAGMA).setLabel(T.magma).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(GH_HISTORY).setLabel(T.history).setStyle(ButtonStyle.Secondary),
    ),
  );
  return { content, components };
}

async function handleProcessOpen(interaction) {
  await ack(interaction);
  await respond(interaction, await processPanel(interaction.user.id));
}

async function handleRequestPick(interaction) {
  await ack(interaction, { update: true });
  const passageId = interaction.values?.[0] ?? "";
  const view = await processView(prisma, interaction.user.id);
  if (!view.ok) return void (await respond(interaction, { content: view.error, components: [] }));
  const row = [...view.into, ...view.outOf].find((r) => r.id === passageId);
  if (!row) return void (await respond(interaction, await processPanel(interaction.user.id, T.requestGone)));
  await respond(interaction, {
    content: requestLine(row, 0).replace(/^\*\*1\.\*\* /, ""),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${GH_APPROVE}${row.id}`).setLabel(T.approve).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${GH_DENY}${row.id}`).setLabel(T.deny).setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// The Approve screen: take whole stacks from the offer, give whole stacks of your own.
async function approveScreen(discordUserId, passageId) {
  const view = await processView(prisma, discordUserId);
  if (!view.ok) return { content: view.error, components: [] };
  const row = [...view.into, ...view.outOf].find((r) => r.id === passageId);
  if (!row) return processPanel(discordUserId, T.requestGone);
  const draft = approveDrafts.get(draftKey(discordUserId, passageId)) ?? { keep: [], give: [] };
  const components = [];
  const offerOptions = itemOptions(row.offered);
  if (offerOptions.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${GH_KEEP_PICK}${passageId}`)
          .setPlaceholder(T.approveOffered)
          .setMinValues(0)
          .setMaxValues(offerOptions.length)
          .addOptions(offerOptions.map((o) => ({ ...o, default: draft.keep.includes(o.value) }))),
      ),
    );
  }
  const yourOptions = itemOptions(view.yours);
  if (yourOptions.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${GH_GIVE_PICK}${passageId}`)
          .setPlaceholder(T.approveYours)
          .setMinValues(0)
          .setMaxValues(yourOptions.length)
          .addOptions(yourOptions.map((o) => ({ ...o, default: draft.give.includes(o.value) }))),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${GH_THROUGH}${passageId}`).setLabel(T.approveConfirm).setStyle(ButtonStyle.Success),
    ),
  );
  return { content: `**${T.approveTitle}** — ${row.who}\n${row.text}\n-# ${T.approveIntro}`, components };
}

async function handleApprove(interaction, passageId) {
  await ack(interaction, { update: true });
  approveDrafts.set(draftKey(interaction.user.id, passageId), { keep: [], give: [] });
  await respond(interaction, await approveScreen(interaction.user.id, passageId));
}

async function handleDraftPick(interaction, passageId, which) {
  await ack(interaction, { update: true });
  const key = draftKey(interaction.user.id, passageId);
  const draft = approveDrafts.get(key) ?? { keep: [], give: [] };
  draft[which] = interaction.values ?? [];
  approveDrafts.set(key, draft);
  await respond(interaction, await approveScreen(interaction.user.id, passageId));
}

async function handleThrough(interaction, passageId) {
  await ack(interaction, { update: true });
  const key = draftKey(interaction.user.id, passageId);
  const draft = approveDrafts.get(key) ?? { keep: [], give: [] };
  const view = await processView(prisma, interaction.user.id);
  if (!view.ok) return void (await respond(interaction, { content: view.error, components: [] }));
  const row = [...view.into, ...view.outOf].find((r) => r.id === passageId);
  if (!row) return void (await respond(interaction, await processPanel(interaction.user.id, T.requestGone)));
  // Whole stacks, as the select offered them.
  const whole = (ids, rows) =>
    ids
      .map((tagId) => rows.find((r) => r.tagId === tagId))
      .filter(Boolean)
      .map((r) => ({ tagId: r.tagId, quantity: r.quantity }));
  const result = await approvePassage(prisma, interaction.user.id, {
    passageId,
    keep: whole(draft.keep, row.offered),
    give: whole(draft.give, view.yours),
    turn: await openTurn(),
  });
  if (result.ok) approveDrafts.delete(key);
  await respond(interaction, await processPanel(interaction.user.id, result.ok ? result.line : result.error));
  if (result.ok) await landed(result);
}

async function handleDeny(interaction, passageId) {
  await ack(interaction, { update: true });
  const result = await denyPassage(prisma, interaction.user.id, { passageId, turn: await openTurn() });
  await respond(interaction, await processPanel(interaction.user.id, result.ok ? result.line : result.error));
  if (result.ok) await landed(result);
}

async function handleMagma(interaction) {
  await ack(interaction, { update: true });
  await respond(interaction, {
    content: T.magmaConfirm,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(GH_MAGMA_YES).setLabel(T.magmaConfirmLabel).setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function handleMagmaYes(interaction) {
  await ack(interaction, { update: true });
  const result = await pourMagma(prisma, interaction.user.id, { turn: await openTurn() });
  await respond(interaction, await processPanel(interaction.user.id, result.ok ? result.line : result.error));
  if (result.ok) await landed(result);
}

async function handleHistory(interaction) {
  await ack(interaction, { update: true });
  const view = await passageHistory(prisma, interaction.user.id);
  if (!view.ok) return void (await respond(interaction, { content: view.error, components: [] }));
  const lines = view.rows.slice(0, 10).map((row) => {
    const moved = [
      linesText(row.kept) && `${T.historyKept}: ${linesText(row.kept)}`,
      linesText(row.given) && `${T.historyGiven}: ${linesText(row.given)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return `**${row.outcome}** — ${row.who} (${row.asked.toLowerCase()})\n${row.text}\n-# ${[row.by, moved].filter(Boolean).join(" · ")}`;
  });
  await respond(interaction, {
    content: [`**${T.historyTitle}**`, ...(lines.length ? lines : [T.historyEmpty])].join("\n\n"),
    components: [],
  });
}

// ─── Documents ─────────────────────────────────────────────────────

async function documentsPanel(discordUserId, note = null) {
  const view = await documentsView(prisma, discordUserId);
  if (!view.ok) return { content: view.error, components: [] };
  const register = view.register.length
    ? view.register
        .slice(0, 30)
        .map((r) => `${r.name} — ${r.occupation ?? "—"} · ${r.fingerprint ?? "—"} · ${r.kind}`)
        .join("\n")
    : T.registerEmpty;
  const pending = view.pending.length ? view.pending.map((p, i) => `${i + 1}. ${p.who}`).join("\n") : T.pendingEmpty;
  const content = [note, `**${T.createTitle}**`, `__${T.pendingTitle}__\n${pending}`, `__${T.registerTitle}__\n${register}`]
    .filter(Boolean)
    .join("\n\n");
  const components = view.pending.length
    ? [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(GH_SUB_PICK)
            .setPlaceholder(T.pendingTitle)
            .addOptions(view.pending.slice(0, SELECT_CAP).map((p, i) => ({ label: `${i + 1}. ${p.who}`.slice(0, 100), value: p.id }))),
        ),
      ]
    : [];
  return { content, components };
}

async function handleDocumentsOpen(interaction) {
  await ack(interaction);
  await respond(interaction, await documentsPanel(interaction.user.id));
}

async function handleSubmissionPick(interaction) {
  await ack(interaction, { update: true });
  const id = interaction.values?.[0] ?? "";
  await respond(interaction, {
    content: T.pendingTitle,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${GH_PRINT}${id}`).setLabel(T.printButton).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${GH_SUB_DENY}${id}`).setLabel(T.denyButton).setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// showModal is the ack.
async function handlePrint(interaction, submissionId) {
  const field = (id, label) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(DOCUMENT_FIELD_MAX)
        .setRequired(true),
    );
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${GH_PRINT_MODAL}${submissionId}`)
      .setTitle(T.createTitle)
      .addComponents(field("name", T.nameLabel), field("occupation", T.occupationLabel)),
  );
}

async function handlePrintSubmit(interaction, submissionId) {
  await ack(interaction);
  const result = await approveDocumentation(prisma, interaction.user.id, {
    submissionId,
    name: interaction.fields.getTextInputValue("name"),
    occupation: interaction.fields.getTextInputValue("occupation"),
    turn: await openTurn(),
  });
  await respond(interaction, await documentsPanel(interaction.user.id, result.ok ? result.line : result.error));
  if (result.ok) await landed(result);
}

async function handleSubmissionDeny(interaction, submissionId) {
  await ack(interaction, { update: true });
  const result = await denyDocumentation(prisma, interaction.user.id, { submissionId, turn: await openTurn() });
  await respond(interaction, await documentsPanel(interaction.user.id, result.ok ? result.line : result.error));
  if (result.ok) await landed(result);
}

// ─── Routing ──────────────────────────────────────────────────────────────

// Every "gh:" id: [exact or prefix, handler(interaction, rest)]. A prefix
// entry ends in ":" and hands the handler what follows it.
const BUTTON_ROUTES = [
  [GH_BLOOD_YES, (i) => handleBloodYes(i)],
  [GH_MAGMA_YES, (i) => handleMagmaYes(i)],
  [GH_MAGMA, (i) => handleMagma(i)],
  [GH_HISTORY, (i) => handleHistory(i)],
  [GH_APPROVE, (i, rest) => handleApprove(i, rest)],
  [GH_THROUGH, (i, rest) => handleThrough(i, rest)],
  [GH_DENY, (i, rest) => handleDeny(i, rest)],
  [GH_PRINT, (i, rest) => handlePrint(i, rest)],
  [GH_SUB_DENY, (i, rest) => handleSubmissionDeny(i, rest)],
];
const SELECT_ROUTES = [
  [GH_REQ_PICK, (i) => handleRequestPick(i)],
  [GH_SUB_PICK, (i) => handleSubmissionPick(i)],
  [GH_OFFER_PICK, (i, rest) => handleOfferPick(i, rest)],
  [GH_KEEP_PICK, (i, rest) => handleDraftPick(i, rest, "keep")],
  [GH_GIVE_PICK, (i, rest) => handleDraftPick(i, rest, "give")],
];
const MODAL_ROUTES = [
  [GH_PASSAGE_MODAL, (i, rest) => handlePassageSubmit(i, rest)],
  [GH_PRINT_MODAL, (i, rest) => handlePrintSubmit(i, rest)],
];

// Returns true when it handled the interaction.
async function routeGatehouse(interaction) {
  const id = interaction.customId ?? "";
  if (!id.startsWith("gh:")) return false;
  const routes = interaction.isButton()
    ? BUTTON_ROUTES
    : interaction.isStringSelectMenu()
      ? SELECT_ROUTES
      : interaction.isModalSubmit()
        ? MODAL_ROUTES
        : [];
  for (const [key, handler] of routes) {
    const hit = key.endsWith(":") ? id.startsWith(key) : id === key;
    if (!hit) continue;
    await handler(interaction, key.endsWith(":") ? id.slice(key.length) : "");
    return true;
  }
  return false;
}

module.exports = {
  handlePassageOpen,
  handleBloodOpen,
  handleProcessOpen,
  handleDocumentsOpen,
  routeGatehouse,
};
