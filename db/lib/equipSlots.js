// Which equipped things cannot be worn together, and how many hands there are.
//
// Every equippable tag names a Tag.equipSlot (db/lib/syncTags.js throws on one
// that doesn't), and the slot is the whole limit. GameConfig.equipSlots, the
// old flat count, is retired: it let a character ready eight swords and said
// nothing about two helmets, and the two rules disagreed about why an equip
// was refused.
//
//   HEAD, BODY          layered 1-3, MOUNT 1-2. Two equipped tags may not share
//                      a layer, so a coif (1) goes under a helm (2) and a cart
//                      (2) is towed behind a horse (1), but two helms do not go
//                      together.
//   SHIELD             exactly one.
//   WEAPON             three hands. A tag with Tag.twoHanded takes two.
//   ACCESSORY          four. A badge, spectacles, a fishing rod. Uncapped at
//                      first, which turned it into the pocket everything that
//                      fitted nowhere else went into.
//
// Two independent code paths flip CharacterTag.equipped — the player's own
// toggle (web/app/(app)/character/equipActions.js) and the GM/staged batch
// (db/lib/tagOps.js) — so the rule lives here rather than in either of them. It
// is written as "look at the whole equipped set and find a problem" rather than
// "may I add this one?", because the batch path applies its writes first and
// then checks, and a two-argument form could not express "unequip A, equip B"
// without rejecting B for a conflict with an A that is already gone.
//
// See docs/systemdocs/TAGS.md.

const WEAPON_HANDS = 3;
// A hard cap, not a GameConfig knob like the retired flat count: the number
// is a rule about what a person can have about them, and the last thing this
// file needs is a second limit a GM can set to disagree with the slots.
const MAX_ACCESSORIES = 4;
const MAX_EQUIP_LAYER = 3;
const LAYERED_SLOTS = new Set(["HEAD", "BODY", "MOUNT"]);
const EQUIP_SLOTS = ["HEAD", "BODY", "SHIELD", "WEAPON", "ACCESSORY", "MOUNT"];

// The words the sheet and the refusals use for each slot. Player-facing copy,
// so every phrase of five words or more carries its ‡.
const SLOT_LABELS = {
  HEAD: "on your head",
  BODY: "on your body",
  SHIELD: "in your off hand",
  WEAPON: "in your hands",
  ACCESSORY: "about your person",
  MOUNT: "under you",
};

// The rig's row titles and the name of each layer cell, outermost last.
const SLOT_TITLES = {
  HEAD: "Head",
  BODY: "Body",
  SHIELD: "Off hand",
  WEAPON: "Hands",
  ACCESSORY: "Accessories",
  MOUNT: "Ride",
};
const LAYER_NAMES = {
  HEAD: ["Liner", "Helm", "Outer"],
  BODY: ["Clothes", "Mail", "Outer"],
  MOUNT: ["Ridden", "Towed"],
};

// Accepts CharacterTag[] (with .tag) or bare Tag[], like forcedNameFrom.
function tagOf(entry) {
  return entry?.tag ?? entry;
}

