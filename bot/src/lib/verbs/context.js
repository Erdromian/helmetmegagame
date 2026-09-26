// The shared runtime every Discord verb runs on (bot/src/lib/verbs/). It plays
// the part web/app/(app)/character/actions/shared.js plays for a server action:
// who is acting, whether they may, who they pointed at, and how the answer is
// written back — so each verb file is only the verb.
//
// Custom ids. Every component a verb draws is `act:v:<mode>:<step>[:<payload>]`
// and every modal `act:m:<mode>[:<payload>]`; bot/src/events/interactionCreate.js
// routes the lot to verbs/index.js#handleVerbComponent. Discord caps a custom id
// at 100 characters, and the longest payload anybody puts here is a hood key
// (`hood:` + 32 hex) plus a cuid, well inside it.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { blockerFor, ACT } = require("@lifeweb/db/lib/incapacitation");
const { resolveTargetKey, splitTargetKey } = require("@lifeweb/db/lib/targetKey");
const { isHere, notHereMessage } = require("@lifeweb/db/lib/presence");
const { pickerRows } = require("@lifeweb/db/lib/peopleHere");
const { POOL_CHARACTER_INCLUDE } = require("@lifeweb/db/lib/actionPools");
const { WEB_ORIGIN } = require("@lifeweb/db/lib/constants");
const { afterInventoryChangeDb, notifyCharacterDb, speakAtPlaces } = require("@lifeweb/db/lib/inventoryTail");
const { resolveActingMember } = require("../interactionGuild");
const { ack, respond } = require("../respond");

const VERB_PREFIX = "act:v:";
const MODAL_PREFIX = "act:m:";
const OPTION_LIMIT = 25;

function verbId(mode, step, payload = null) {
  return `${VERB_PREFIX}${mode}:${step}${payload != null && payload !== "" ? `:${payload}` : ""}`;
}

function modalId(mode, payload = null) {
  return `${MODAL_PREFIX}${mode}${payload != null && payload !== "" ? `:${payload}` : ""}`;
}

// "act:v:kiss:pick:hood:abc" -> { mode: "kiss", step: "pick", payload: "hood:abc" }.
// The payload keeps its own colons — a target key has one.
function parseVerbId(customId) {
  if (!customId.startsWith(VERB_PREFIX)) return null;
  const [mode, step, ...rest] = customId.slice(VERB_PREFIX.length).split(":");
  return { mode, step, payload: rest.length ? rest.join(":") : null };
}

function parseModalId(customId) {
  if (!customId.startsWith(MODAL_PREFIX)) return null;
  const [mode, ...rest] = customId.slice(MODAL_PREFIX.length).split(":");
  return { mode, payload: rest.length ? rest.join(":") : null };
}

// The acting character, loaded the way db/lib/actionPools.js reads one (tags
// with their whole tag row and group, the location with its zone and seam) plus
// the role — a superset of what requireCharacter loads on the web, so every
// db/lib verb that takes "the character" gets the shape it expects. Resolved
// from the interaction, never from anything the client sent.
const ACTOR_INCLUDE = { ...POOL_CHARACTER_INCLUDE, role: { select: { slug: true } } };

async function loadActor(interaction) {
  const { member } = await resolveActingMember(interaction);
  if (!member?.id) return null;
  return prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE" },
    include: ACTOR_INCLUDE,
  });
}

// The web's requireCharacter({ needs: ACT }) refusal, word for word.
function actBlock(character, needs = ACT) {
  const blocker = blockerFor(character.tags, needs);
  return blocker ? `You can't do that right now. You're ${blocker.name}.` : null;
}

function openTurn() {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
}

// An answer that replaces whatever the verb last drew — a picker's own
// message, when it came from one, so a finished verb leaves no live select.
function done(interaction, content, { fleeting = true, components = [] } = {}) {
  return respond(interaction, { content, components }, { fleeting });
}

// Who a picker pointed at, as a row with the caller's `select` — or a refusal
// that never names a hood (web/lib/hereTarget.js#resolveHereTarget, on db/lib).
async function hereTarget(character, key, { select, allowDead = false, status } = {}) {
  if (!character?.locationId) return { error: "You aren't anywhere you could do that." };
  const id = await resolveTargetKey(prisma, character, key, { allowDead });
  const target = id
    ? await prisma.character.findFirst({ where: { id, ...(status ? { status } : {}) }, select })
    : null;
  if (!target || !isHere(character, target, { allowDead, allowConcealed: true })) {
    return { error: splitTargetKey(key).kind === "hood" ? "They aren't here." : notHereMessage(target) };
  }
  return { target };
}

