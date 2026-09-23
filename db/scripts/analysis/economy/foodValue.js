// What a food or an ingredient is worth, one rule for the whole report.
//
// What the counter pays for a thing (sellablePrice) is a sale anybody can make, so that comes first.
// Otherwise a FOOD is worth what the same hunger and mood would cost from a Ration Box — its hunger plus
// `moodWeight` times its cooked mood, at the box's ¢ a point, never less than nothing — and never MORE
// than the Depot's shelf price where it stocks one, since nobody pays a grower more for an onion than the
// Depot asks for the same onion. (Read the shelf price as a ceiling, not a value: taking it as the value
// paid an onion farmer 185 ¢ a turn.) A raw mood penalty is ignored here: it is the thing cooking removes,
// so it says nothing about what the crop is worth to the cook who buys it. A dish's own mood, good or bad,
// still counts in full through `asFood`. The box is the one thing anybody can order that prices hunger
// and mood at once.
//
// A thing that is not food (a drink with no hunger, a key, a tool) has no food worth to cap it, so it keeps
// its plain price: what the counter pays, else what the shelf asks.
//
// `moodWeight` is how many points of hunger a point of mood counts as. Nothing in the game states that
// rate, so it is a modelling choice (`--mood-weight`). The box's own mood is negative, so a higher weight
// raises its ¢ a point and every unpriced food with it.

const hungerLib = require("../../../lib/hunger");

// box: { buy, hunger, mood } for the Ration Box, as the model's food list reckons it.
function makeFoodValue({ box, moodWeight }) {
  const points = (hunger, mood) => hunger + moodWeight * mood;
  const perHunger = box && box.hunger > 0 ? box.buy / box.hunger : null;
  const boxPoints = box ? points(box.hunger, box.mood) : null;
  const perPoint = box && boxPoints > 0 ? box.buy / boxPoints : perHunger;

  // Something a person eats: it restores hunger, or has a cooked block, or is a dish.
  const isFood = (t) => Boolean(t) && (hungerLib.foodHungerFor(t) > 0 || t.cooked != null || t.mealHunger != null);
  // The food half on its own, for a thing whose market price is not the question (a dish's worth to an eater).
  const asFood = (hunger, mood) => (perPoint == null ? 0 : Math.max(0, points(hunger, mood)) * perPoint);
  const rawFood = (t) => asFood(hungerLib.foodHungerFor(t), Math.max(0, t?.cooked?.mood ?? 0));

  const of = (t) => {
    if (t?.sellablePrice != null) return t.sellablePrice;
    if (!isFood(t)) return t?.depotPrice ?? 0;
    return t.depotPrice != null ? Math.min(t.depotPrice, rawFood(t)) : rawFood(t);
  };
  // Where `of` got its figure: "sell", "buy" (the shelf price: a non-food, or a food whose shelf price was the
  // lower), "food" (off the box), or "none" (a non-food with no price at all).
  const basisOf = (t) => {
    if (t?.sellablePrice != null) return "sell";
    if (!isFood(t)) return t?.depotPrice != null ? "buy" : "none";
    return t.depotPrice != null && t.depotPrice <= rawFood(t) ? "buy" : "food";
  };

  // What a maker is charged for one recipe input. A food input is worth what the rule above says, as the
  // cooking tab prices it. Anything else is what a maker pays at the shelf, else what it would fetch instead.
  const inputCost = (t) => (isFood(t) ? of(t) : t?.depotPrice ?? t?.sellablePrice ?? 0);
  const inputBasisOf = (t) => (isFood(t) ? basisOf(t) : t?.depotPrice != null ? "buy" : t?.sellablePrice != null ? "sell" : "none");

  return { moodWeight, perHunger, perPoint, isFood, asFood, rawFood, of, basisOf, inputCost, inputBasisOf };
}

module.exports = { makeFoodValue };
