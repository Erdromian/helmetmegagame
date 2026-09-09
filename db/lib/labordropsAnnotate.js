// Rewrites docs/labordrops.yaml's own comments in place: per-entry value (an
// author-written "why" blurb is preserved across refreshes — see the
// `— ` split below), per-roll EV/hit-rate (this bucket alone, AND what
// actually pools with it — global, place, and any requiresTag ancestor), and
// a per-category rollup across every roll that scope answers to. See
// docs/systemdocs/LABORDROPS.md §6a-§6b.
//
// Pure text surgery over an indentation stack, not a YAML round-trip: this
// file's shape is fully hand-authored and disciplined (2-space indents,
// `key:` lines, numeric roll keys, `- entry` list lines), so a bespoke
// walker that touches only comment text is simpler and safer than pulling in
// a comment-preserving YAML library for one script — nothing here can
// reorder a key, reformat a list, or drop a blank line, because it never
// re-serializes anything but the trailing `# ...` on lines it recognizes.
const { scopeFilters, passesRequiredTag, TIER_TO_LABOR_DROP_TYPE } = require("./laborDrops");

// One "slot" per nesting step before a bucket reaches roll-keyed leaves.
// laborTypeZone/laborTypeLocation consume two slots (type, then place)
// before rolls start; global consumes none.
const BRANCH_PLANS = {
  global: [],
  laborType: ["laborTypeSlug"],
  zone: ["zoneSlug"],
  location: ["locationSlug"],
  laborTypeZone: ["laborTypeSlug", "zoneSlug"],
  laborTypeLocation: ["laborTypeSlug", "locationSlug"],
};

const LABOR_TYPE_BY_KEY = TIER_TO_LABOR_DROP_TYPE;

function indentOf(line) {
  const m = /^( *)/.exec(line);
  return m[1].length;
}

// Splits "  code  # comment" into { code, comment } (comment includes the
// leading "#", or null if there is none). Nothing in this file's keys or
// short scalars ever contains a literal "#", so a first-match split is safe.
function splitComment(line) {
  const idx = line.indexOf("#");
  if (idx === -1) return { code: line.replace(/\s+$/, ""), comment: null };
  return { code: line.slice(0, idx).replace(/\s+$/, ""), comment: line.slice(idx).trimEnd() };
}

function withComment(code, comment) {
  return comment ? `${code}  ${comment}` : code;
}

// The one pool entry -> mechanical value fragment (no item name — the slug
// is already the line's own value). Mirrors audit-labor-drops.js#priceEntry
// but returns just the fragment, since the entry line doesn't need the name
// repeated.
const OBOL_SLUG = "obol";
function mechanicalValue(rawValue, tagsById) {
  const value = String(rawValue).trim();
  if (/^nothing$/i.test(value)) return null; // no comment needed
  if (/^[+-]\d+$/.test(value)) return null; // the number already says it all
  const tag = [...tagsById.values()].find((t) => t.slug === value);
  if (!tag) return null; // unknown to the catalog — sync will throw on this, not our job to comment
  if (tag.slug === OBOL_SLUG) return "the coin itself, worth 1 ⬢";
  if (tag.sellable && tag.sellablePrice) return `sells ${tag.sellablePrice} ⬢`;
  return "not sellable";
}

// Combined pool EV/hit-rate for one roll at one resolved scope, exactly the
// runtime rule (scopeFilters + passesRequiredTag) — this IS what a payout in
// that scope actually draws from.
function combinedStats(rows, roll, { laborType, zoneId, locationId, heldTagIds }) {
  const scopes = scopeFilters(laborType ?? null, zoneId ?? null, locationId ?? null);
  const matched = rows.filter(
    (r) =>
      r.roll === roll &&
      scopes.some((s) => s.laborType === r.laborType && s.zoneId === r.zoneId && s.locationId === r.locationId) &&
      passesRequiredTag(r, heldTagIds),
  );
  return summarize(matched);
}

