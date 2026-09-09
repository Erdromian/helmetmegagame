import {
  consumableTags,
  destroyableTags,
  transferableTags,
} from "@/lib/tagRequests";

// THE THINGS DRAWER's rows, built once so the first paint (play/page.js) and
// the re-read after an action (./actions.js#myThings) can never disagree about
// what is in a pocket.
//
// The four verbs are the SHEET's own predicates — `equippable`, `consumable`,
// `tradeable`, `removable` off the catalog (docs/systemdocs/TAGS.md §5),
// through the same web/lib/tagRequests.js helpers RequestActionsProvider
// builds its pools from. No new rules live here: every one of the four
// re-checks itself server-side when it is pressed.
//
// Only Items and Assets. Health, Status, Skills and the rest are not things
// you carry — the status strip above draws the ones that matter.
const GROUPS = ["Items", "Assets"];

// The four verbs for every pocket at once: { tagId -> { consumable, tradeable,
// removable } }, so a page drawing many rows asks the predicates once rather
// than once per row. The sheet's tag rail (web/app/components/RowVerbs.js) and
// the drawer below both read this, which is what keeps them agreeing.
export function thingVerbSets(characterTags = []) {
  return {
    consumable: new Set(consumableTags(characterTags).map((t) => t.id)),
    tradeable: new Set(transferableTags(characterTags).map((t) => t.id)),
    removable: new Set(destroyableTags(characterTags).map((t) => t.id)),
  };
}

// One row's verbs off those sets.
export function thingVerbs(ct, sets) {
  return {
    equippable: Boolean(ct.tag?.equippable),
    consumable: sets.consumable.has(ct.tagId),
    tradeable: sets.tradeable.has(ct.tagId),
    removable: sets.removable.has(ct.tagId),
  };
}

export function thingGroups(characterTags = []) {
  const sets = thingVerbSets(characterTags);

  const rows = characterTags
    .filter((ct) => GROUPS.includes(ct.tag?.category))
    .map((ct) => ({
      // The CharacterTag row, which is what an equip toggle acts on; the
      // catalog Tag id is what every dialog preselects with.
      characterTagId: ct.id ?? null,
      tagId: ct.tagId,
      name: ct.tag.name,
      category: ct.tag.category,
      quantity: ct.quantity ?? 1,
      equipped: Boolean(ct.equipped),
      // How many units are still free to equip — a slot holds one physical
      // item, so a partly-equipped stack can offer BOTH "Equip" (there's
      // more in reserve) and "Unequip" (some is already out) at once.
      equippableRemaining: (ct.quantity ?? 1) - (ct.equippedQuantity ?? 0),
      equippedQuantity: ct.equippedQuantity ?? 0,
      ...thingVerbs(ct, sets),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return GROUPS.map((category) => ({
    category,
    rows: rows.filter((row) => row.category === category),
  })).filter((group) => group.rows.length > 0);
}
