// Auto-confirming a Desire claim from what the game already knows
// (docs/systemdocs/DESIRES.md §6b). A claim still pays the instant it lands;
// this only decides whether it also skips the GM review queue. A template's
// `autoVerify:` block (docs/desires.yaml) names ONE check, and the check looks
// for proof: an audit row written this turn, or — for `holds` — what the
// character is carrying at the moment they claim.
//
// Proof is SUFFICIENT, never necessary. Finding it confirms the claim; not
// finding it proves nothing, and the claim waits for a GM exactly as it did
// before this existed. So every check below only matches on evidence nobody
// could argue with, and anything fuzzier is left to the queue.
//
// "This turn" is `createdAt >= Turn.startedAt`, never AuditLog.turnId — that
// column is only set where a per-turn ration counts the row (REQUESTS.md §1a),
// so it is null on transfers, crafts and builds. And rows are matched by tag
// ID, because the consume, vending and transfer rows carry tagId/tagName but
// no slug.
//
// Zero requires of db/index.js (db/lib/dm.js convention): the loader takes
// `tx` as a parameter, and the matcher is pure.

class AutoVerifyShapeError extends Error {}

// The named verbs `check: act` can point at — one audit shape each. `side`
// says which half of the row has to be the claimant: "actor" (their account
// wrote it, since this character was created), "target" (it names this
// character), or "any" (the `test` decides from `details`).
const ACTS = Object.freeze({
  bury: {
    types: ["request_bury_character", "request_engrave_headstone"],
    side: "actor",
    note: (r) => (r.actionType === "request_engrave_headstone" ? "Engraved a headstone" : "Buried a body"),
  },
  brand: {
    types: ["request_brand_character"],
    side: "actor",
    note: (r) => `Branded ${r.details?.targetName ?? "somebody"}`,
  },
  // Either outcome: the torture happened whether or not they broke.
  torture: {
    types: ["request_torture_character"],
    side: "actor",
    note: (r) => `Tortured ${r.details?.targetName ?? "somebody"}`,
  },
  crucify: {
    types: ["request_crucify_character"],
    side: "actor",
    note: (r) => `Crucified ${r.details?.targetName ?? "somebody"}`,
  },
  "donate-own-blood": {
    types: ["request_donate_blood"],
    side: "actor",
    test: (r, ctx) => r.details?.targetCharacterId === ctx.characterId,
    note: () => "Gave their own blood to the Lifeweb",
  },
  "donate-others-blood": {
    types: ["request_donate_blood"],
    side: "actor",
    test: (r, ctx) => Boolean(r.details?.targetCharacterId) && r.details.targetCharacterId !== ctx.characterId,
    note: (r) => `Gave ${r.details?.targetName ?? "somebody"}'s blood to the Lifeweb`,
  },
  "feed-lifeweb": {
    types: ["request_feed_person"],
    side: "actor",
    test: (r) => r.details?.killed === true,
    note: (r) => `Fed ${r.details?.targetName ?? "somebody"} to the Lifeweb`,
  },
  // `human` is written by the butcher action itself; a row from before it was
  // added has none, and falls to the queue.
  "butcher-human": {
    types: ["request_butcher_corpse"],
    side: "actor",
    test: (r) => r.details?.human === true,
    note: (r) => `Butchered ${r.details?.corpse ?? "a body"}`,
  },
  "escape-bonds": {
    types: ["request_break_restraints"],
    side: "target",
    test: (r) => r.details?.success === true,
    note: () => "Broke their restraints",
  },
  // A routine cure from somebody else. A Gambit heal is only an attempt until
  // its pass resolves it (`pending`), so it proves nothing yet.
  treated: {
    types: ["request_heal_character"],
    side: "target",
    test: (r) => r.details?.selfHeal === false && !r.details?.pending,
    note: (r) => `Treated for ${r.details?.tagName ?? "an ailment"}`,
  },
  "let-through-town-gate": {
    types: ["gate_passage_approved"],
    side: "target",
    note: (r) => `Let through the Town gate by ${r.details?.clerkName ?? "the gate"}`,
  },
  "heard-confession": {
    types: ["confession_accepted"],
    side: "any",
    test: (r, ctx) => r.details?.chaplainId === ctx.characterId,
    note: (r) => `Heard ${r.details?.penitentName ?? "somebody"}'s confession`,
  },
  // `succeeded` is written by the lesson itself; a failed roll learned nothing.
  "learned-skill": {
    types: ["lesson_accepted"],
    side: "target",
    test: (r) => r.details?.succeeded === true,
    note: (r) => `Learned ${r.details?.tagName ?? "a skill"} from ${r.details?.teacherName ?? "somebody"}`,
  },
  "taught-skill": {
    types: ["lesson_accepted"],
    side: "any",
    test: (r, ctx) => r.details?.teacherId === ctx.characterId && r.details?.succeeded === true,
    note: (r) => `Taught ${r.details?.learnerName ?? "somebody"} ${r.details?.tagName ?? "a skill"}`,
  },
});

