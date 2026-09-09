// The sheet's tag rail, bucketed: which card a held tag goes in, how the rows
// inside it are ordered and sub-grouped, and the one value each row shows on
// its right. Pure functions over CharacterTag[] (with .tag and the group
// joined), so the rail component only draws.
//
// The category is docs/tags.yaml's own; the sub-groups are TagGroup names,
// which already carry the colour the chip's left rule wears (taggroups.yaml).
// Status is deliberately absent: the band's StatusStrip carries those chips,
// the same way the Chat's YOU column does (SHEET.md).

import { turnsLeft, tagDuration } from "@lifeweb/db/lib/turnFormat";
import { armorWord } from "@lifeweb/db/lib/armorValue";
import { tagWeightLbs } from "./formatTagWeight";

// Fixed display order rather than alphabetical or catalog order — Health
// (whatever is currently wrong with you) first, then what you know, what
// you carry, what stands, who you are.
const CARD_ORDER = ["Health", "Skills", "Items", "Assets", "General", "Meta", "Demoness"];

// Case-folded: the catalog has held both "Items" and "items", and two cards
// headed the same word is a bug on sight.
function canonicalCategory(raw) {
  const trimmed = raw?.trim() || "Other";
  return CARD_ORDER.find((c) => c.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

function rank(category) {
  const i = CARD_ORDER.indexOf(category);
  return i === -1 ? CARD_ORDER.length : i;
}

// What a row weighs, stack included — the number the Items card sorts and
// totals on, from the same rule the string is built out of.
function rowWeight(ct) {
  return tagWeightLbs(ct.tag, ct.quantity ?? 1);
}

// Signed percent for a carry bonus: Cart +4 reads "+400%", Frail −0.1 "−10%".
export function carryBonusLabel(bonus) {
  if (bonus == null || bonus === 0) return null;
  const pct = Math.round(bonus * 100);
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% carry`;
}

// What a Laboring tool adds, in the kind's own word (LABORING.md §5).
function laborBonusLabel(laborBonus) {
  if (!laborBonus?.kind || !laborBonus?.amount) return null;
  return `+${laborBonus.amount} ${laborBonus.kind}`;
}

// The one thing worth reading at a glance for a row. Picked in the order a
// player cares: a clock beats a weight beats a stack count.
//   { text, tone } — tone "danger" for a tag on its last turn.
export function rowValue(ct, currentTurn = null) {
  const tag = ct.tag;
  const left = turnsLeft(ct.expiresTurn, currentTurn);
  const duration = tagDuration(left, null);
  if (duration) return { text: duration.badge, tone: left === 1 ? "danger" : null };
  // "1 lb each · 3 lb" is the tooltip's wording; the row wants the total.
  const weight = tagWeightLbs(tag, ct.quantity ?? 1);
  if (weight > 0) return { text: `${weight} lb`, tone: null };
  const armor = tag.ballisticArmor ?? tag.meleeArmor;
  if (armor) return { text: armorWord(Math.max(tag.meleeArmor ?? 0, tag.ballisticArmor ?? 0)), tone: null };
  const carry = carryBonusLabel(tag.carryBonus);
  if (carry) return { text: carry, tone: null };
  const labor = laborBonusLabel(tag.laborBonus);
  if (labor) return { text: labor, tone: null };
  if ((ct.quantity ?? 1) > 1) return { text: `×${ct.quantity}`, tone: null };
  return null;
}

// Health: soonest to run out first, the untimed ones after, alphabetical
// within a tie.
function healthOrder(a, b, currentTurn) {
  const la = turnsLeft(a.expiresTurn, currentTurn) ?? Infinity;
  const lb = turnsLeft(b.expiresTurn, currentTurn) ?? Infinity;
  return la - lb || a.tag.name.localeCompare(b.tag.name);
}

// Sub-groups by TagGroup, in catalog order of first appearance, groupless
// last. Each { key, name, color, rows }.
function byGroup(rows) {
  const groups = new Map();
  for (const ct of rows) {
    const key = ct.tag.group?.slug ?? "__other";
    if (!groups.has(key)) groups.set(key, { key, name: ct.tag.group?.name ?? null, color: ct.tag.group?.color ?? null, rows: [] });
    groups.get(key).rows.push(ct);
  }
  const list = [...groups.values()];
  list.sort((a, b) => (a.key === "__other") - (b.key === "__other") || (a.name ?? "").localeCompare(b.name ?? ""));
  return list;
}

/**
 * Every card the rail draws, in order.
 * @returns {Array<{ key, title, count, groups: Array<{key,name,color,rows}>, weight? }>}
 */
export function buildCards(characterTags = [], { currentTurn = null } = {}) {
  const buckets = new Map();
  for (const ct of characterTags) {
    const category = canonicalCategory(ct.tag?.category);
    // The band's strip carries these; a second copy in the rail was a scroll
    // stop for no new information.
    if (category === "Status") continue;
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(ct);
  }

  const cards = [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, rows]) => {
      if (category === "Health") {
        const sorted = [...rows].sort((a, b) => healthOrder(a, b, currentTurn));
        return { key: category, title: category, count: rows.length, groups: [{ key: "all", name: null, color: null, rows: sorted }] };
      }
      if (category === "Items") {
        const groups = byGroup(rows).map((g) => ({
          ...g,
          rows: [...g.rows].sort((a, b) => rowWeight(b) - rowWeight(a) || a.tag.name.localeCompare(b.tag.name)),
        }));
        const weight = Math.round(rows.reduce((n, ct) => n + rowWeight(ct), 0) * 100) / 100;
        return { key: category, title: category, count: rows.length, groups, weight };
      }
      if (category === "Skills") {
        const groups = byGroup(rows).map((g) => ({
          ...g,
          rows: [...g.rows].sort((a, b) => a.tag.name.localeCompare(b.tag.name)),
        }));
        return { key: category, title: category, count: rows.length, groups };
      }
      const sorted = [...rows].sort((a, b) => a.tag.name.localeCompare(b.tag.name));
      return { key: category, title: category, count: rows.length, groups: [{ key: "all", name: null, color: null, rows: sorted }] };
    });
  return cards;
}

// The next rung above a held skill: the catalog tag whose parentTagId is this
// one, and that the character does not already hold. Null when the ladder
// ends here.
export function nextRung(ct, catalog = [], heldTagIds = new Set()) {
  return catalog.find((t) => t.parentTagId === ct.tag.id && !heldTagIds.has(t.id)) ?? null;
}

// The filter box's test: name or description, case-folded.
export function matchesQuery(ct, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ct.tag.name.toLowerCase().includes(q) ||
    (ct.tag.description ?? "").toLowerCase().includes(q) ||
    (ct.tag.group?.name ?? "").toLowerCase().includes(q)
  );
}
