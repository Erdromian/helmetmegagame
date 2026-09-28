// The Meister's Terminal on Discord (docs/systemdocs/MEISTERY.md).
//
// The twin of Chat's dialog: the totals and the tax, every account (set a
// balance, a character's own wage, close it), the jobs' wages, connecting a
// ring, and the ledger. Every rule and every refusal live in
// db/lib/meisterTerminal.js, so this face and Chat's cannot drift — this file
// is buttons, selects and modals only.
//
// ONE PANEL, edited in place. The room's button opens it as an ephemeral
// reply; every `mst:` press after that is on the panel itself, so it is acked
// with deferUpdate and redrawn where it is. The ones that open a MODAL are not
// acked at all: showModal IS the acknowledgement (CLAUDE.md, "Slash commands").
// A panel is not fleeting — a screen that deletes itself a minute after the
// last press would vanish while somebody was reading the ledger.
//
// What a screen needs to remember between presses — a search, the ring being
// connected and its seats — is kept per user in `drafts` for 15 minutes, the
// bot/src/lib/editModal.js#pendingEdits posture. A restart just ends the draft.
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
const {
  meisterTerminalState,
  setTaxRate,
  setAccountBalance,
  closeAccount,
  setWage,
  connectRing,
} = require("@lifeweb/db/lib/meisterTerminal");
const { loadTreasuryTransactions } = require("@lifeweb/db/lib/treasuryLedger");
const { MEISTER_TERMINAL_TEXT: T, fillMeisterText, signedObols } = require("@lifeweb/db/lib/meisterTerminalText");
const { afterInventoryChangeDb } = require("@lifeweb/db/lib/inventoryTail");

const PREFIX = "mst:";
const PAGE = 15; // lines a screen lists; well inside Discord's 2000 characters
const SELECT_CAP = 25; // Discord's cap on one select's options
const DRAFT_TTL_MS = 15 * 60 * 1000;

// ─── Drafts ──────────────────────────────────────────────────────────────────

const drafts = new Map();

function draftOf(userId) {
  const now = Date.now();
  for (const [key, d] of drafts) if (now - d.at > DRAFT_TTL_MS) drafts.delete(key);
  const d = drafts.get(userId) ?? { query: "", ringTagId: null, seats: new Set(), at: now };
  d.at = now;
  drafts.set(userId, d);
  return d;
}

// ─── Small builders ──────────────────────────────────────────────────────────

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(style).setDisabled(disabled);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function modal(id, title, fields) {
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(String(title).slice(0, 45))
    .addComponents(
      ...fields.map((f) =>
        row(
          new TextInputBuilder()
            .setCustomId(f.id)
            .setLabel(String(f.label).slice(0, 45))
            .setStyle(TextInputStyle.Short)
            .setRequired(f.required !== false)
            .setMaxLength(f.max ?? 12)
            .setValue(f.value ?? "")
            .setPlaceholder(String(f.placeholder ?? "").slice(0, 100)),
        ),
      ),
    );
}

function pageCount(total) {
  return Math.max(1, Math.ceil(total / PAGE));
}

function clampPage(page, total) {
  const n = Number.parseInt(page, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), pageCount(total) - 1);
}

function pageLine(page, total) {
  return `-# ${fillMeisterText("pageOf", { page: page + 1, pages: pageCount(total) })}`;
}

function classLabel(value) {
  if (value === "OFFSHORE") return T.classOffshore;
  if (value === "CROWN") return T.classCrown;
  return T.classTreasury;
}

function wageText(wage) {
  if (!wage?.source) return "";
  return ` · ${signedObols(wage.amount)} ${wage.source === "job" ? T.wageFromJob : T.wageOwn}`;
}

function openTurn() {
  return prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }).catch(() => null);
}

async function load(userId) {
  return meisterTerminalState(prisma, userId);
}

