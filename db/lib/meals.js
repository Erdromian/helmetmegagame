// The three meal classes (E:\Bascinet\V3\Soilery\Soilery Rework.docx;
// docs/systemdocs/COOKING.md). A cook picks a class, names the meal, describes
// it, may slot extra ingredients and may pick one base taste; the Craft path
// (web/app/(app)/character/actions/crafting.js) mints the dish off the class's
// catalog template (docs/tags.yaml: basic-meal, skilled-meal, lavish-meal).
//
// Zero requires, ever: the Craft dialog imports this in the browser.

// Keyed by the Tag.mealClass enum value. `mark` goes either side of the
// cook's name, so a Skilled "Scones" reads "+Scones+" and a Lavish "Caviar"
// reads "*Caviar*" (and is drawn in italics — web/app/components/TagName.js).
const MEAL_CLASSES = Object.freeze({
  BASIC: { slug: "basic-meal", label: "Basic", mark: "", kitchen: false },
  SKILLED: { slug: "skilled-meal", label: "Skilled", mark: "+", kitchen: false },
  LAVISH: { slug: "lavish-meal", label: "Lavish", mark: "*", kitchen: true },
});

// The doc: "Chefs may only use letters of the alphabet for the name of the
// tag itself." Single spaces between words are allowed, so "Meat Pie" is a
// name; digits, symbols and punctuation are not — which is also what stops a
// Basic cook from typing their own "+" or "*".
const MEAL_NAME_MAX = 30;
const MEAL_DESCRIPTION_MAX = 300;
const MEAL_NAME_RE = /^[A-Za-z]+( [A-Za-z]+)*$/;

// The one base taste a cook may pick. Adjectives, so the taste line reads
// "it tastes earthy" (COOKING.md §8). The vocabulary the catalog's own
// ingredients already use.
const MEAL_TASTES = Object.freeze([
  "acidic",
  "acrid",
  "bitter",
  "cheesy",
  "creamy",
  "crunchy",
  "earthy",
  "fishy",
  "holy",
  "meaty",
  "numbing",
  "rich",
  "salty",
  "sweet",
  "toxic",
]);

// Trimmed, inner runs of spaces collapsed; null if it is not a legal name.
function cleanMealName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MEAL_NAME_MAX) return null;
  return MEAL_NAME_RE.test(name) ? name : null;
}

function decorateMealName(mealClass, name) {
  const mark = MEAL_CLASSES[mealClass]?.mark ?? "";
  return `${mark}${name}${mark}`;
}

function cleanMealTaste(raw) {
  return typeof raw === "string" && MEAL_TASTES.includes(raw) ? raw : "";
}

function isLavish(tag) {
  return tag?.mealClass === "LAVISH";
}

function needsKitchen(tag) {
  return Boolean(MEAL_CLASSES[tag?.mealClass]?.kitchen);
}

module.exports = {
  MEAL_CLASSES,
  MEAL_NAME_MAX,
  MEAL_DESCRIPTION_MAX,
  MEAL_TASTES,
  cleanMealName,
  decorateMealName,
  cleanMealTaste,
  isLavish,
  needsKitchen,
};