// Each check: the parameters it takes (and which are required), and the audit
// action types its loader should fetch. `holds` reads the sheet, not the log.
const CHECKS = Object.freeze({
  consumed: { required: ["tags"], optional: [], types: () => ["request_consume_tag"] },
  kissed: { required: [], optional: [], types: () => ["kiss_accepted"] },
  slots: { required: [], optional: ["minWin"], types: () => ["slot_machine"] },
  bought: { required: [], optional: ["tags"], types: () => ["vending_buy"] },
  crafted: { required: ["tags"], optional: [], types: () => ["request_craft_tag", "craft_yield_arrived"] },
  built: { required: ["structure"], optional: [], types: () => ["build_completed"] },
  gave: { required: ["tags", "people"], optional: [], types: () => ["request_transfer_tag"] },
  holds: { required: ["tags"], optional: ["quantity"], types: () => [] },
  act: { required: ["action"], optional: [], types: (rule) => ACTS[rule.action]?.types ?? [] },
});

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// The grammar check the sync runs in its pass 0. Throws on anything off, and
// returns the canonical form (fixed key order) the sync stores, so a re-sync
// that changed nothing diffs clean. `knownTagSlugs` is the Tag catalog.
function validateAutoVerify(slug, raw, { knownTagSlugs } = {}) {
  const where = `docs/desires.yaml: desire "${slug}" autoVerify`;
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AutoVerifyShapeError(`${where} must be a map with a "check"`);
  }
  const spec = CHECKS[raw.check];
  if (!spec) {
    throw new AutoVerifyShapeError(
      `${where} has check ${JSON.stringify(raw.check)} — must be one of ${Object.keys(CHECKS).join(", ")}`,
    );
  }
  const allowed = new Set(["check", ...spec.required, ...spec.optional]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new AutoVerifyShapeError(`${where} (${raw.check}) does not take "${key}"`);
  }
  for (const key of spec.required) {
    if (raw[key] == null) throw new AutoVerifyShapeError(`${where} (${raw.check}) needs "${key}"`);
  }
  const out = { check: raw.check };
  if (raw.tags != null) {
    if (!Array.isArray(raw.tags) || raw.tags.length === 0 || raw.tags.some((t) => typeof t !== "string" || !t)) {
      throw new AutoVerifyShapeError(`${where} "tags" must be a non-empty list of tag slugs`);
    }
    if (knownTagSlugs) {
      for (const t of raw.tags) {
        if (!knownTagSlugs.has(t)) {
          throw new AutoVerifyShapeError(`${where} references unknown tag "${t}" — run npm run db:sync-tags first`);
        }
      }
    }
    out.tags = [...raw.tags];
  }
  for (const key of ["minWin", "people", "quantity"]) {
    if (raw[key] == null) continue;
    if (!isPositiveInt(raw[key])) throw new AutoVerifyShapeError(`${where} "${key}" must be a positive whole number`);
    out[key] = raw[key];
  }
  if (raw.structure != null) {
    if (typeof raw.structure !== "string" || !raw.structure) {
      throw new AutoVerifyShapeError(`${where} "structure" must be a structure's tag slug`);
    }
    if (knownTagSlugs && !knownTagSlugs.has(raw.structure)) {
      throw new AutoVerifyShapeError(`${where} references unknown structure "${raw.structure}"`);
    }
    out.structure = raw.structure;
  }
  if (raw.action != null) {
    if (!Object.hasOwn(ACTS, raw.action)) {
      throw new AutoVerifyShapeError(
        `${where} has action ${JSON.stringify(raw.action)} — must be one of ${Object.keys(ACTS).join(", ")}`,
      );
    }
    out.action = raw.action;
  }
  return out;
}

// Every tag slug a rule names — the loader resolves these to ids in one query.
function ruleTagSlugs(rule) {
  return rule?.tags ?? [];
}

