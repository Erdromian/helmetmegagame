// The descriptors a character is told about themselves, as words (the Soilery
// Rework doc). Hunger is the only one so far: Full, Hungry or Starving, from
// the descriptor tag they hold (db/lib/hunger.js#hungerDescriptorFor). A
// vampire never hungers (they hold `hungerless`), so their Blood stands in its
// place: Flush down to Bloodcrazed (db/lib/vampire.js#bloodDescriptorFor).
// Worked out on the server so neither meter's number reaches a browser. The
// /chat You plate draws every row this returns; the sheet draws the first one
// as its Hunger (or Blood) tile.
import { hungerDescriptorFor } from "@lifeweb/db/lib/hunger";
import { bloodDescriptorFor } from "@lifeweb/db/lib/vampire";

function heldSlugsOf(tags) {
  return (tags ?? []).map((ct) => ct.tag?.slug ?? ct.slug).filter(Boolean);
}

export function hungerOf({ tags, hungerValue }) {
  const d = hungerDescriptorFor({ heldSlugs: heldSlugsOf(tags), hungerValue });
  return d ? { word: d.word, line: d.line, tone: d.tone } : null;
}

// Null for anybody who is not a vampire.
export function bloodOf({ tags, vampireBloodLevel }) {
  const d = bloodDescriptorFor({ heldSlugs: heldSlugsOf(tags), bloodLevel: vampireBloodLevel });
  return d ? { word: d.word, line: d.line, tone: d.tone } : null;
}

// The one appetite a character is told about: Blood for a vampire, Hunger for
// everybody else, null for the Hungerless.
export function appetiteOf(character) {
  const blood = bloodOf(character);
  if (blood) return { key: "blood", label: "Blood", ...blood };
  const hunger = hungerOf(character);
  return hunger ? { key: "hunger", label: "Hunger", ...hunger } : null;
}

export function descriptorsFor(character) {
  const appetite = appetiteOf(character);
  return appetite ? [appetite] : [];
}
