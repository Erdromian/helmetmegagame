// One-off: move a game that is already running onto the Soilery Rework
// (E:\Bascinet\V3\Soilery\Soilery Rework.docx; docs/systemdocs/SOILERY.md,
// COOKING.md, TURN-ENGINE.md §5).
//
// db:sync-tags is upsert-only, so after the deploy everybody still holds the
// old crops, seed bags, sowing licences, Ate Meal/Dined markers and plain
// recipe dishes, and nobody holds a hunger descriptor yet. This script moves
// all of it onto the new items, and only then can `npm run db:prune-tags`
// delete the retired rows safely — prune deletes a tag's RoomTag and
// VendingSlot rows with it (cascade), and refuses a tag a CraftProject names.
//
//   - A food crop becomes 1 Foodstuff (hunger for hunger: a crop was 2-4, a
//     Foodstuff is 4); a seed bag becomes 2 Foodstuffs. Everywhere they are
//     held: characters, room floors (hidden units too), vending slots and
//     crate manifests. Poison rides along with them.
//   - Sowing licences, Tobacco, Pigtails and Ate Meal are deleted. (Dined
//     was too, until it came back as what a Lavish meal leaves.)
//   - A plain recipe dish (a catalog `bread` row held as-is) becomes a meal
//     of the matching class, dressed in that class's symbols and keeping the
//     recipe's own hunger, mood and taste. A dish already minted off a recipe
//     is re-pointed at its class and given the symbols too.
//   - A custom tag that granted Ate Meal or Dined stops granting it; Dined
//     comes from eating a Lavish meal now, never from a tag's consumesInto.
//   - Every living character gets the hunger descriptor their meter says.
//   - The Stable gets its three unruly arelitz, once.
//   - Room stash seeds that name a retired slug are rewritten.
//
// Dry run unless given `-- --apply`. Idempotent: a second run finds nothing
// left to move. Run db:sync-tags (the deploy does) before it, and
// `npm run db:prune-tags` after it.
require("dotenv").config();
const { prisma } = require("../../index");
const {
  FOODSTUFFS_SLUG,
  HUNGERLESS_SLUG,
  HUNGER_DESCRIPTOR_SLUGS,
  UNRULY_ARELITZ_SLUG,
} = require("../../lib/constants");
const { bandOf, DESCRIPTORS } = require("../../lib/hunger");
const { MEAL_CLASSES, decorateMealName } = require("../../lib/meals");
const { addToStack, dropCharacterTag, addToRoomStack, dropRoomTag } = require("../../lib/tagWrites");
const { settleCarry } = require("../../lib/carry");

const ECON = { reason: "soilery_rework" };

// Retired food, and what one unit of it becomes.
const TO_FOODSTUFFS = {
  wheat: 1,
  potato: 1,
  tomato: 1,
  carrot: 1,
  onion: 1,
  "plump-helmet": 1,
  "wheat-seed-bag": 2,
  "potato-seed-bag": 2,
  "tomato-seed-bag": 2,
  "carrot-seed-bag": 2,
  "onion-seed-bag": 2,
  "plump-helmet-seed-bag": 2,
  "pigtails-seed-bag": 2,
  "tobacco-seed-bag": 2,
};

// Retired outright.
const DELETE = [
  "sowing-wheat",
  "sowing-potato",
  "sowing-tomato",
  "sowing-carrot",
  "sowing-onion",
  "sowing-plump-helmet",
  "sowing-pigtails",
  "sowing-tobacco",
  "tobacco",
  "pigtails",
  "ate-meal",
  // Not "dined": it came back as what a Lavish meal leaves (db/lib/dined.js),
  // so a second run must not take it off the people who have just eaten one.
];

