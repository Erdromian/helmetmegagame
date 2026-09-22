// The Grimoire's body (docs/systemdocs/THANATI.md), composed server-side from the rite catalog and
// this game's rolled Words of the Circle. The `{grimoire}` marker in docs/documents.yaml means the
// YAML never carries generated prose. The word rides in a {word:} token to render as a chip.
//
// A rite flagged `revealedByObjectives` (the Rite of Ascension) is LEFT OUT of the string entirely
// until the cult has finished its objectives — not greyed, not stubbed, not sent with a flag for the
// client to hide. The composition happens here, on the server, and only the finished `description`
// reaches the browser, so a rite that is not in the string is a rite whose ingredients, chanter count
// and Word of the Circle were never sent to anybody. That is the whole hiding mechanism; keep it that
// way rather than filtering in a component.
import { RITES } from "@lifeweb/db/lib/rites";

export const GRIMOIRE_DOCUMENT_KEY = "grimoire";
const GRIMOIRE_MARKER = "{grimoire}";

// `revealed` is `GameState.ascensionRevealedTurn != null`, resolved by the caller. It defaults to
// false so a caller that forgets it hides the rite rather than leaking it.
export function grimoireBody(words = {}, { revealed = false } = {}) {
  return RITES.filter((rite) => revealed || !rite.revealedByObjectives)
    .map((rite) => {
      const head = [
        `**${rite.name}**`,
        `Minimum cultists: ${rite.minChanters}`,
        rite.ingredientsText ? `Ingredients: ${rite.ingredientsText}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      const phrase = words[rite.key] ?? "…";
      return `${head}  \n${rite.description}  \n_Word of the Circle:_ {word:${phrase}}`;
    })
    .join("\n\n");
}

export function expandGrimoire(document, words, { revealed = false } = {}) {
  if (document?.key !== GRIMOIRE_DOCUMENT_KEY) return document;
  if (document.description.trim() !== GRIMOIRE_MARKER) return document;
  return { ...document, description: grimoireBody(words, { revealed }) };
}