function refusal(state) {
  return { content: state.error, components: [] };
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function homeScreen(state) {
  const lines = [
    `**${T.title}**`,
    `${T.totalVault}: **${state.vault} ¢** · ${T.totalClaimed}: ${state.claims} ¢ · ${T.totalOnOrder}: ${state.onOrder} ¢`,
    `${T.totalTax}: **${state.taxRate}%** · ${fillMeisterText("dailyBill", state.dailyBill)}`,
  ];
  if (state.short) lines.push(`**${T.short}**`);
  return {
    content: lines.join("\n"),
    components: [
      row(
        button(`${PREFIX}tax`, T.setTaxButton),
        button(`${PREFIX}acc:0`, T.tabAccounts, ButtonStyle.Primary),
        button(`${PREFIX}wages:0`, T.tabWages),
        button(`${PREFIX}rings`, T.tabRings),
        button(`${PREFIX}led:0`, T.tabLedger),
      ),
    ],
  };
}

function matches(account, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [account.holderName, account.fingerprint, account.roleName].some((v) => String(v ?? "").toLowerCase().includes(q));
}

function accountsScreen(state, draft, rawPage) {
  const rows = state.accounts.filter((a) => matches(a, draft.query));
  const page = clampPage(rawPage, rows.length);
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const lines = [`**${T.tabAccounts}**`];
  if (draft.query) lines.push(`-# ${fillMeisterText("searching", { query: draft.query })}`);
  if (!slice.length) lines.push(T.noAccounts);
  for (const a of slice) {
    const lock = a.locked ? ` · ${T.lockedBadge}` : "";
    lines.push(`· ${a.holderName} — \`${a.fingerprint}\` — ${a.roleName || "—"} — **${a.balance} ¢**${wageText(a.wage)}${lock}`);
  }
  lines.push(pageLine(page, rows.length));

  const components = [];
  if (slice.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}pick`)
          .setPlaceholder(T.pickAccount)
          .addOptions(
            slice.map((a) => ({
              label: a.holderName.slice(0, 100) || a.fingerprint,
              value: a.id,
              description: `${a.fingerprint} · ${a.balance} ¢`.slice(0, 100),
            })),
          ),
      ),
    );
  }
  components.push(
    row(
      button(`${PREFIX}acc:${page - 1}`, T.prev, ButtonStyle.Secondary, page === 0),
      button(`${PREFIX}acc:${page + 1}`, T.next, ButtonStyle.Secondary, page >= pageCount(rows.length) - 1),
      button(`${PREFIX}accq`, T.search),
      button(`${PREFIX}accx`, T.clearSearch, ButtonStyle.Secondary, !draft.query),
      button(`${PREFIX}home`, T.back),
    ),
  );
  return { content: lines.join("\n"), components };
}

function accountScreen(state, accountId) {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) return { content: T.noAccount, components: [row(button(`${PREFIX}acc:0`, T.back))] };
  const lines = [
    `**${a.holderName}** — \`${a.fingerprint}\``,
    `${T.colClass}: ${classLabel(a.class)} · ${T.colJob}: ${a.roleName || "—"}`,
    `${T.colBalance}: **${a.balance} ¢** · ${T.colWage}: ${a.wage?.source ? wageText(a.wage).slice(3) : T.wageNone}`,
  ];
  if (a.locked) lines.push(`-# ${T.lockedNote}`);
  const buttons = a.locked
    ? [button(`${PREFIX}hist:${a.id}:0`, T.history), button(`${PREFIX}acc:0`, T.back)]
    : [
        button(`${PREFIX}bal:${a.id}`, T.balanceSet, ButtonStyle.Primary),
        button(`${PREFIX}cw:${a.characterId}`, T.wageButton, ButtonStyle.Secondary, a.status !== "ALIVE"),
        button(`${PREFIX}hist:${a.id}:0`, T.history),
        button(`${PREFIX}del:${a.id}`, T.deleteButton, ButtonStyle.Danger),
        button(`${PREFIX}acc:0`, T.back),
      ];
  return { content: lines.join("\n"), components: [row(...buttons)] };
}