// The 36 named recipes, by the tier the old COOKING.md §2a put them in.
const RECIPE_CLASS = {
  ...Object.fromEntries(
    [
      "bread", "potato-bread", "pasta", "baked-potato", "red-mash", "vegetable-stew", "ratato",
      "tomato-soup", "fried-onion", "broth", "fried-meat", "fried-rat", "fried-mushroom", "poached-rat",
      "fish-stew", "fried-fish", "omelette", "sausage", "salo",
    ].map((s) => [s, "BASIC"]),
  ),
  ...Object.fromEntries(
    ["hash-brown", "egg-in-the-hole", "pizza-slice", "sandwich", "honeyed-sweets", "scones", "honeyed-cakes"].map((s) => [
      s,
      "SKILLED",
    ]),
  ),
  ...Object.fromEntries(
    [
      "carrot-cake", "pancakes", "steak", "caviar", "meat-pie", "honeyed-crayfish", "soaked-truffles",
      "fondue", "foie-gras", "northern-delight",
    ].map((s) => [s, "LAVISH"]),
  ),
};

const RETIRED_GRANTS = new Set(["ate-meal", "dined"]);
// What an unpriced food restored while it granted Ate Meal (the old
// db/lib/hunger.js DEFAULT_FOOD_HUNGER). A custom tag that leaned on it keeps it.
const OLD_DEFAULT_FOOD_HUNGER = 12;