function timeOf(v) {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

// Is this row the claimant's own, on the side a check asked for, inside the
// window? Actor rows are bounded by the character's own creation too: an
// account outlives its characters, and a dead predecessor's act from earlier
// the same turn is not this character's (the same bound
// getCharacterAuditSliceImpl draws).
function onSide(row, side, ctx) {
  const at = timeOf(row.createdAt);
  if (!(at >= ctx.turnStartedAt)) return false;
  const mine = row.actorDiscordUserId === ctx.discordUserId && at >= ctx.characterCreatedAt;
  const aboutMe = row.targetCharacterId === ctx.characterId;
  if (side === "actor") return mine;
  if (side === "target") return aboutMe;
  return true;
}

// Newest first, and never a row another auto-confirmed claim already cited —
// one sip can't confirm two Desires; the second one waits for a GM.
function candidates(rows, types, side, ctx) {
  const typeSet = new Set(types);
  return rows
    .filter((r) => typeSet.has(r.actionType) && !ctx.usedAuditIds.has(r.id) && onSide(r, side, ctx))
    .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
}

function idsFor(slugs, ctx) {
  const ids = new Set();
  for (const s of slugs ?? []) {
    const id = ctx.tagIdsBySlug.get(s);
    if (id) ids.add(id);
  }
  return ids;
}

function nameList(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * Pure. Given a normalized rule and everything the loader fetched, return the
 * proof — `{ auditLogIds, note }` — or null. `note` is one GM-facing sentence.
 *
 * ctx: { characterId, characterName, discordUserId, turnStartedAt (ms), characterCreatedAt (ms),
 *        rows: AuditLog rows, heldTags: [{ tagId, quantity, name }],
 *        tagIdsBySlug: Map, usedAuditIds: Set }
 */
function matchAutoVerify(rule, ctx) {
  if (!rule?.check) return null;
  const rows = ctx.rows ?? [];
  const one = (row, note) => (row ? { auditLogIds: [row.id], note } : null);

  switch (rule.check) {
    case "consumed": {
      const ids = idsFor(rule.tags, ctx);
      const row = candidates(rows, ["request_consume_tag"], "target", ctx).find((r) => ids.has(r.details?.tagId));
      return one(row, row && `Consumed ${row.details?.tagName ?? "it"}`);
    }
    case "kissed": {
      const row = candidates(rows, ["kiss_accepted"], "actor", ctx)[0];
      if (!row) return null;
      const d = row.details ?? {};
      const other = d.initiator === ctx.characterName ? d.responder : d.initiator;
      return one(row, `Kissed ${other || "somebody"}`);
    }
    case "slots": {
      const min = rule.minWin ?? 0;
      const row = candidates(rows, ["slot_machine"], "target", ctx).find((r) => (r.details?.payout ?? 0) >= min);
      if (!row) return null;
      const payout = row.details?.payout ?? 0;
      return one(row, payout > 0 ? `Won ${payout} ¢ at the slots` : "Played the slots");
    }
    case "bought": {
      const ids = rule.tags ? idsFor(rule.tags, ctx) : null;
      const row = candidates(rows, ["vending_buy"], "target", ctx).find((r) => !ids || ids.has(r.details?.tagId));
      return one(row, row && `Bought ${row.details?.name ?? "something"} from the vending machine`);
    }
    case "crafted": {
      const ids = idsFor(rule.tags, ctx);
      for (const r of candidates(rows, ["request_craft_tag", "craft_yield_arrived"], "target", ctx)) {
        if (r.actionType === "request_craft_tag" && ids.has(r.details?.tagId)) {
          return one(r, `Made ${r.details?.tagName ?? "it"}`);
        }
        const landed = (r.details?.tags ?? []).find((t) => t?.op !== "remove" && ids.has(t?.tagId));
        if (r.actionType === "craft_yield_arrived" && landed) return one(r, `Made ${landed.tagName ?? "it"}`);
      }
      return null;
    }
    case "built": {
      const row = candidates(rows, ["build_completed"], "target", ctx).find(
        (r) => r.details?.typeSlug === rule.structure,
      );
      return one(row, row && `Finished building ${row.details?.typeName ?? "it"}`);
    }
    case "gave": {
      const ids = idsFor(rule.tags, ctx);
      const byRecipient = new Map();
      for (const r of candidates(rows, ["request_transfer_tag"], "actor", ctx)) {
        const d = r.details ?? {};
        // Their own goods, handed to another person. A pickpocket's leg of
        // the same actionType moves someone else's goods TO the thief.
        if (d.via === "pickpocket") continue;
        if (d.from?.kind !== "character" || d.from?.id !== ctx.characterId) continue;
        if (d.to?.kind !== "character" || !d.to?.id || d.to.id === ctx.characterId) continue;
        if (!ids.has(d.tagId)) continue;
        if (!byRecipient.has(d.to.id)) byRecipient.set(d.to.id, r);
      }
      if (byRecipient.size < rule.people) return null;
      const cited = [...byRecipient.values()];
      const people = byRecipient.size;
      const what = nameList(cited.map((r) => r.details?.tagName));
      return { auditLogIds: cited.map((r) => r.id), note: `Gave ${what} to ${people} people` };
    }
    case "holds": {
      const ids = idsFor(rule.tags, ctx);
      const need = rule.quantity ?? 1;
      const held = (ctx.heldTags ?? []).find((t) => ids.has(t.tagId) && (t.quantity ?? 1) >= need);
      if (!held) return null;
      const n = held.quantity ?? 1;
      return { auditLogIds: [], note: `Held ${n > 1 ? `${n} ` : ""}${held.name ?? "it"} when claiming` };
    }
    case "act": {
      const act = ACTS[rule.action];
      if (!act) return null;
      const row = candidates(rows, act.types, act.side, ctx).find((r) => !act.test || act.test(r, ctx));
      return one(row, row && act.note(row));
    }
    default:
      return null;
  }
}

/**
 * Loads what the matcher needs and runs it. Call it inside the claim's
 * transaction, under the Character row lock, so two claims landing together
 * can't both cite the same row. Returns null when there is no rule, no open
 * turn, or no proof.
 */
async function findAutoEvidence(tx, { rule, character, discordUserId, openTurn }) {
  if (!rule?.check || !openTurn?.startedAt) return null;
  const spec = CHECKS[rule.check];
  if (!spec) return null;

  const turnStartedAt = timeOf(openTurn.startedAt);
  let characterCreatedAt = character.createdAt ? timeOf(character.createdAt) : null;
  if (characterCreatedAt == null) {
    const row = await tx.character.findUnique({ where: { id: character.id }, select: { createdAt: true } });
    characterCreatedAt = row ? timeOf(row.createdAt) : turnStartedAt;
  }

  const slugs = [...ruleTagSlugs(rule)];
  const tagIdsBySlug = new Map(
    slugs.length
      ? (await tx.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })).map((t) => [
          t.slug,
          t.id,
        ])
      : [],
  );

  const types = spec.types(rule);
  let rows = [];
  if (types.length) {
    const since = new Date(turnStartedAt);
    rows = await tx.auditLog.findMany({
      where: {
        actionType: { in: types },
        createdAt: { gte: since },
        OR: [
          { targetCharacterId: character.id },
          ...(discordUserId ? [{ actorDiscordUserId: discordUserId }] : []),
          // `any`-sided acts name the claimant only inside details, so they
          // need every row of the type this turn; the matcher's test narrows.
          ...(rule.check === "act" && ACTS[rule.action]?.side === "any" ? [{}] : []),
        ],
      },
      select: { id: true, actionType: true, actorDiscordUserId: true, targetCharacterId: true, details: true, createdAt: true },
    });
  }

  // Read fresh, inside the caller's transaction: what they hold NOW, not what
  // the page loaded a minute ago.
  const heldTags =
    rule.check === "holds"
      ? (
          await tx.characterTag.findMany({
            where: { characterId: character.id, tagId: { in: [...tagIdsBySlug.values()] } },
            select: { tagId: true, quantity: true, tag: { select: { name: true } } },
          })
        ).map((ct) => ({ tagId: ct.tagId, quantity: ct.quantity, name: ct.tag.name }))
      : [];

  const used = rows.length
    ? await tx.desire.findMany({
        where: {
          characterId: character.id,
          status: "FULFILLED",
          autoVerifiedAuditIds: { hasSome: rows.map((r) => r.id) },
        },
        select: { autoVerifiedAuditIds: true },
      })
    : [];
  const usedAuditIds = new Set(used.flatMap((d) => d.autoVerifiedAuditIds));

  return matchAutoVerify(rule, {
    characterId: character.id,
    characterName: character.name,
    discordUserId,
    turnStartedAt,
    characterCreatedAt,
    rows,
    heldTags,
    tagIdsBySlug,
    usedAuditIds,
  });
}

module.exports = {
  ACTS,
  CHECKS,
  AutoVerifyShapeError,
  validateAutoVerify,
  matchAutoVerify,
  findAutoEvidence,
};