// Own-bucket EV/hit-rate: the exact scope tuple this node was authored at,
// no OR-expansion.
function ownStats(rows, roll, { laborType, zoneId, locationId, requiredTagId }) {
  const matched = rows.filter(
    (r) =>
      r.roll === roll &&
      r.laborType === (laborType ?? null) &&
      r.zoneId === (zoneId ?? null) &&
      r.locationId === (locationId ?? null) &&
      r.requiredTagId === (requiredTagId ?? null),
  );
  return summarize(matched);
}

function summarize(rows) {
  if (rows.length === 0) return null;
  let hits = 0;
  let sum = 0;
  for (const r of rows) {
    if (r.kind === "NOTHING") continue;
    hits += 1;
    if (r.kind === "RESOURCES") sum += r.resourceAmount ?? 0;
    // TAG value folded in by the caller via tagValue(r) — kept out of this
    // pure summarizer so it stays independent of the tag catalog.
  }
  return { count: rows.length, hits, sum };
}

// summarize() above can't price a TAG row without the catalog, so pricing is
// done up front: every row gets a `.evValue` (⬢, 0 for an unpriced tag or a
// NOTHING) before combinedStats/ownStats ever run, matching
// audit-labor-drops.js's own EV rule exactly. Also normalizes requiredTagId
// to explicit `null` — parseDoc's in-memory rows simply OMIT the key when
// there's no requiresTag ancestor, unlike a live Prisma row (which always
// reads back `null` for an unset nullable column), and an `undefined` here
// would silently fail every own-scope equality check below.
function priceRows(rows, tagsById) {
  return rows.map((r) => {
    const withTagId = { ...r, requiredTagId: r.requiredTagId ?? null };
    if (r.kind === "RESOURCES") return { ...withTagId, evValue: r.resourceAmount ?? 0 };
    if (r.kind === "TAG") {
      const tag = tagsById.get(r.tagId);
      if (tag?.slug === OBOL_SLUG) return { ...withTagId, evValue: 1 };
      if (tag?.sellable && tag.sellablePrice) return { ...withTagId, evValue: tag.sellablePrice };
      return { ...withTagId, evValue: 0 };
    }
    return { ...withTagId, evValue: 0 };
  });
}

function statLine(stats) {
  if (!stats) return null;
  const ev = stats.count ? (stats.evSum / stats.count).toFixed(2) : "0.00";
  const hitPct = stats.count ? Math.round((stats.hits / stats.count) * 100) : 0;
  return `EV ${ev} ⬢ · hit ${hitPct}%`;
}

function computeStats(rows, roll, scope) {
  const matched = rows.filter((predicateFor(roll, scope)));
  if (matched.length === 0) return null;
  const hits = matched.filter((r) => r.kind !== "NOTHING").length;
  const evSum = matched.reduce((s, r) => s + (r.evValue ?? 0), 0);
  return { count: matched.length, hits, evSum };
}

function predicateFor(roll, { mode, laborType, zoneId, locationId, requiredTagId, heldTagIds }) {
  if (mode === "own") {
    return (r) =>
      r.roll === roll &&
      r.laborType === (laborType ?? null) &&
      r.zoneId === (zoneId ?? null) &&
      r.locationId === (locationId ?? null) &&
      r.requiredTagId === (requiredTagId ?? null);
  }
  const scopes = scopeFilters(laborType ?? null, zoneId ?? null, locationId ?? null);
  return (r) =>
    r.roll === roll &&
    scopes.some((s) => s.laborType === r.laborType && s.zoneId === r.zoneId && s.locationId === r.locationId) &&
    passesRequiredTag(r, heldTagIds ?? new Set());
}

// Comment for a roll-leaf line ("6:") — its own bucket's numbers, plus the
// combined numbers if they differ from "own alone" (they always do unless
// this bucket has no ancestry to pool with at all).
function buildRollComment(rows, roll, frame) {
  const own = computeStats(rows, roll, { mode: "own", ...frame });
  const combined = computeStats(rows, roll, { mode: "combined", ...frame });
  if (!own && !combined) return null;
  const ownLine = own ? statLine(own) : "no entries here";
  const combinedLine = combined ? statLine(combined) : null;
  const isTrivial = combined && own && own.count === combined.count && own.evSum === combined.evSum;
  return isTrivial || !combinedLine
    ? `# ${ownLine}`
    : `# own ${ownLine} · combined ${combinedLine}`;
}