function closeAskScreen(state, accountId) {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) return { content: T.deleteGone, components: [row(button(`${PREFIX}acc:0`, T.back))] };
  return {
    content: `**${T.deleteButton}**\n${fillMeisterText("deleteConfirm", { name: a.holderName })}`,
    components: [
      row(button(`${PREFIX}delok:${a.id}`, T.deleteButton, ButtonStyle.Danger), button(`${PREFIX}one:${a.id}`, T.cancel)),
    ],
  };
}

function wagesScreen(state, rawPage) {
  const jobs = state.jobs;
  const pages = Math.max(1, Math.ceil(jobs.length / SELECT_CAP));
  const page = Math.min(Math.max(Number.parseInt(rawPage, 10) || 0, 0), pages - 1);
  const slice = jobs.slice(page * SELECT_CAP, page * SELECT_CAP + SELECT_CAP);
  const setJobs = jobs.filter((f) => f.amount != null);

  const lines = [`**${T.tabWages}**`, `-# ${T.wagesHelp}`, fillMeisterText("dailyBill", state.dailyBill), `**${T.wagesByJob}**`];
  if (!setJobs.length) lines.push(T.wageNone);
  for (const f of setJobs) {
    lines.push(`· ${f.name} — ${signedObols(f.amount)} (${fillMeisterText("jobHolders", { count: f.holders })})`);
  }
  lines.push(`**${T.wagesByCharacter}**`);
  if (!state.characterWages.length) lines.push(T.noCharacterWages);
  for (const w of state.characterWages) lines.push(`· ${w.name} — ${signedObols(w.amount)}`);

  return {
    content: lines.join("\n"),
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}job`)
          .setPlaceholder(T.pickJob)
          .addOptions(
            slice.map((f) => ({
              label: f.name.slice(0, 100),
              value: f.roleId,
              description: `${f.groupName} · ${f.amount == null ? T.wageNone : signedObols(f.amount)}`.slice(0, 100),
            })),
          ),
      ),
      row(
        button(`${PREFIX}wages:${page - 1}`, T.prev, ButtonStyle.Secondary, page === 0),
        button(`${PREFIX}wages:${page + 1}`, T.next, ButtonStyle.Secondary, page >= pages - 1),
        button(`${PREFIX}home`, T.back),
      ),
    ],
  };
}

function ringsScreen(state) {
  const rings = state.rings ?? [];
  if (!rings.length) {
    return { content: `**${T.registerTitle}**\n${T.registerNone}`, components: [row(button(`${PREFIX}home`, T.back))] };
  }
  return {
    content: `**${T.registerTitle}**\n-# ${T.registerIntro}`,
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}ring`)
          .setPlaceholder(T.pickRing)
          .addOptions(
            rings.slice(0, SELECT_CAP).map((r) => ({
              label: r.name.slice(0, 100),
              value: r.tagId,
              description: (r.ownerName ?? r.initials ?? "").slice(0, 100) || undefined,
            })),
          ),
      ),
      row(button(`${PREFIX}home`, T.back)),
    ],
  };
}

// The seats, for a ring the terminal has never seen: as many multi-selects as
// the list needs (Discord caps one at 25), each keeping what was picked on it.
function seatsScreen(state, draft) {
  const ring = (state.rings ?? []).find((r) => r.tagId === draft.ringTagId);
  if (!ring) return ringsScreen(state);
  const seats = (state.seats ?? []).filter((s) => s.allowed);
  const components = [];
  for (let i = 0; i < seats.length && components.length < 4; i += SELECT_CAP) {
    const chunk = seats.slice(i, i + SELECT_CAP);
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}seats:${i / SELECT_CAP}`)
          .setPlaceholder(`${T.pickSeats} ${chunk[0].name} – ${chunk[chunk.length - 1].name}`.slice(0, 150))
          .setMinValues(0)
          .setMaxValues(chunk.length)
          .addOptions(chunk.map((s) => ({ label: s.name.slice(0, 100), value: s.slug, default: draft.seats.has(s.slug) }))),
      ),
    );
  }
  components.push(row(button(`${PREFIX}acct`, T.continue, ButtonStyle.Primary), button(`${PREFIX}rings`, T.back)));
  const shut = (state.seats ?? []).filter((s) => !s.allowed);
  const lines = [`**${ring.name}**`, `-# ${T.registerRoles}`];
  for (const s of shut) lines.push(`-# ${fillMeisterText("registerNeedsAuth", { role: s.name, item: s.needs })}`);
  return { content: lines.join("\n"), components };
}