// "A, B and C".
function listWords(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function handsOf(tag) {
  return tag?.equipSlot === "WEAPON" ? (tag.twoHanded ? 2 : 1) : 0;
}

/**
 * Hands in use across a set of equipped rows.
 * @param {Array} tags equipped rows — CharacterTag[] (with .tag) or Tag[]
 */
function handsUsed(tags) {
  if (!Array.isArray(tags)) return 0;
  return tags.reduce((n, entry) => n + handsOf(tagOf(entry)), 0);
}

/**
 * The first pair of equipped tags that cannot be worn together.
 * @param {Array} tags equipped rows — CharacterTag[] (with .tag) or Tag[]
 * @returns {{a: object, b: object}|null} the clashing pair, outermost first
 */
function findSlotClash(tags) {
  if (!Array.isArray(tags)) return null;
  const seen = new Map();
  for (const entry of tags) {
    const tag = tagOf(entry);
    if (!tag?.equipSlot) continue;
    // WEAPON is counted in hands and ACCESSORY is never counted at all.
    if (tag.equipSlot === "WEAPON" || tag.equipSlot === "ACCESSORY") continue;
    // A layered slot keys on slot+layer; SHIELD keys on the slot alone, which
    // is what makes it hold exactly one.
    const key = tag.equipLayer == null ? tag.equipSlot : `${tag.equipSlot}:${tag.equipLayer}`;
    const other = seen.get(key);
    if (other) return { a: tag, b: other };
    seen.set(key, tag);
  }
  return null;
}

/**
 * Why that pair cannot be worn together, as a sentence for a player.
 * Ends in ‡ — it is drafted copy like everything else here.
 */
function describeSlotClash({ a, b }) {
  const where = SLOT_LABELS[a.equipSlot] ?? "there";
  return `${a.name} and ${b.name} can't both go ${where}. ‡`;
}

/**
 * Why the readied weapons do not fit in the hands, or null when they do.
 *
 * Names only the EXCESS. A character carrying five weapons from before the
 * rule needs to know which ones to put down, and a refusal that listed the
 * whole armful — the ones already fitting included — told them nothing they
 * could act on. Hands are filled in the order the rows came, and anything
 * that will not go in is what has to go.
 */
function describeHandsOverflow(tags) {
  if (handsUsed(tags) <= WEAPON_HANDS) return null;
  const excess = [];
  let held = 0;
  for (const entry of tags ?? []) {
    const tag = tagOf(entry);
    if (tag?.equipSlot !== "WEAPON") continue;
    const hands = handsOf(tag);
    if (held + hands <= WEAPON_HANDS) {
      held += hands;
      continue;
    }
    excess.push(tag);
  }
  // A two-hander says so inline, so the sentence stays one sentence and the
  // player can still see why three things filled three hands.
  const named = listWords(excess.map((t) => (t.twoHanded ? `${t.name} (two hands)` : t.name)));
  return `Your hands are full: put away ${named} before you take up anything else. ‡`;
}

/**
 * Where a tag goes and what it costs to put there, as a short label for a
 * buying menu or a chip. Null for anything that isn't equippable.
 *
 * Terse on purpose — it sits in a `<dl>` of one-line answers beside Weight and
 * Armour, and the sentence a refusal needs is describeSlotClash's job. What it
 * exists to say is the thing a shopper cannot otherwise work out: that a coif
 * and a helm stack because they sit at different layers, that a poleaxe eats
 * two of three hands, and that trinkets run out at four.
 */
function describeEquipFit(tag) {
  const slot = tag?.equipSlot;
  if (!slot) return null;
  if (slot === "WEAPON") return `Hands · takes ${tag.twoHanded ? "two" : "one"}`;
  if (slot === "ACCESSORY") return `${SLOT_TITLES.ACCESSORY} · ${MAX_ACCESSORIES} at once`;
  const layer = LAYER_NAMES[slot]?.[(tag.equipLayer ?? 0) - 1];
  return layer ? `${SLOT_TITLES[slot]} · ${layer}` : SLOT_TITLES[slot] ?? null;
}

/**
 * Why the accessories do not all fit, or null when they do.
 *
 * Names only the EXCESS, the same way describeHandsOverflow does and for the
 * same reason — a character wearing six trinkets from before the cap needs to
 * know which two to take off, not to be read their own inventory back.
 */
function describeAccessoryOverflow(tags) {
  const worn = (tags ?? []).map(tagOf).filter((t) => t?.equipSlot === "ACCESSORY");
  if (worn.length <= MAX_ACCESSORIES) return null;
  const named = listWords(worn.slice(MAX_ACCESSORIES).map((t) => t.name));
  return `You can keep ${MAX_ACCESSORIES} things about you: put away ${named}. ‡`;
}

/**
 * The one question both write paths ask after writing: is this set wearable?
 * @returns {string|null} a player-facing refusal, or null when the set is fine
 */
function findEquipProblem(tags) {
  const clash = findSlotClash(tags);
  if (clash) return describeSlotClash(clash);
  return describeHandsOverflow(tags) ?? describeAccessoryOverflow(tags);
}

module.exports = {
  WEAPON_HANDS,
  MAX_ACCESSORIES,
  MAX_EQUIP_LAYER,
  LAYERED_SLOTS,
  EQUIP_SLOTS,
  SLOT_TITLES,
  LAYER_NAMES,
  handsOf,
  handsUsed,
  describeEquipFit,
  findEquipProblem,
};
