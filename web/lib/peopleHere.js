// The ONE roster behind every people-picker on /character and /chat, in two
// halves: the people whose faces you can see, and the people in masks. A hood
// hides WHO somebody is, never THAT they are standing there, so both halves feed
// every picker that acts on a body (PROXYING.md §5).
//
// ONE PREDICATE DECIDES THE SPLIT, and it is not this file's. `presentRows` in
// db/lib/whosHere.js is where "is this person hidden from this viewer" is
// answered, and `resolveHoodToken` reads the same answer — so a row offered
// under a token always resolves back to somebody.
//
// It used to split with hereWhere()'s SQL on one side and presentRows on the
// other, and those two disagree in both directions. The damage was not
// theoretical:
//
//   * A masked CORPSE. hereWhere's dead arm is `{ status: DEAD, buriedAt: null }`
//     and knows nothing about Character.deathMaskTagId, so a body that died in a
//     helmet came back in the NAMED half under its real name and real id — and
//     in the hooded half under its alias, the same inventory listed twice in one
//     Loot dropdown. /api/avatar/<id> is ungated, so that id is the face.
//   * Speak hooded, then `/conceal off`. The columns say unconcealed; your
//     viewer's SIGHTING still says hooded (db/lib/sightings.js — a sighting is
//     frozen at the last line you heard). You landed in both halves at once,
//     alias beside real name.
//   * The mirror: spoke bare-faced, then put on a forcing helm. hereWhere drops
//     you for the helm, the sighting drops you from the hooded half, and you
//     fell out of every picker on the page.
//
// So both halves are now taken from the same `whosHere` answer, and this file's
// only remaining job is shaping the rows.
import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";
import { rosterHere as rosterHereWith, pickerName, pickerKey } from "@lifeweb/db/lib/peopleHere";

export { hereWhere, isHere, HERE_FIELDS, notHereMessage } from "@lifeweb/db/lib/presence";

// The rows themselves are db/lib/peopleHere.js's: the Discord bot's pickers
// read the same roster, so the split and the shaping live there once. These
// wrappers only supply the web's own Prisma client.
export { pickerName, pickerKey };

export async function rosterHere(character, options = {}) {
  return rosterHereWith(prisma, character, options);
}

// The named half alone, for the two callers that look somebody up by real id.
export async function peopleHere(character, { includeDead = false, select } = {}) {
  return (await rosterHere(character, { includeDead, select })).named;
}