function accountStepScreen(state, draft) {
  const ring = (state.rings ?? []).find((r) => r.tagId === draft.ringTagId);
  if (!ring) return ringsScreen(state);
  const options = [];
  if (!ring.ownerGone) {
    options.push({
      label: (ring.ownerAccountId
        ? fillMeisterText("registerAccountOwn", { name: ring.ownerName })
        : fillMeisterText("registerAccountNew", { name: ring.ownerName ?? ring.initials })
      ).slice(0, 100),
      value: "new",
    });
  }
  options.push({ label: T.byFingerprint, value: "fp" });
  return {
    content: [`**${ring.name}**`, T.pickAccountFor].join("\n"),
    components: [
      row(new StringSelectMenuBuilder().setCustomId(`${PREFIX}acctpick`).setPlaceholder(T.pickAccountFor).addOptions(options)),
      row(button(`${PREFIX}rings`, T.back)),
    ],
  };
}

async function ledgerScreen(accountId, rawPage) {
  const rows = await loadTreasuryTransactions(prisma, { accountId });
  const page = clampPage(rawPage, rows.length);
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const lines = [`**${T.tabLedger}**`];
  if (!slice.length) lines.push(T.ledgerEmpty);
  for (const r of slice) {
    const who = r.holderName || "—";
    const detail = r.detail ? ` — ${r.detail}` : "";
    lines.push(`\`${r.turn ?? "—"}\` ${who} · ${r.kind} · **${signedObols(r.amount)}**${detail}`.slice(0, 180));
  }
  lines.push(pageLine(page, rows.length));
  const base = accountId ? `${PREFIX}hist:${accountId}:` : `${PREFIX}led:`;
  return {
    content: lines.join("\n"),
    components: [
      row(
        button(`${base}${page - 1}`, T.prev, ButtonStyle.Secondary, page === 0),
        button(`${base}${page + 1}`, T.next, ButtonStyle.Secondary, page >= pageCount(rows.length) - 1),
        button(accountId ? `${PREFIX}one:${accountId}` : `${PREFIX}home`, T.back),
      ),
    ],
  };
}

// ─── Plumbing ────────────────────────────────────────────────────────────────

// Redraws the panel in place, with the last action's sentence on top.
async function show(interaction, screen, line = null) {
  await respond(
    interaction,
    { ...screen, content: [line, screen.content].filter(Boolean).join("\n\n") },
    { fleeting: false },
  );
}

// Reads the terminal, then draws `build(state)`; a refusal replaces the panel.
async function redraw(interaction, build, line = null) {
  const state = await load(interaction.user.id);
  if (!state.ok) return show(interaction, refusal(state), line);
  return show(interaction, await build(state), line);
}

