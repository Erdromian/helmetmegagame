"use server";

// The Oracle's settings, and the two buttons beside them.
// See docs/systemdocs/ORACLE.md.
//
// Separate from actions.js, which is already long and is mostly the generic
// GameConfig form. These need their own file because of the API key: exactly
// one function in the codebase writes it and none reads it back to a client,
// and that is far easier to keep true when it lives in a file of its own.
//
// Every action re-checks with requireDev("super"). A hidden nav item is a hint,
// not a lock, and a server action is a public endpoint.

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { requireDev } from "@/lib/devAccess";
import { getOpenTurn } from "@/lib/turn";
import { testConnection } from "@lifeweb/db/lib/oracleClient";
import { runOracle } from "@lifeweb/db/lib/oracle";
import { correspondentPrompt, editorPrompt } from "@lifeweb/db/lib/oraclePrompts";

const MAX_PROMPT = 8000;
const MAX_URL = 300;
const MAX_MODEL = 200;

// A <textarea> submits its value with CRLF line endings — the HTML spec says so
// — and every default in oraclePrompts.js is written with LF. So the "store NULL
// if it matches the default" comparison below could never match, and pressing
// Save on a form nobody had edited pinned a CRLF copy of the default into
// GameConfig forever.
//
// That is exactly the failure the comment on that comparison says it exists to
// prevent: production stopped reading the shipped prompts, and editing them in a
// later deploy silently did nothing. Both columns were sitting in that state
// when this was found. Normalising here fixes it for every field at once.
function clean(raw, max) {
  const text = raw == null ? "" : String(raw).replace(/\r\n/g, "\n").trim();
  return text.slice(0, max);
}

// What the panel is allowed to know about the key: that there is one, when it
// was set and by whom. Never the key.
//
// This is the whole reason a masked field is safe — a "write-only" input that
// still ships its value to the browser in the server-rendered HTML would be
// masked to the eye and readable in View Source.
export async function loadOracleSettings() {
  await requireDev("super");
  const config = await prisma.gameConfig.findFirst({
    select: {
      oracleEnabled: true,
      oraclePlaytest: true,
      oracleProvider: true,
      oracleBaseUrl: true,
      oracleModel: true,
      oracleApiKeySetAt: true,
      oracleApiKeySetBy: true,
      oracleMemoryTurns: true,
      oracleIncludeChat: true,
      oracleCorrespondentPrompt: true,
      oracleEditorPrompt: true,
      // Selected only to derive the boolean below. It never leaves this
      // function.
      oracleApiKey: true,
    },
  });
  if (!config) return null;

  const { oracleApiKey, ...rest } = config;
  return {
    ...rest,
    hasApiKey: Boolean(oracleApiKey),
    // The effective prompts, so the textareas show what is actually running
    // rather than an empty box that means "the default, which is elsewhere".
    correspondentPrompt: correspondentPrompt(config),
    editorPrompt: editorPrompt(config),
  };
}

export async function saveOracleSettings(formData) {
  const session = await requireDev("super");
  const config = await prisma.gameConfig.findFirst({ select: { id: true } });
  if (!config) return { ok: false, error: "No configuration row." };

  const data = {
    oracleEnabled: formData.get("oracleEnabled") === "on",
    // Whether a chronicle is WRITTEN and who may READ one are different
    // questions, so they are different columns. See ORACLE.md §12.
    oraclePlaytest: formData.get("oraclePlaytest") === "on",
    oracleIncludeChat: formData.get("oracleIncludeChat") === "on",
    oracleProvider: clean(formData.get("oracleProvider"), 60) || "openrouter",
    oracleBaseUrl: clean(formData.get("oracleBaseUrl"), MAX_URL) || "https://openrouter.ai/api/v1",
    oracleModel: clean(formData.get("oracleModel"), MAX_MODEL) || "deepseek/deepseek-v4-flash",
    oracleMemoryTurns: Math.min(10, Math.max(0, Number.parseInt(formData.get("oracleMemoryTurns"), 10) || 0)),
  };

  // A prompt matching the shipped default is stored as NULL, not as a copy.
  // Otherwise editing the default in a later deploy would silently do nothing
  // for anyone who had ever opened this form and pressed Save.
  const correspondent = clean(formData.get("correspondentPrompt"), MAX_PROMPT);
  const editor = clean(formData.get("editorPrompt"), MAX_PROMPT);
  data.oracleCorrespondentPrompt = !correspondent || correspondent === correspondentPrompt({}) ? null : correspondent;
  data.oracleEditorPrompt = !editor || editor === editorPrompt({}) ? null : editor;

  // The key is REPLACED, never edited. An empty box means "leave it alone", so
  // saving the form after a normal edit cannot wipe the credential — which is
  // the failure a masked field invites if the blank submits as a blank.
  const key = clean(formData.get("oracleApiKey"), 400);
  if (key) {
    data.oracleApiKey = key;
    data.oracleApiKeySetAt = new Date();
    data.oracleApiKeySetBy = session.discordUserId;
  }

  await prisma.gameConfig.update({ where: { id: config.id }, data });
  revalidatePath("/gm/dev");
  return { ok: true };
}

export async function clearOracleApiKey() {
  await requireDev("super");
  const config = await prisma.gameConfig.findFirst({ select: { id: true } });
  if (!config) return { ok: false, error: "No configuration row." };
  await prisma.gameConfig.update({
    where: { id: config.id },
    data: { oracleApiKey: null, oracleApiKeySetAt: null, oracleApiKeySetBy: null },
  });
  revalidatePath("/gm/dev");
  return { ok: true };
}

// A handful of tokens, to prove the key, the base URL and the model name all at
// once. This is the one place the key is read outside a run.
export async function testOracleConnection() {
  await requireDev("super");
  const config = await prisma.gameConfig.findFirst();
  if (!config?.oracleApiKey) return { ok: false, error: "No API key is set." };
  return testConnection(config);
}

// Draft the chronicle for a turn on demand.
//
// Defaults to the OPEN turn. It used to default to the turn before it, because
// the open turn's moves were still being filed and a synopsis of it would have
// been a synopsis of a half-written turn — which was right while the Oracle ran
// at turn close, and is wrong now that it runs at the Move cutoff. The open
// turn is the one a GM is adjudicating, so it is the one this button is for.
// Any turn can still be asked for by number.
//
// This is also the recovery path when the automatic run never happened: a bot
// down across the whole three-hour window, or a provider outage that ate its
// attempts. Nothing revisits a turn once it has closed.
export async function runOracleNow(turnNumber = null) {
  await requireDev("super");

  let turn;
  if (turnNumber != null) {
    turn = await prisma.turn.findUnique({ where: { number: Number(turnNumber) }, select: { id: true } });
  } else {
    turn =
      (await getOpenTurn()) ??
      (await prisma.turn.findFirst({ orderBy: { number: "desc" }, select: { id: true } }));
  }
  if (!turn) return { ok: false, error: "No turn to write about yet." };

  // No ledger here — Run now is a person waiting on a button, so a failure is
  // TOLD to them rather than swallowed and left for a resume. That is the whole
  // difference from the turn path: the pass-through step below deliberately
  // does not catch, so a provider error surfaces instead of leaving five good
  // pages and one silent hole. It no longer STOPS anything — the six zones run
  // at once, so the others are already written by the time one of them fails.
  let result;
  try {
    result = await runOracle(prisma, { turnId: turn.id, step: (_key, fn) => fn() });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  revalidatePath("/gm/oracle");
  revalidatePath("/gm/dev");
  return result.ran ? { ok: true, zones: result.zones } : { ok: false, error: result.reason };
}