function mark(s) {
  return MEAL_CLASSES[s]?.mark ?? "";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const say = (line) => console.log(line);
  const verb = (did, would) => (apply ? did : would);
  say(`${apply ? "APPLYING" : "DRY RUN (add -- --apply to write)"} — database ${new URL(process.env.DATABASE_URL).host}`);

  // --- What is in this database ---------------------------------------------
  const templateSlugs = Object.values(MEAL_CLASSES).map((c) => c.slug);
  const needed = await prisma.tag.findMany({
    where: { slug: { in: [FOODSTUFFS_SLUG, ...templateSlugs, ...HUNGER_DESCRIPTOR_SLUGS, UNRULY_ARELITZ_SLUG] } },
  });
  const bySlug = new Map(needed.map((t) => [t.slug, t]));
  const missing = [FOODSTUFFS_SLUG, ...templateSlugs, ...HUNGER_DESCRIPTOR_SLUGS].filter((s) => !bySlug.has(s));
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")} — run npm run db:sync-tags first.`);
    process.exitCode = 1;
    return;
  }
  const foodstuffs = bySlug.get(FOODSTUFFS_SLUG);
  const templateFor = Object.fromEntries(Object.entries(MEAL_CLASSES).map(([cls, c]) => [cls, bySlug.get(c.slug)]));

  const retired = await prisma.tag.findMany({
    where: { slug: { in: [...Object.keys(TO_FOODSTUFFS), ...DELETE, ...Object.keys(RECIPE_CLASS)] } },
  });
  const retiredById = new Map(retired.map((t) => [t.id, t]));
  say(`Retired tags still in the catalog: ${retired.length}.`);

  // --- 1. Nobody cooks an old recipe again ----------------------------------
  // Their Ate Meal/Dined grants come off too: prune refuses to delete a tag
  // another row still names, even one it is about to delete as well.
  const openRecipes = retired.filter(
    (t) => RECIPE_CLASS[t.slug] && (t.craftable || (t.consumesInto ?? []).some((s) => RETIRED_GRANTS.has(s))),
  );
  say(`1. ${verb("Closed", "Would close")} ${openRecipes.length} old recipe(s) to crafting.`);
  if (apply) {
    for (const t of openRecipes) {
      await prisma.tag.update({
        where: { id: t.id },
        data: { craftable: false, consumesInto: (t.consumesInto ?? []).filter((s) => !RETIRED_GRANTS.has(s)) },
      });
    }
  }

  // --- 2. Where each retired tag goes ---------------------------------------
  // tagId -> { to: Tag | null, factor }
  const route = new Map();
  for (const t of retired) {
    if (TO_FOODSTUFFS[t.slug]) route.set(t.id, { to: foodstuffs, factor: TO_FOODSTUFFS[t.slug] });
    else if (DELETE.includes(t.slug)) route.set(t.id, { to: null, factor: 0 });
  }
  // A plain recipe dish becomes a meal of its class. Minted (or found) only
  // when somebody actually holds one somewhere.
  const recipeIds = retired.filter((t) => RECIPE_CLASS[t.slug]).map((t) => t.id);
  const heldRecipeIds = new Set(
    [
      ...(await prisma.characterTag.findMany({ where: { tagId: { in: recipeIds } }, select: { tagId: true } })),
      ...(await prisma.roomTag.findMany({ where: { tagId: { in: recipeIds } }, select: { tagId: true } })),
      ...(await prisma.vendingSlot.findMany({ where: { tagId: { in: recipeIds } }, select: { tagId: true } })),
    ].map((r) => r.tagId),
  );
  const crates = await prisma.tag.findMany({ where: { crateContents: { not: null } }, select: { id: true, name: true, crateContents: true } });
  for (const c of crates) {
    for (const line of Array.isArray(c.crateContents) ? c.crateContents : []) {
      if (recipeIds.includes(line.tagId)) heldRecipeIds.add(line.tagId);
    }
  }
  for (const id of heldRecipeIds) {
    const recipe = retiredById.get(id);
    const meal = await mealFor(recipe, templateFor[RECIPE_CLASS[recipe.slug]], apply);
    route.set(id, { to: meal, factor: 1 });
    say(`2. ${recipe.name} ${verb("becomes", "would become")} the ${MEAL_CLASSES[RECIPE_CLASS[recipe.slug]].label} meal "${meal.name}".`);
  }
  const routedIds = [...route.keys()];
  const touched = new Set();

  // --- 3. Characters --------------------------------------------------------
  const held = await prisma.characterTag.findMany({
    where: { tagId: { in: routedIds } },
    include: { character: { select: { name: true } } },
  });
  const heldCounts = {};
  for (const row of held) {
    const { to, factor } = route.get(row.tagId);
    const from = retiredById.get(row.tagId);
    const key = `${from.slug} -> ${to ? `${to.name} x${factor}` : "deleted"}`;
    heldCounts[key] = (heldCounts[key] ?? 0) + row.quantity;
    touched.add(row.characterId);
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      if (to) {
        await addToStack(tx, row.characterId, to.id, row.quantity * factor, {
          source: row.source,
          stackable: true,
          poisonedCount: (row.poisonedCount ?? 0) * factor,
          poisonPayload: row.poisonPayload,
          econ: ECON,
        });
      }
      await dropCharacterTag(tx, row.characterId, row.tagId, null, { econ: ECON });
    });
  }
  say(`3. Characters: ${verb("moved", "would move")} ${held.length} holding(s) across ${touched.size} character(s):`);
  for (const [k, n] of Object.entries(heldCounts)) say(`     ${n} × ${k}`);

  // --- 4. Room floors -------------------------------------------------------
  const floors = await prisma.roomTag.findMany({ where: { tagId: { in: routedIds } }, include: { room: { select: { name: true } } } });
  say(`4. Rooms: ${verb("moved", "would move")} ${floors.length} stack(s) on room floors.`);
  for (const row of floors) {
    const { to, factor } = route.get(row.tagId);
    say(`     ${row.room?.name ?? row.roomId}: ${row.quantity} × ${retiredById.get(row.tagId).slug}${row.hiddenQuantity ? ` (${row.hiddenQuantity} hidden)` : ""} -> ${to ? `${to.name} x${factor}` : "deleted"}`);
    if (!apply) continue;
    // A room stack's hidden units are counted apart from the visible ones
    // (`hiddenQuantity`, SEARCH.md §9), so each half moves on its own.
    await prisma.$transaction(async (tx) => {
      if (to) {
        if (row.quantity > 0) {
          await addToRoomStack(tx, row.roomId, to.id, row.quantity * factor, {
            expiresTurn: row.expiresTurn,
            poisonedCount: (row.poisonedCount ?? 0) * factor,
            poisonPayload: row.poisonPayload,
            econ: ECON,
          });
        }
        if (row.hiddenQuantity || row.hiddenPoisonedCount) {
          const hidden = {
            hiddenQuantity: (row.hiddenQuantity ?? 0) * factor,
            hiddenPoisonedCount: (row.hiddenPoisonedCount ?? 0) * factor,
          };
          await tx.roomTag.upsert({
            where: { roomId_tagId: { roomId: row.roomId, tagId: to.id } },
            update: {
              hiddenQuantity: { increment: hidden.hiddenQuantity },
              hiddenPoisonedCount: { increment: hidden.hiddenPoisonedCount },
            },
            create: { roomId: row.roomId, tagId: to.id, quantity: 0, ...hidden },
          });
        }
      }
      if (row.quantity > 0) await dropRoomTag(tx, row.roomId, row.tagId, row.quantity, { econ: ECON });
      await tx.roomTag.deleteMany({ where: { roomId: row.roomId, tagId: row.tagId } });
    });
  }

  // --- 5. Vending slots -----------------------------------------------------
  const slots = await prisma.vendingSlot.findMany({ where: { tagId: { in: routedIds } } });
  say(`5. Vending: ${verb("moved", "would move")} ${slots.length} slot(s).`);
  if (apply) {
    for (const slot of slots) {
      const { to, factor } = route.get(slot.tagId);
      await prisma.$transaction(async (tx) => {
        if (to) {
          const existing = await tx.vendingSlot.findUnique({ where: { machineId_tagId: { machineId: slot.machineId, tagId: to.id } } });
          if (existing) {
            await tx.vendingSlot.update({
              where: { id: existing.id },
              data: {
                quantity: { increment: slot.quantity * factor },
                poisonedCount: { increment: (slot.poisonedCount ?? 0) * factor },
                poisonPayload: existing.poisonPayload ?? slot.poisonPayload,
              },
            });
          } else {
            await tx.vendingSlot.create({
              data: {
                machineId: slot.machineId,
                tagId: to.id,
                quantity: slot.quantity * factor,
                priceObols: factor > 1 ? Math.max(0, Math.round(slot.priceObols / factor)) : slot.priceObols,
                poisonedCount: (slot.poisonedCount ?? 0) * factor,
                poisonPayload: slot.poisonPayload,
                expiresTurn: slot.expiresTurn,
              },
            });
          }
        }
        await tx.vendingSlot.delete({ where: { id: slot.id } });
      });
    }
  }

  // --- 6. Crate manifests ---------------------------------------------------
  let cratesChanged = 0;
  for (const c of crates) {
    const lines = Array.isArray(c.crateContents) ? c.crateContents : [];
    if (!lines.some((l) => route.has(l.tagId))) continue;
    cratesChanged += 1;
    const next = [];
    for (const l of lines) {
      const r = route.get(l.tagId);
      if (!r) next.push(l);
      else if (r.to) {
        next.push({
          ...l,
          tagId: r.to.id,
          name: r.to.name,
          quantity: (l.quantity ?? 1) * r.factor,
          ...(l.poisonedCount ? { poisonedCount: l.poisonedCount * r.factor } : {}),
        });
      }
    }
    if (apply) await prisma.tag.update({ where: { id: c.id }, data: { crateContents: next } });
  }
  say(`6. Crates: ${verb("rewrote", "would rewrite")} ${cratesChanged} manifest(s).`);

  // --- 7. Projects, and what only a GM can put right -------------------------
  const projects = await prisma.craftProject.findMany({ where: { tagId: { in: recipeIds } }, select: { id: true, tagId: true } });
  say(`7. Craft projects naming an old recipe: ${projects.length} ${verb("re-pointed at their class", "would be re-pointed at their class")}.`);
  if (apply) {
    for (const p of projects) {
      const cls = RECIPE_CLASS[retiredById.get(p.tagId).slug];
      await prisma.craftProject.update({ where: { id: p.id }, data: { tagId: templateFor[cls].id } });
    }
  }
  const retiredIdSet = new Set(retired.map((t) => t.id));
  const pending = await prisma.stagedEffect.findMany({ select: { id: true, payload: true } }).catch(() => []);
  const stuck = pending.filter((s) => JSON.stringify(s.payload ?? {}).split('"').some((w) => retiredIdSet.has(w)));
  if (stuck.length) say(`   ! ${stuck.length} staged effect(s) still name a retired tag — fix by hand on /gm/turns before the push: ${stuck.map((s) => s.id).join(", ")}`);

  // --- 8. Custom tags: minted dishes and anything that granted Ate Meal ------
  const customs = await prisma.tag.findMany({
    where: { custom: true },
    select: {
      id: true, name: true, customOfSlug: true, mealClass: true, mealHunger: true, cooked: true,
      consumesInto: true, consumesIntoOneOf: true, consumesIntoDurations: true, consumesIntoUnless: true,
    },
  });
  let dishes = 0;
  let unmealed = 0;
  for (const t of customs) {
    const data = {};
    const cls = RECIPE_CLASS[t.customOfSlug];
    if (cls && !t.mealClass) {
      dishes += 1;
      data.mealClass = cls;
      data.customOfSlug = MEAL_CLASSES[cls].slug;
      const m = mark(cls);
      if (m && !(t.name.startsWith(m) && t.name.endsWith(m))) data.name = decorateMealName(cls, t.name);
    }
    const grants = t.consumesInto ?? [];
    if (grants.some((s) => RETIRED_GRANTS.has(s)) || JSON.stringify(t.consumesIntoOneOf ?? null).match(/ate-meal|dined/)) {
      unmealed += 1;
      const keep = [];
      const oneOf = [];
      grants.forEach((slug, i) => {
        const alts = t.consumesIntoOneOf?.[i] ?? null;
        if (Array.isArray(alts)) {
          keep.push(slug);
          oneOf.push(alts.map((a) => (RETIRED_GRANTS.has(a) ? "nothing" : a)));
        } else if (!RETIRED_GRANTS.has(slug)) {
          keep.push(slug);
          oneOf.push(null);
        }
      });
      data.consumesInto = keep;
      if (t.consumesIntoOneOf) data.consumesIntoOneOf = oneOf.some(Boolean) ? oneOf : undefined;
      for (const col of ["consumesIntoDurations", "consumesIntoUnless"]) {
        if (t[col] && typeof t[col] === "object") {
          const cleaned = Object.fromEntries(Object.entries(t[col]).filter(([k]) => !RETIRED_GRANTS.has(k)));
          data[col] = cleaned;
        }
      }
      if (!Number.isInteger(t.mealHunger) && !Number.isInteger(t.cooked?.hunger)) data.mealHunger = OLD_DEFAULT_FOOD_HUNGER;
    }
    if (apply && Object.keys(data).length) await prisma.tag.update({ where: { id: t.id }, data });
  }
  say(`8. Custom tags: ${verb("re-classed", "would re-class")} ${dishes} minted dish(es); ${verb("stripped", "would strip")} Ate Meal/Dined from ${unmealed}.`);

  // --- 9. Hunger descriptors -------------------------------------------------
  const descriptorTags = HUNGER_DESCRIPTOR_SLUGS.map((s) => bySlug.get(s));
  const alive = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { id: true, hungerValue: true, tags: { where: { tag: { slug: HUNGERLESS_SLUG } }, select: { tagId: true } } },
  });
  const bands = { full: [], hungry: [], starving: [], none: [] };
  for (const c of alive) bands[c.tags.length ? "none" : bandOf(c.hungerValue)].push(c.id);
  say(`9. Descriptors: ${verb("set", "would set")} Full ${bands.full.length}, Hungry ${bands.hungry.length}, Starving ${bands.starving.length}; ${bands.none.length} Hungerless hold none.`);
  if (apply) {
    await prisma.$transaction(async (tx) => {
      await tx.characterTag.deleteMany({ where: { characterId: { in: alive.map((c) => c.id) }, tagId: { in: descriptorTags.map((t) => t.id) } } });
      for (const band of ["full", "hungry", "starving"]) {
        const tag = bySlug.get(DESCRIPTORS[band].slug);
        await tx.characterTag.createMany({
          data: bands[band].map((characterId) => ({ characterId, tagId: tag.id, source: "EVENT", expiresTurn: null })),
          skipDuplicates: true,
        });
      }
      await tx.character.updateMany({ where: { hungerValue: { gt: 0 }, starvingSinceTurn: { not: null } }, data: { starvingSinceTurn: null } });
    });
  }

  // --- 10. The Stable's three unruly arelitz ---------------------------------
  const unruly = bySlug.get(UNRULY_ARELITZ_SLUG);
  const stables = await prisma.room.findMany({ where: { stable: true }, select: { id: true, name: true, seededStashSlugs: true } });
  for (const room of stables) {
    if (!unruly || room.seededStashSlugs.includes(UNRULY_ARELITZ_SLUG)) continue;
    say(`10. ${room.name}: ${verb("added", "would add")} 3 Unruly Arelitz.`);
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await addToRoomStack(tx, room.id, unruly.id, 3, { econ: ECON });
        await tx.room.update({ where: { id: room.id }, data: { seededStashSlugs: { push: UNRULY_ARELITZ_SLUG } } });
      });
    }
  }

  // --- 11. Stash seeds naming a retired slug --------------------------------
  const seeded = await prisma.room.findMany({ where: { stashSeed: { not: null } }, select: { id: true, name: true, stable: true, stashSeed: true } });
  let seedsChanged = 0;
  for (const room of seeded) {
    const seed = room.stashSeed ?? {};
    let changed = false;
    const rewrite = (list) =>
      (Array.isArray(list) ? list : []).flatMap(([slug, qty]) => {
        if (TO_FOODSTUFFS[slug]) {
          changed = true;
          return [[FOODSTUFFS_SLUG, qty * TO_FOODSTUFFS[slug]]];
        }
        if (RECIPE_CLASS[slug]) {
          changed = true;
          return [[FOODSTUFFS_SLUG, qty * 4]];
        }
        if (DELETE.includes(slug)) {
          changed = true;
          return [];
        }
        return [[slug, qty]];
      });
    const merge = (list) => {
      const m = new Map();
      for (const [s, q] of list) m.set(s, (m.get(s) ?? 0) + q);
      return [...m.entries()];
    };
    const next = { ...seed, items: merge(rewrite(seed.items)), ...(seed.hidden ? { hidden: merge(rewrite(seed.hidden)) } : {}) };
    if (room.stable && !next.items.some(([s]) => s === UNRULY_ARELITZ_SLUG)) {
      next.items.push([UNRULY_ARELITZ_SLUG, 3]);
      changed = true;
    }
    if (!changed) continue;
    seedsChanged += 1;
    if (apply) await prisma.room.update({ where: { id: room.id }, data: { stashSeed: next } });
  }
  say(`11. Stash seeds: ${verb("rewrote", "would rewrite")} ${seedsChanged} room(s).`);

  // --- 12. Weight ------------------------------------------------------------
  // A Foodstuff weighs 1 lb against a crop's 0.17, so a converted kit can put
  // somebody over their cap. Settled without dropping anything on the floor.
  if (apply) {
    for (const id of touched) await settleCarry(prisma, id, { drop: false }).catch((err) => console.error(`carry ${id}:`, err.message));
  }
  say(`12. Carry: ${verb("settled", "would settle")} ${touched.size} character(s), dropping nothing.`);

  say(apply ? "Done. Now run: npm run db:prune-tags (dry run first)." : "Dry run only. Nothing was written.");
}