function outcome(result) {
  return result.ok ? result.line : result.error;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// The room's own button: a fresh ephemeral panel.
async function handleMeisterTerminalOpen(interaction) {
  await ack(interaction);
  draftOf(interaction.user.id).query = "";
  await redraw(interaction, homeScreen);
}

const BUTTON_ROUTES = [
  [`${PREFIX}home`, async (i) => { await ack(i, { update: true }); await redraw(i, homeScreen); }],
  [`${PREFIX}tax`, async (i) => {
    const state = await load(i.user.id).catch(() => null);
    await i.showModal(modal(`${PREFIX}taxm`, T.setTaxButton, [
      { id: "rate", label: T.taxLabel, value: state?.ok ? String(state.taxRate) : "", max: 3 },
    ]));
  }],
  [`${PREFIX}acc:`, async (i, page) => { await ack(i, { update: true }); await redraw(i, (s) => accountsScreen(s, draftOf(i.user.id), page)); }],
  [`${PREFIX}accq`, async (i) => {
    await i.showModal(modal(`${PREFIX}accqm`, T.search, [{ id: "q", label: T.searchLabel, max: 40, value: draftOf(i.user.id).query }]));
  }],
  [`${PREFIX}accx`, async (i) => {
    await ack(i, { update: true });
    draftOf(i.user.id).query = "";
    await redraw(i, (s) => accountsScreen(s, draftOf(i.user.id), 0));
  }],
  [`${PREFIX}one:`, async (i, id) => { await ack(i, { update: true }); await redraw(i, (s) => accountScreen(s, id)); }],
  [`${PREFIX}bal:`, async (i, id) => {
    const state = await load(i.user.id).catch(() => null);
    const a = state?.ok ? state.accounts.find((x) => x.id === id) : null;
    await i.showModal(modal(`${PREFIX}balm:${id}`, a ? `${T.balanceSet}: ${a.holderName}` : T.balanceSet, [
      { id: "balance", label: T.balanceLabel, value: a ? String(a.balance) : "" },
    ]));
  }],
  [`${PREFIX}cw:`, async (i, characterId) => {
    const state = await load(i.user.id).catch(() => null);
    const a = state?.ok ? state.accounts.find((x) => x.characterId === characterId) : null;
    const own = a?.wage?.source === "character" ? String(a.wage.amount) : "";
    await i.showModal(modal(`${PREFIX}cwm:${characterId}`, `${T.wageLabel}: ${a?.characterName ?? ""}`, [
      { id: "amount", label: T.wageLabel, value: own, required: false, placeholder: T.wageBlankClears },
    ]));
  }],
  [`${PREFIX}hist:`, async (i, rest) => {
    await ack(i, { update: true });
    const [accountId, page] = rest.split(":");
    const state = await load(i.user.id);
    if (!state.ok) return show(i, refusal(state));
    await show(i, await ledgerScreen(accountId, page));
  }],
  [`${PREFIX}del:`, async (i, id) => { await ack(i, { update: true }); await redraw(i, (s) => closeAskScreen(s, id)); }],
  [`${PREFIX}delok:`, async (i, id) => {
    await ack(i, { update: true });
    const result = await closeAccount(prisma, i.user.id, { accountId: id, turn: await openTurn() });
    await redraw(i, (s) => accountsScreen(s, draftOf(i.user.id), 0), outcome(result));
  }],
  [`${PREFIX}wages:`, async (i, page) => { await ack(i, { update: true }); await redraw(i, (s) => wagesScreen(s, page)); }],
  [`${PREFIX}rings`, async (i) => { await ack(i, { update: true }); await redraw(i, ringsScreen); }],
  [`${PREFIX}acct`, async (i) => { await ack(i, { update: true }); await redraw(i, (s) => accountStepScreen(s, draftOf(i.user.id))); }],
  [`${PREFIX}led:`, async (i, page) => {
    await ack(i, { update: true });
    const state = await load(i.user.id);
    if (!state.ok) return show(i, refusal(state));
    await show(i, await ledgerScreen(null, page));
  }],
];

const SELECT_ROUTES = [
  [`${PREFIX}pick`, async (i) => { await ack(i, { update: true }); await redraw(i, (s) => accountScreen(s, i.values?.[0])); }],
  [`${PREFIX}job`, async (i) => {
    const roleId = i.values?.[0] ?? "";
    const state = await load(i.user.id).catch(() => null);
    const job = state?.ok ? state.jobs.find((f) => f.roleId === roleId) : null;
    await i.showModal(modal(`${PREFIX}fwm:${roleId}`, `${T.wageLabel}: ${job?.name ?? ""}`, [
      { id: "amount", label: T.wageLabel, value: job?.amount == null ? "" : String(job.amount), required: false, placeholder: T.wageBlankClears },
    ]));
  }],
  [`${PREFIX}ring`, async (i) => {
    await ack(i, { update: true });
    const draft = draftOf(i.user.id);
    draft.ringTagId = i.values?.[0] ?? null;
    draft.seats = new Set();
    await redraw(i, (s) => seatsScreen(s, draft));
  }],
  [`${PREFIX}seats:`, async (i, chunk) => {
    await ack(i, { update: true });
    const draft = draftOf(i.user.id);
    await redraw(i, (s) => {
      // This select owns only its own slice of the seats: replace that slice.
      const seats = (s.seats ?? []).filter((x) => x.allowed);
      const start = Number(chunk) * SELECT_CAP;
      for (const seat of seats.slice(start, start + SELECT_CAP)) draft.seats.delete(seat.slug);
      for (const slug of i.values ?? []) draft.seats.add(slug);
      return seatsScreen(s, draft);
    });
  }],
  [`${PREFIX}acctpick`, async (i) => {
    const choice = i.values?.[0];
    if (choice === "fp") {
      await i.showModal(modal(`${PREFIX}fpm`, T.byFingerprint, [{ id: "fp", label: T.fingerprintLabel, max: 16 }]));
      return;
    }
    await ack(i, { update: true });
    await finishRing(i, { newAccount: true });
  }],
];

async function finishRing(interaction, account) {
  const draft = draftOf(interaction.user.id);
  if (!draft.ringTagId) return redraw(interaction, ringsScreen, T.draftExpired);
  const result = await connectRing(prisma, interaction.user.id, {
    ringTagId: draft.ringTagId,
    roleSlugs: [...draft.seats],
    ...account,
    turn: await openTurn(),
  });
  if (result.ok) {
    draft.ringTagId = null;
    draft.seats = new Set();
    // The ring may already be on a finger, and its doors change.
    if (result.characterId) await afterInventoryChangeDb(prisma, [result.characterId]).catch(() => {});
  }
  return redraw(interaction, ringsScreen, outcome(result));
}

const MODAL_ROUTES = [
  [`${PREFIX}taxm`, async (i) => {
    await ack(i, { update: true });
    const result = await setTaxRate(prisma, i.user.id, { rate: i.fields.getTextInputValue("rate").trim(), turn: await openTurn() });
    await redraw(i, homeScreen, outcome(result));
  }],
  [`${PREFIX}accqm`, async (i) => {
    await ack(i, { update: true });
    draftOf(i.user.id).query = i.fields.getTextInputValue("q").trim().slice(0, 40);
    await redraw(i, (s) => accountsScreen(s, draftOf(i.user.id), 0));
  }],
  [`${PREFIX}balm:`, async (i, id) => {
    await ack(i, { update: true });
    const result = await setAccountBalance(prisma, i.user.id, {
      accountId: id,
      balance: i.fields.getTextInputValue("balance").trim(),
      turn: await openTurn(),
    });
    await redraw(i, (s) => accountScreen(s, id), outcome(result));
  }],
  [`${PREFIX}cwm:`, async (i, characterId) => {
    await ack(i, { update: true });
    const raw = i.fields.getTextInputValue("amount").trim();
    const result = await setWage(prisma, i.user.id, { characterId, amount: raw === "" ? null : raw, turn: await openTurn() });
    await redraw(i, (s) => accountScreen(s, s.accounts.find((a) => a.characterId === characterId)?.id), outcome(result));
  }],
  [`${PREFIX}fwm:`, async (i, roleId) => {
    await ack(i, { update: true });
    const raw = i.fields.getTextInputValue("amount").trim();
    const result = await setWage(prisma, i.user.id, { roleId, amount: raw === "" ? null : raw, turn: await openTurn() });
    await redraw(i, (s) => wagesScreen(s, 0), outcome(result));
  }],
  [`${PREFIX}fpm`, async (i) => {
    await ack(i, { update: true });
    await finishRing(i, { fingerprint: i.fields.getTextInputValue("fp").trim() });
  }],
];

// Every `mst:` interaction, whichever kind it is. True when it was ours.
async function routeMeisterTerminal(interaction) {
  const id = interaction.customId ?? "";
  if (!id.startsWith(PREFIX)) return false;
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

module.exports = { handleMeisterTerminalOpen, routeMeisterTerminal };
