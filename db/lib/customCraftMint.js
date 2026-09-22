// The custom-craft mint (CRAFTING.md, COOKING.md, TRINKETS.md): clones the
// base catalog row into a fresh custom + ephemeral tag for a `customizable`
// recipe crafted with player words (or a Trinket, whose "words" are the die's
// tier, or a DISH, which carries no words at all — no cooking recipe is
// customizable, so a dish mints on its INGREDIENTS and keeps its recipe's
// name); the craft grants THAT row instead of the base one. Lives in db/lib
// because BOTH faces need it: the web Craft dialog and the Trinket turn-end
// pass (db/lib/trinketPass.js), which runs from resolveNeeds() and can never
// require anything under web/. Throws a plain Error on the rare "no free
// name" collision — no UserError down here; the web wrapper converts it.
const { createWithRetry } = require("./paperMint");

// Mint-time copy of web/lib/customCraft.js#customCraftName, kept here since
// that module is ESM/web-only (words arrive ALREADY cleaned at request time).
// If this drifts from web/lib/customCraft.js, fix both places at once.
function customCraftName(baseName, name) {
  return name ? `${name} (${baseName})` : `${baseName} (custom)`;
}

// Runs OUTSIDE the craft transaction, deliberately. `sellablePriceOverride`
// and `gambitBonusOverride` are Trinket's own two doors onto this: both are
// computed by db/lib/trinketPass.js from the die and the INGREDIENTS, so
// neither can come off `baseTag` (the never-minted {tag:trinket} placeholder
// row, which carries a price of its own and no bonus at all). Every other
// caller omits both and gets the base tag's values copied straight across.
async function mintCustomCraft(
  db,
  baseTag,
  { name, description, literal = false, cookedFrom = [], sellablePriceOverride, gambitBonusOverride },
) {
  // A mint with no words keeps the recipe's own name, so a dish reads as plain
  // "Bread" however it was made. It used to carry its ingredients' tastes —
  // "Bread (organs)" — which put the one thing eating is supposed to reveal
  // into a name every stash, Search and pickpocket picker prints. COOKING.md §2.
  const composedName = literal
    ? name
    : name || description
      ? customCraftName(baseTag.name, name)
      : baseTag.name;
  const composedDescription = description || baseTag.description;
  const key = [...cookedFrom].sort();
  const existing = await db.tag.findFirst({
    where: {
      custom: true,
      ephemeral: true,
      name: composedName,
      description: composedDescription,
      cookedFrom: { equals: key },
    },
  });
  if (existing) return { tag: existing, minted: false };
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  const tag = await createWithRetry(db, (attempt) => ({
    slug: `custom-craft-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`,
    name: attempt ? `${composedName} (${attempt + 1})` : composedName,
    description: composedDescription,
    custom: true,
    ephemeral: true,
    craftable: false,
    customizable: false,
    pointCost: 0,
    category: baseTag.category,
    groupId: baseTag.groupId ?? null,
    tradeable: baseTag.tradeable,
    weightLbs: baseTag.weightLbs,
    stackable: baseTag.stackable,
    inspectVisibility: baseTag.inspectVisibility,
    equippable: baseTag.equippable,
    equipSlot: baseTag.equipSlot,
    equipLayer: baseTag.equipLayer,
    twoHanded: baseTag.twoHanded,
    customOfSlug: baseTag.slug,
    fighting: baseTag.fighting ?? undefined,
    meleeArmor: baseTag.meleeArmor,
    ballisticArmor: baseTag.ballisticArmor,
    concealsIdentity: baseTag.concealsIdentity,
    forcesConceal: baseTag.forcesConceal,
    concealSprite: baseTag.concealSprite,
    sprite: baseTag.sprite,
    miningBonus: baseTag.miningBonus ?? undefined,
    carryBonus: baseTag.carryBonus,
    // A clone must carry every "what this does while held" field or the
    // crafted thing quietly does less than the row it was cloned from. This
    // has gone wrong twice now (CRAFTING.md §4a).
    gambitBonus: gambitBonusOverride ?? baseTag.gambitBonus ?? null,
    removable: baseTag.removable,
    consumable: baseTag.consumable,
    consumesInto: baseTag.consumesInto,
    consumesIntoOneOf: baseTag.consumesIntoOneOf ?? undefined,
    consumesIntoUnless: baseTag.consumesIntoUnless ?? undefined,
    consumesIntoDurations: baseTag.consumesIntoDurations ?? undefined,
    consumesIntoResources: baseTag.consumesIntoResources,
    cookedFrom: key,
    mealMood: baseTag.mealMood,
    mealHunger: baseTag.mealHunger,
    // The eating-side twin of mealMood/mealHunger above (COOKING.md §2/§2a)
    // — miss this and every minted dish reads its base taste as empty,
    // showing only its additional ingredients' tastes on the taste line.
    mealTaste: baseTag.mealTaste,
    mealTasteForm: baseTag.mealTasteForm,
    sellable: baseTag.sellable,
    sellablePrice: sellablePriceOverride ?? baseTag.sellablePrice,
    defaultDurationTurns: baseTag.defaultDurationTurns,
    expiresInto: baseTag.expiresInto ?? undefined,
  }));
  if (!tag)
    throw new Error("Couldn't find a free name for that — try different words.");
  return { tag, minted: true };
}

// Best-effort undo when the craft transaction failed. `custom` guard means
// this can never touch a catalog row; an already-held row is FK-pinned and
// survives (prune's problem, not ours). Failures swallowed — the craft's own error is shown instead.
async function unmintCustomCraft(db, grant) {
  if (!grant?.minted) return;
  await db.tag
    .deleteMany({ where: { id: grant.tag.id, custom: true, ephemeral: true } })
    .catch(() => {});
}

module.exports = {
  mintCustomCraft,
  unmintCustomCraft,
  customCraftName,
};
