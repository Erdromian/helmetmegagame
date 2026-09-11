// The Trinket turn-end pass (docs/systemdocs/TRINKETS.md), run from
// db/index.js#resolveNeeds() in the same slot as Lessons/Research/Confessions
// — order among the four does not matter, they share no state.
//
// Every OPEN Trinket Gambit (Action.gmNotes: "auto:trinket", filed by
// web/app/(app)/character/trinketActions.js) is rolled here: the stored die
// face, clamped up by the skilled floor, mapped straight to a tier and a
// base sell price (TRINKETS.md §1). Ingredient value is added on top, the
// finished Trinket is minted onto the smith's sheet with mintCustomCraft
// (db/lib/customCraftMint.js), and the Action is marked SOLVED with a reveal
// DM — the tier and the item, which a bare die face could never say on its
// own (a player has no reason to know face 6 means Masterwork).
//
// DELIBERATELY does not touch db/lib/gambitModifier.js. Every other Gambit
// this shape (Lessons, Confession) folds Hunger/mood into the roll via
// `Action.diceModifier`; Trinket's Action never has one set (it is left at
// its default of 0). The skilled floor below is a flat promise — "a trained
// smith never rolls worse than Normal" — and if a hungry skilled smith got
// clamped up to face 3 and then knocked back down by a −1 Hungry modifier,
// that promise would be a lie on exactly the turns it matters most. So this
// pass reads `diceRoll` alone and stops there.
//
// Returns Discord work as data, never sends it — same contract as
// db/lib/lessonPass.js; db/index.js treats a null return as a failed pass to
// retry rather than a turn with nothing to do.
const { SMITHING_SKILLED_SLUG } = require("./constants");
const { mintCustomCraft } = require("./customCraftMint");
const { addToStack } = require("./tagWrites");

const TRINKET_GMNOTES = "auto:trinket";

// Face -> tier (TRINKETS.md §1). Index 0 is unused (a d6 never rolls it).
const TIERS = [
  null,
  { name: "Awful", price: 5 },
  { name: "Poor", price: 8 },
  { name: "Normal", price: 14 },
  { name: "Good", price: 22 },
  { name: "Excellent", price: 34 },
  { name: "Masterwork", price: 60 },
];

// A smith holding {tag:smithing-skilled} never rolls Awful or Poor — training
// buys a floor, not just a better average. Plain {tag:smithing} has none.
// Exported for the test file, which checks this in isolation from the rest
// of the pass (no prisma needed to verify a clamp rule).
function clampFace(face, heldSlugs) {
  if (heldSlugs?.has(SMITHING_SKILLED_SLUG) && face < 3) return 3;
  return face;
}

function tierFor(face) {
  return TIERS[face] ?? TIERS[3];
}

async function runTrinketPass(prisma, turn) {
  const idle = { turnNumber: turn.number, resolved: 0, failed: 0, dms: [] };
  const actions = await prisma.action.findMany({
    where: {
      turnId: turn.id,
      moveKind: "GAMBIT",
      moveReviewStatus: "OPEN",
      gmNotes: { contains: TRINKET_GMNOTES },
    },
  });
  if (actions.length === 0) return idle;

  const baseTag = await prisma.tag.findUnique({ where: { slug: "trinket" } });
  if (!baseTag) {
    // The catalog row is missing (docs/tags.yaml never synced, or pruned) —
    // every filed Trinket fails together rather than one at a time, and the
    // pass retries next close the same way `runLessonPass` retries a whole
    // failed offer rather than half-applying it.
    console.error('Trinket pass: no {tag:trinket} catalog row — is docs/tags.yaml synced?');
    return { turnNumber: turn.number, resolved: 0, failed: actions.length, dms: [] };
  }

  let resolved = 0;
  let failed = 0;
  const dms = [];

  for (const action of actions) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const character = await tx.character.findUnique({
          where: { id: action.characterId },
          select: {
            id: true,
            name: true,
            status: true,
            discordUserId: true,
            tags: { select: { tag: { select: { slug: true } } } },
          },
        });
        // A GM deleted the character's Move, or the character since died —
        // either way there is nothing left to resolve for them.
        if (!character) return null;

        const heldSlugs = new Set(character.tags.map((ct) => ct.tag?.slug).filter(Boolean));
        const face = clampFace(action.diceRoll ?? 1, heldSlugs);
        const tier = tierFor(face);

        const details = action.craftBudget ?? {};
        const ingredientSlugs = Array.isArray(details.ingredientSlugs) ? details.ingredientSlugs : [];
        const inlayRows = ingredientSlugs.length
          ? await tx.tag.findMany({
              where: { slug: { in: ingredientSlugs } },
              select: { slug: true, inlayValue: true },
            })
          : [];
        const inlaySum = inlayRows.reduce((sum, t) => sum + (t.inlayValue ?? 0), 0);
        const price = tier.price + inlaySum;

        const composedName = details.name || `${tier.name} Trinket`;
        const composedDescription = details.description || baseTag.description;

        // The tier joins the dedup key alongside the ingredients: two smiths
        // (or the same smith twice) rolling the same tier off the same
        // ingredients stack onto one custom row, same as two identical
        // dishes do — but a Good Trinket and a Masterwork Trinket built from
        // the same inlay must NOT collide just because their words matched,
        // or the second one silently inherited the first roll's price.
        const cookedFrom = [...ingredientSlugs, `tier:${tier.name.toLowerCase()}`].sort();

        const { tag: minted } = await mintCustomCraft(tx, baseTag, {
          name: composedName,
          description: composedDescription,
          literal: true,
          cookedFrom,
          sellablePriceOverride: price,
        });

        await addToStack(tx, character.id, minted.id, 1, { source: "CRAFT", stackable: true });

        const resultMessage = `Made ${minted.name} at the forge (${tier.name}, worth ${price} ⬢).`;
        await tx.action.update({
          where: { id: action.id },
          data: { moveReviewStatus: "SOLVED", reviewedAt: new Date(), resultMessage },
        });

        return { character, tier, price, itemName: minted.name, face };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.character.discordUserId && outcome.character.status === "ALIVE") {
        dms.push({
          discordUserId: outcome.character.discordUserId,
          content: [
            `🎲 Your Gambit for turn ${turn.number}: **${outcome.face}**.`,
            `The forge gives you a **${outcome.tier.name}** Trinket: **${outcome.itemName}** (worth ${outcome.price} ⬢ to the merchant).`,
          ].join("\n"),
        });
      }
    } catch (err) {
      failed += 1;
      console.error(`Trinket ${action.id} failed to resolve:`, err);
    }
  }

  return { turnNumber: turn.number, resolved, failed, dms };
}

module.exports = { runTrinketPass, clampFace, tierFor, TIERS };
