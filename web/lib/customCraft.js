// Custom craftables (docs/systemdocs/CRAFTING.md): a `customizable` recipe
// may be crafted as a player-named item for a surcharge, and the wayside
// shrine takes a builder's inscription. This module is the ONE place that
// decides what counts as customized and what the words may contain — shared
// by the dialog (RequestActionsProvider prices the ⬢ it shows) and the
// server action (which prices what it charges), so the two can never drift
// on "is this name blank" the way billedSeen exists to prevent for the Move.
// Pure — no prisma, no React — importable from either side.

export const CUSTOM_SURCHARGE = 1; // ⬢ per unit, on top of the recipe's own
export const CUSTOM_NAME_MAX = 30;
export const CUSTOM_DESCRIPTION_MAX = 300;
export const INSCRIPTION_MAX = 200;

// Player-authored text, defanged. Four removals, each closing a real hole:
// `{` `}` so a description can never form a rich token ({tag:…}/{resource:…}
// render as REAL chips via richTokens.js — a player must not be able to
// forge one); `‡` because the mark means "unreviewed drafted copy" and these
// are a player's own words (also the convention: player prose is neither
// Claude's nor Bascinet's); `@` because item names travel into Discord
// messages that default to parsing mentions; and control characters.
export function cleanCustomText(raw, max) {
  if (typeof raw !== "string") return "";
  const printable = [...raw]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || code === 127) return " ";
      return "{}@\u2021".includes(ch) ? " " : ch;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

// The single verdict both sides use: the cleaned fields, and whether this
// craft is customized at all (either field non-empty after cleaning).
export function customCraftFields({ customName, customDescription } = {}) {
  const name = cleanCustomText(customName, CUSTOM_NAME_MAX);
  const description = cleanCustomText(customDescription, CUSTOM_DESCRIPTION_MAX);
  return { name, description, active: Boolean(name || description) };
}

// The displayed name always carries the base identity — "Steak Dinner
// (Lavish Meal)" — so every surface (sheet, trades, 🔍 inspect, hovercards)
// says what the thing IS with no per-surface work, and a custom name can
// never impersonate another item outright. A description-only custom keeps
// the base name with "(custom)" so Tag.name's @unique never collides with
// the base row itself.
export function customCraftName(baseName, name) {
  return name ? `${name} (${baseName})` : `${baseName} (custom)`;
}