// Comment for a category header (a labor type, a zone/location slug, or a
// skill under requiresTag) — the COMBINED number for every roll 1-6 that has
// anything in it at this scope, rolled up onto one line.
// The ACTUAL expected value of taking one Labor here — not a list of
// per-face numbers side by side. The die is 1d6, uniform, so this is
// (1/6) * sum over every face's combined EV, and a face nobody configured
// (almost always 2-5) contributes a real, counted zero — it isn't a face to
// skip, it's a 1-in-6 chance of nothing happening. Listing "1: EV 0.00 · 6:
// EV 3.88" side by side (the earlier shape) reads as if those numbers add
// up on their own; they don't without dividing by 6 first, and the four
// unlisted faces have to be in the denominator too. Same weighting for hit
// rate: the share of ALL SIX faces that produce something, not the share of
// the configured ones.
function buildRollupComment(rows, frame) {
  let totalEv = 0;
  let totalHitFraction = 0;
  let anyConfigured = false;
  for (let roll = 1; roll <= 6; roll++) {
    const combined = computeStats(rows, roll, { mode: "combined", ...frame });
    if (!combined) continue; // this face's own 0 is added by the /6 below either way
    anyConfigured = true;
    totalEv += combined.evSum / combined.count;
    totalHitFraction += combined.hits / combined.count;
  }
  if (!anyConfigured) return null;
  const ev = (totalEv / 6).toFixed(2);
  const hitPct = Math.round((totalHitFraction / 6) * 100);
  return `# ⬢ EV/labor ${ev} · hit ${hitPct}%`;
}

