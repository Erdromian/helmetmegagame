// The descriptors a character is told about themselves, as words (the Soilery
// Rework doc). Hunger is the only one so far: Full, Hungry or Starving, from
// the descriptor tag they hold (db/lib/hunger.js#hungerDescriptorFor). Worked
// out on the server so the meter's number never reaches a browser. The /chat
// You plate draws every row this returns; the sheet draws the hunger one as
// its Hunger tile.
import { hungerDescriptorFor } from "@lifeweb/db/lib/hunger";

export function hungerOf({ tags, hungerValue }) {
  const heldSlugs = (tags ?? []).map((ct) => ct.tag?.slug ?? ct.slug).filter(Boolean);
  const d = hungerDescriptorFor({ heldSlugs, hungerValue });
  return d ? { word: d.word, line: d.line, tone: d.tone } : null;
}

export function descriptorsFor(character) {
  const hunger = hungerOf(character);
  return hunger ? [{ key: "hunger", label: "Hunger", ...hunger }] : [];
}
