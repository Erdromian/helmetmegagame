// Every player verb on Discord, behind one door (docs/systemdocs/COMMANDS.md §2e).
//
//   /<command> [sub]      the typed twin of every verb — db/lib/actionCatalog.js
//                         names them, bot/src/lib/commands.js registers them.
//   Actions               the button on every Location anchor and the #turns
//                         console, and /actions: a menu of the verbs THIS
//                         character can use right now, and nothing else.
//   act:v:… / act:m:…     each verb's own selects, buttons and modals.
//
// A verb the catalog marks `run: "link"` is not built here yet: the reply is a
// link straight to that verb's dialog on the web (context.js#linkReply). Every
// other verb lives in one of the family files below, as
// `{ start(interaction, ctx), steps: { <step>(interaction, payload) }, modal(interaction, payload), modalFirst }`.
//
// Hidden and greyed come from db/lib/actionPools.js — the same flags the web's
// sheet reads. A typed command for a verb this character can't use says why,
// because Discord shows every command to everybody and cannot hide one per
// player; the Actions menu simply leaves it out.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { SECTIONS, ACTIONS, actionFor, actionForCommand, actionState } = require("@lifeweb/db/lib/actionCatalog");
const { actionPoolsFor } = require("@lifeweb/db/lib/actionPools");
const { WEB_ORIGIN } = require("@lifeweb/db/lib/constants");
const { ack, respond } = require("../respond");
const {
  OPTION_LIMIT,
  VERB_PREFIX,
  MODAL_PREFIX,
  parseVerbId,
  parseModalId,
  loadActor,
  actBlock,
  done,
  linkReply,
  ackStep,
  prisma,
} = require("./context");

const FAMILIES = [
  require("./people"),
  require("./self"),
  require("./captives"),
  require("./work"),
  require("./roles"),
  require("./paper"),
  require("./place"),
];

const VERBS = Object.assign({}, ...FAMILIES);

// The Actions button's own custom id (Location anchors, the #turns console),
// and the menu's one select per section.
const ACTIONS_OPEN_ID = "act:open";
const MENU_PREFIX = "act:menu:";

// Why a verb isn't offered, as a player reads it. Hidden verbs get no reason
// of their own on purpose: the catalog only writes sentences for greys.
function unavailable(action, pools) {
  const { state, reason } = actionState(action, pools);
  if (state === "ready") return null;
  return reason ?? "That isn't something you can do right now.";
}

// The one way into any verb — a typed command, a pick from the Actions menu.
async function startVerb(interaction, mode) {
  const action = actionFor(mode);
  const verb = VERBS[mode];
  if (!action) return respond(interaction, "That isn't something you can do.");

  // A verb that opens a modal must do it before anything else: showModal IS
  // the acknowledgement, and it must land inside three seconds. Every gate
  // runs again on submit.
  if (action.run === "native" && verb?.modalFirst) return verb.start(interaction, {});

  await ack(interaction);
  const character = await loadActor(interaction);
  if (!character) return respond(interaction, "You don't have a living character.");
  const pools = await actionPoolsFor(prisma, character);
  const why = unavailable(action, pools);
  if (why) return respond(interaction, why);
  if (action.run === "link" || !verb) return linkReply(interaction, action);
  const blocked = verb.needs === null ? null : actBlock(character);
  if (blocked) return respond(interaction, blocked);
  return verb.start(interaction, { character, pools, openTurn: pools.openTurn });
}

function startFromCommand(interaction) {
  const sub = interaction.options.getSubcommand(false);
  const action = actionForCommand(interaction.commandName, sub);
  if (!action) return respond(interaction, "That isn't something you can do.");
  return startVerb(interaction, action.mode);
}

// Commands this module answers.
const VERB_COMMANDS = new Set(ACTIONS.map((a) => a.command));

// Everything a verb draws. The Cancel on a confirm is every verb's for free.
async function handleVerbComponent(interaction) {
  const parsed = parseVerbId(interaction.customId);
  if (!parsed) return;
  if (parsed.step === "cancel") {
    await ackStep(interaction);
    return done(interaction, "Canceled.");
  }
  const step = VERBS[parsed.mode]?.steps?.[parsed.step];
  if (!step) {
    await ackStep(interaction);
    return done(interaction, "That doesn't work any more.");
  }
  return step(interaction, parsed.payload);
}