// Splits an existing entry comment into { blurb }. Convention: the author's
// "why" comes first, then " — ", then the mechanical fragment this tool
// owns. Three cases:
//  - has " — "          -> everything before it is the blurb.
//  - no " — ", and the
//    whole comment IS
//    today's mech value  -> a bare mechanical comment (this tool's own
//                           prior write, or a legacy line from before the
//                           blurb convention existed) — no blurb, and
//                           critically NOT re-wrapped as one, or every
//                           refresh would duplicate it
//                           ("sells 4 ⬢ — sells 4 ⬢").
//  - no " — ", anything
//    else                 -> the FIRST time this entry got a comment at
//                           all: the whole text is a hand-written blurb
//                           with no mechanical suffix yet.
// `mech` is the freshly computed mechanical value for THIS line right now
// (null if the entry has none, e.g. a RESOURCES delta) — pass it so case 2
// can be told apart from case 3.
function splitBlurb(comment, mech = null) {
  if (!comment) return { blurb: null };
  const text = comment.replace(/^#\s*/, "").trim();
  const idx = text.indexOf(" — ");
  if (idx !== -1) return { blurb: text.slice(0, idx).trim() };
  if (mech !== null && text === mech) return { blurb: null };
  return { blurb: text || null };
}

function resolveLaborTypeKey(key) {
  return LABOR_TYPE_BY_KEY[key] ?? null;
}

// The main pass. `lines` is the raw file split on "\n"; `ctx` carries the
// resolved catalogs (see db/scripts/ops/audit-labor-drops.js for how these
// are built) plus `rows`, the parsed+priced LaborDropOption-shaped rows
// (db/lib/syncLaborDrops.js#parseDoc, then priceRows()).
function annotateLines(lines, ctx) {
  const rows = ctx.rows;
  const out = [...lines];
  const stack = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;

    const indent = indentOf(raw);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1] ?? null;

    const { code, comment } = splitComment(raw);
    const keyMatch = /^(\s*)([A-Za-z0-9_.-]+):\s*(\{\})?\s*$/.exec(code);
    const listMatch = /^(\s*)-\s+(.+)$/.exec(code);

    if (keyMatch) {
      const key = keyMatch[2];
      const isEmptyDict = Boolean(keyMatch[3]);

      if (!parent) {
        // `global`'s plan is empty from the start — its children are
        // straight roll keys (or requiresTag), so it has to be pushed as
        // already-at-rollLevel, not "top" (which expects a slug step next
        // and would otherwise `continue` past global's roll keys entirely).
        const plan = [...(BRANCH_PLANS[key] ?? [])];
        stack.push({
          indent,
          kind: plan.length ? "top" : "rollLevel",
          scope: {},
          heldTagIds: new Set(),
          plan,
        });
        continue;
      }

      if (parent.kind === "top" || parent.kind === "slugStep") {
        const [stepKind, ...restPlan] = parent.plan;
        if (!stepKind) continue; // malformed nesting — leave untouched
        const scope = { ...parent.scope };
        if (stepKind === "laborTypeSlug") scope.laborType = resolveLaborTypeKey(key);
        else if (stepKind === "zoneSlug") scope.zoneId = ctx.zoneIdBySlug.get(key) ?? null;
        else if (stepKind === "locationSlug") scope.locationId = ctx.locationIdBySlug.get(key) ?? null;
        const frame = {
          indent,
          kind: restPlan.length ? "slugStep" : "rollLevel",
          scope,
          heldTagIds: parent.heldTagIds,
          plan: restPlan,
        };
        stack.push(frame);
        if (!isEmptyDict && !restPlan.length) {
          const rollup = buildRollupComment(rows, { ...frame.scope, heldTagIds: frame.heldTagIds });
          if (rollup) out[i] = withComment(code, rollup);
        }
        continue;
      }

      if (parent.kind === "rollLevel" || parent.kind === "skillLevel") {
        if (key === "requiresTag") {
          stack.push({ indent, kind: "requiresTagMarker", scope: parent.scope, heldTagIds: parent.heldTagIds });
          continue;
        }
        if (/^\d+$/.test(key)) {
          const roll = Number(key);
          const requiredTagId = parent.requiredTagId ?? null;
          const frame = {
            indent,
            kind: "rollLeaf",
            scope: parent.scope,
            requiredTagId,
            heldTagIds: parent.heldTagIds,
            roll,
          };
          stack.push(frame);
          const rollComment = buildRollComment(rows, roll, {
            ...frame.scope,
            requiredTagId,
            heldTagIds: frame.heldTagIds,
          });
          if (rollComment) out[i] = withComment(code, rollComment);
          continue;
        }
        // Unrecognized key at this depth — skip, don't guess.
        stack.push({ indent, kind: "unknown", scope: parent.scope, heldTagIds: parent.heldTagIds, plan: [] });
        continue;
      }

      if (parent.kind === "requiresTagMarker") {
        const requiredTagId = ctx.tagIdBySlug.get(key) ?? null;
        const heldTagIds = new Set(parent.heldTagIds);
        if (requiredTagId) heldTagIds.add(requiredTagId);
        const frame = {
          indent,
          kind: "skillLevel",
          scope: parent.scope,
          requiredTagId,
          heldTagIds,
          plan: [],
        };
        stack.push(frame);
        if (!isEmptyDict) {
          const rollup = buildRollupComment(rows, { ...frame.scope, heldTagIds: frame.heldTagIds });
          if (rollup) out[i] = withComment(code, rollup);
        }
        continue;
      }

      stack.push({ indent, kind: "unknown", scope: parent?.scope ?? {}, heldTagIds: parent?.heldTagIds ?? new Set(), plan: [] });
      continue;
    }

    if (listMatch && parent && parent.kind === "rollLeaf") {
      const rawValue = listMatch[2].trim().replace(/^["']|["']$/g, "");
      const mech = mechanicalValue(rawValue, ctx.tagsById);
      const { blurb } = splitBlurb(comment, mech);
      const newComment = mech ? `# ${blurb ? `${blurb} — ` : ""}${mech}` : blurb ? `# ${blurb}` : null;
      out[i] = withComment(code, newComment);
      continue;
    }
  }

  return out;
}

module.exports = { annotateLines, priceRows, mechanicalValue, splitBlurb };
