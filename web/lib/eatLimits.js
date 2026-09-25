// The Consume slider's top end, per held consumable (the Soilery Rework doc):
// what you hold, or how many you can eat before your hunger reaches 100,
// whichever is lower (db/lib/hunger.js#eatMaxFor). Worked out on the server,
// because it needs the hunger meter and each dish's own figures, neither of
// which ever reaches the browser — only the resulting counts cross. A count
// says no more than the slider itself would.
//
// `character` is a loader row with its tags INCLUDED whole (tag.consumable,
// tag.stackable, tag.mealHunger, tag.cooked, tag.cookedFrom) and hungerValue.
import { unitHungerFor, eatMaxFor, HUNGER_MAX } from "@lifeweb/db/lib/hunger";
import { GLUTTON_SLUG, HUNGERLESS_SLUG } from "@lifeweb/db/lib/constants";

export async function eatLimitsFor(prisma, character) {
  const rows = (character?.tags ?? []).filter((ct) => ct.tag?.consumable);
  if (!rows.length) return {};
  const held = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  const glutton = held.has(GLUTTON_SLUG);
  const hungerless = held.has(HUNGERLESS_SLUG);
  const hungerValue = character.hungerValue ?? HUNGER_MAX;

  // A dish's ingredients, in one read for the whole sheet.
  const slugs = [...new Set(rows.flatMap((ct) => ct.tag.cookedFrom ?? []))];
  const ingredients = slugs.length
    ? await prisma.tag.findMany({ where: { slug: { in: slugs } }, select: { slug: true, mealHunger: true, cooked: true } })
    : [];
  const bySlug = new Map(ingredients.map((t) => [t.slug, t]));

  const out = {};
  for (const ct of rows) {
    const perUnit = unitHungerFor(
      ct.tag,
      (ct.tag.cookedFrom ?? []).map((s) => bySlug.get(s)).filter(Boolean),
    );
    const have = ct.tag.stackable ? ct.quantity ?? 1 : 1;
    out[ct.tagId] = eatMaxFor({ hungerValue, perUnit, held: have, glutton, hungerless });
  }
  return out;
}