// The minted meal a plain recipe dish becomes: a clone of the recipe row (its
// sprite, weight, hunger, mood and taste are what the holder was promised),
// re-classed and dressed in its class's symbols. Found again on a second run.
async function mealFor(recipe, template, apply) {
  const cls = template.mealClass;
  const name = decorateMealName(cls, recipe.name);
  const existing = await prisma.tag.findFirst({
    where: { custom: true, ephemeral: true, customOfSlug: template.slug, name, description: recipe.description, cookedFrom: { equals: [] } },
  });
  if (existing || !apply) return existing ?? { id: `(new ${cls} meal)`, name };
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return prisma.tag.create({
    data: {
      slug: `custom-craft-${stamp}-${rand}`,
      name,
      description: recipe.description,
      custom: true,
      ephemeral: true,
      craftable: false,
      customizable: false,
      pointCost: 0,
      category: recipe.category,
      groupId: recipe.groupId ?? null,
      tradeable: recipe.tradeable,
      weightLbs: recipe.weightLbs,
      stackable: true,
      inspectVisibility: recipe.inspectVisibility,
      sprite: recipe.sprite,
      consumable: true,
      consumesInto: (recipe.consumesInto ?? []).filter((s) => !RETIRED_GRANTS.has(s)),
      customOfSlug: template.slug,
      cookedFrom: [],
      mealClass: cls,
      mealMood: recipe.mealMood,
      mealHunger: recipe.mealHunger,
      mealTaste: recipe.mealTaste,
      mealTasteForm: recipe.mealTasteForm,
      sellable: recipe.sellable,
      sellablePrice: recipe.sellablePrice,
    },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