async function handleVerbModal(interaction) {
  const parsed = parseModalId(interaction.customId);
  const verb = parsed ? VERBS[parsed.mode] : null;
  if (!verb?.modal) return respond(interaction, "That doesn't work any more.");
  return verb.modal(interaction, parsed.payload);
}

// --- The Actions menu ---------------------------------------------------------

// Built fresh on every open: what is usable changes as a character walks, eats
// and acts, and a menu showing the last open's verbs would be the stale kind of
// wrong. Only READY verbs are listed. Work this place offers is the one
// exception, the web menu's: shown greyed with its reason, because being here
// is the context and "you're worn out" is worth reading.
function menuPayload(pools, { placeName = null } = {}) {
  const lines = [placeName ? `**What you can do at ${placeName}**` : "**What you can do**"];
  const rows = [];
  let leftOut = 0;
  for (const section of SECTIONS) {
    const ready = [];
    for (const action of ACTIONS.filter((a) => a.section === section.key)) {
      const { state, reason } = actionState(action, pools);
      if (state === "ready") ready.push(action);
      else if (state === "greyed" && section.key === "work") lines.push(`-# ${action.label}: ${reason}`);
      else if (state === "greyed") leftOut += 1;
    }
    for (let i = 0; i < ready.length; i += OPTION_LIMIT) {
      const chunk = ready.slice(i, i + OPTION_LIMIT);
      const part = ready.length > OPTION_LIMIT ? ` (${Math.floor(i / OPTION_LIMIT) + 1})` : "";
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${MENU_PREFIX}${section.key}:${i / OPTION_LIMIT}`)
            .setPlaceholder(`${section.label}${part}`)
            .addOptions(
              chunk.map((a) => ({
                label: a.mode === "mine" && pools.workVerb === "gather" ? "Gather" : a.label,
                value: a.mode,
                description: a.description.slice(0, 100),
              })),
            ),
        ),
      );
    }
  }
  // Discord allows five rows on a message. Past that, the rest are on the
  // typed commands and the web, and the menu says so rather than failing.
  const dropped = rows.length > 5 ? rows.length - 5 : 0;
  if (rows.length === 0) lines.push("-# There's nothing you can do right now.");
  lines.push(
    `-# ${leftOut > 0 ? `${leftOut} more you can't do right now` : "Everything else"} is on your sheet: ${WEB_ORIGIN}/character`,
  );
  if (dropped) lines.push(`-# ${dropped} more section${dropped === 1 ? "" : "s"} didn't fit — type the command instead.`);
  return { content: lines.join("\n"), components: rows.slice(0, 5) };
}

// The Actions button and /actions. Not fleeting: the menu is a surface a
// player keeps open and comes back to, and every pick answers in a message of
// its own below it.
async function handleActionsOpen(interaction) {
  await ack(interaction);
  const character = await loadActor(interaction);
  if (!character) return respond(interaction, "You don't have a living character.");
  const pools = await actionPoolsFor(prisma, character);
  return respond(interaction, menuPayload(pools, { placeName: character.location?.name ?? null }), { fleeting: false });
}

// A pick from the menu: the verb starts in a message of its own, so the menu
// stays where it is for the next one.
function handleMenuPick(interaction) {
  return startVerb(interaction, interaction.values?.[0]);
}

// Reads and the menu stay clickable between sessions (SESSIONS.md §5); every
// verb's own final step is an act and meets the session gate.
const OPEN_VERB_PREFIXES = [
  ACTIONS_OPEN_ID,
  MENU_PREFIX,
  ...ACTIONS.filter((a) => a.open).map((a) => `${VERB_PREFIX}${a.mode}:`),
];

function isOpenCommand(commandName, sub) {
  if (commandName === "actions") return true;
  return Boolean(actionForCommand(commandName, sub ?? null)?.open);
}

// For the Actions button on a Location anchor and the console.
function actionsButton() {
  return new ButtonBuilder().setCustomId(ACTIONS_OPEN_ID).setLabel("Actions").setStyle(ButtonStyle.Secondary);
}

module.exports = {
  VERBS,
  VERB_COMMANDS,
  ACTIONS_OPEN_ID,
  MENU_PREFIX,
  VERB_PREFIX,
  MODAL_PREFIX,
  OPEN_VERB_PREFIXES,
  isOpenCommand,
  startVerb,
  startFromCommand,
  handleVerbComponent,
  handleVerbModal,
  handleActionsOpen,
  handleMenuPick,
  menuPayload,
  actionsButton,
};