// "Pick someone here": one select over db/lib/peopleHere.js's roster, both
// halves, the value a target key. Not fleeting — this message becomes the
// verb's next step, and a self-delete timer set now would take that with it
// (the Travel picker's reason, COMMANDS.md §4).
async function pickSomeone(
  interaction,
  character,
  mode,
  { prompt, includeDead = false, includeSelf = false, filter = null, empty } = {},
) {
  let rows = await pickerRows(prisma, character, { includeDead });
  if (filter) rows = rows.filter(filter);
  if (includeSelf) rows = [{ key: `character:${character.id}`, label: "Yourself", hooded: false }, ...rows];
  if (rows.length === 0) {
    return done(interaction, empty ?? "There's nobody here.");
  }
  const shown = rows.slice(0, OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(verbId(mode, "pick"))
    .setPlaceholder("Choose someone")
    .addOptions(shown.map((row) => ({ label: row.label.slice(0, 100), value: row.key })));
  const cut = rows.length - shown.length;
  return respond(
    interaction,
    {
      content: [prompt, cut > 0 ? `-# ${cut} more not shown — Discord caps this list at 25.` : null]
        .filter(Boolean)
        .join("\n"),
      components: [new ActionRowBuilder().addComponents(menu)],
    },
    { fleeting: false },
  );
}

// A select over anything else — skills, papers, bodies. `options` are
// `{ label, value, description? }`.
function pickFrom(interaction, mode, step, { prompt, options, placeholder = "Choose one", payload = null, empty }) {
  if (options.length === 0) return done(interaction, empty ?? "There's nothing to choose.");
  const shown = options.slice(0, OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(verbId(mode, step, payload))
    .setPlaceholder(placeholder)
    .addOptions(
      shown.map((o) => ({
        label: String(o.label).slice(0, 100),
        value: String(o.value),
        ...(o.description ? { description: String(o.description).slice(0, 100) } : {}),
      })),
    );
  const cut = options.length - shown.length;
  return respond(
    interaction,
    {
      content: [prompt, cut > 0 ? `-# ${cut} more not shown — Discord caps this list at 25.` : null]
        .filter(Boolean)
        .join("\n"),
      components: [new ActionRowBuilder().addComponents(menu)],
    },
    { fleeting: false },
  );
}

// "Are you sure?" as one button and a Cancel, for a verb that would be a bad
// misclick — an attack, a detonation. The Cancel is the verb's own `cancel`
// step, which every verb gets for free (verbs/index.js).
function confirm(interaction, mode, payload, { prompt, label, danger = false }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(verbId(mode, "go", payload))
      .setLabel(label)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(verbId(mode, "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  return respond(interaction, { content: prompt, components: [row] }, { fleeting: false });
}

// The web's own dialog for a verb Discord hands off. `/character?act=<mode>`
// opens it straight away (web/app/components/CharacterSheet.js); a verb with no
// dialog of its own goes to the sheet.
function webLink(action) {
  return `${WEB_ORIGIN}/character${action?.web ? `?act=${encodeURIComponent(action.mode)}` : ""}`;
}

function linkReply(interaction, action, text = null) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(webLink(action)).setLabel(`${action.label} on the web`),
  );
  return respond(interaction, {
    content: text ?? `${action.label} is on the web for now.`,
    components: [row],
  });
}

// ack() with the right shape for where the click came from: a component on a
// verb's own message is updated in place, anything else answers in a new
// ephemeral message.
function ackStep(interaction) {
  return ack(interaction, { update: true });
}

// What the player chose on a select, and the words it was shown under — the
// name the picker offered, which is the name the answer should use (a hood
// by its alias, never the name under it).
function picked(interaction) {
  const value = interaction.values?.[0] ?? null;
  const label = interaction.component?.options?.find((o) => o.value === value)?.label ?? null;
  return { value, label };
}

// Everything a db/lib/verbs/ result owes after it commits (db/lib/verbs/common.js):
// the inventory tail over `touched`, the notices in `notify`, the ambient lines
// in `speak` — then the answer, the result's own `line` unless the caller has a
// better one. A refusal answers with its sentence and does nothing else.
async function finish(interaction, result, { text = null, components = [] } = {}) {
  if (!result.ok) return done(interaction, result.error);
  if (result.touched?.length) await afterInventoryChangeDb(prisma, result.touched);
  for (const n of result.notify ?? []) await notifyCharacterDb(prisma, n.character, n.text, n.opts);
  await speakAtPlaces(prisma, result.speak).catch((err) => console.error("Ambient line failed:", err));
  return done(interaction, text ?? result.line ?? "Done.", { components });
}

// The answer to "who is acting?", with the refusals every verb shares: nobody
// alive, or held by something on their own sheet. Null means it has already
// answered and the caller should stop.
async function actorOrRefuse(interaction, { needs = ACT } = {}) {
  const character = await loadActor(interaction);
  if (!character) {
    await done(interaction, "You don't have a living character.");
    return null;
  }
  const blocked = needs ? actBlock(character, needs) : null;
  if (blocked) {
    await done(interaction, blocked);
    return null;
  }
  return character;
}

module.exports = {
  VERB_PREFIX,
  MODAL_PREFIX,
  OPTION_LIMIT,
  ACTOR_INCLUDE,
  verbId,
  modalId,
  parseVerbId,
  parseModalId,
  loadActor,
  actBlock,
  openTurn,
  done,
  hereTarget,
  pickSomeone,
  pickFrom,
  confirm,
  webLink,
  linkReply,
  ackStep,
  picked,
  actorOrRefuse,
  finish,
  prisma,
};
