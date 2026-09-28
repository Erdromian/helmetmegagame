// Which drug somebody is on, read off the state tags it leaves behind (SOUND.md §4b).
//
// A drug is an ITEM you swallow and a STATE you hold afterwards, the split every consumable
// in docs/tags.yaml uses: Changa is gone the moment it is smoked, and Changa High is what
// is left. The soundtrack can only ask about the state, so this table is the way back from
// one to the other. `states` is what the item's `consumesInto` grants, less anything that
// outlives the high itself (Heroin's addiction is not being on Heroin).
//
// A drug counts as taken while EVERY one of its states is held. Bliss is refined Cave
// Fungus and leaves the same High behind with Euphoric on top, so a drug whose states are
// all inside another's that is also on is the lesser half of it, and drops out: somebody
// on Bliss is on Bliss, not on Bliss and Cave Fungus.
//
// Two drugs have no state to hear, so they are not here: Ambrosia leaves tag points rather
// than a tag, and the Black Market Autoinjector leaves Damaged Vision, which is an injury.
// Opium has no item at all, but Opium High is a real tag a GM can lay, so it is.
//
// Plain module, no imports: web/lib/gamePhase.js reads it on the server and the tests read
// it from plain Node. The SONG each drug gets is placeAmbience.js#BY_DRUG.
export const DRUGS = [
  { id: "cave-fungus", name: "Cave Fungus", states: ["high"] },
  { id: "bliss", name: "Bliss", states: ["euphoric", "high"] },
  { id: "heroin", name: "Heroin", states: ["doped"] },
  { id: "changa", name: "Changa", states: ["changa-high"] },
  { id: "buffout", name: "Buffout", states: ["buffout-high"] },
  { id: "eth-lod", name: "ETH-LOD", states: ["dissociated"] },
  { id: "love-tablets", name: "Love Tablets", states: ["in-love"] },
  { id: "opium", name: "Opium", states: ["opium-high"] },
];

/** Every state slug in the table, for narrowing a tag join to just these. */
export const DRUG_STATE_SLUGS = [...new Set(DRUGS.flatMap((d) => d.states))];

/**
 * The drugs a holder of `held` is on, in table order: `[{ id, takenAt }]`.
 *
 * `held` is `[{ slug, acquiredAt }]`. `takenAt` is when the NEWEST of the drug's states
 * arrived, in ms — so Bliss taken on top of a raw-fungus High is stamped by its Euphoric,
 * which is the dose that just happened.
 */
export function drugsHeld(held) {
  const at = new Map();
  for (const h of held ?? []) {
    const t = h.acquiredAt ? new Date(h.acquiredAt).getTime() : 0;
    at.set(h.slug, Math.max(at.get(h.slug) ?? 0, t));
  }
  const on = DRUGS.filter((d) => d.states.every((s) => at.has(s)));
  return on
    .filter(
      (d) =>
        !on.some(
          (o) => o !== d && o.states.length > d.states.length && d.states.every((s) => o.states.includes(s)),
        ),
    )
    .map((d) => ({ id: d.id, takenAt: Math.max(...d.states.map((s) => at.get(s))) }));
}
