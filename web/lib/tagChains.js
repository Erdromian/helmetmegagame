// Tag.expiresInto / Tag.removesInto as a {tag:…} token string for ChipText to
// resolve — the same machinery a description goes through, which is why this
// needs no catalog of its own and keeps working wherever it is rendered.
// Entries are normalised to { oneOf: [...] } by db/lib/syncTags.js, so a bare
// slug is just a pick of one; several entries all land at once ("and"), while
// a multi-slug oneOf is a roll between them ("or").
//
// Lived inside TagChip.js until the sheet's rows and the turn forecast wanted
// the same string without the chip.
//
// `bySlug` is an optional map of the tags a surface was actually shipped. Pass
// one and a slug missing from it emits nothing, so a chain into a withheld tag
// is not named anyway via the app-wide {tag:…} provider ChipText resolves
// against. Leave it out and every slug in the chain is emitted.
export function chainTokens(chain, bySlug = null) {
  const entries = Array.isArray(chain) ? chain : null;
  if (!entries?.length) return null;
  return entries
    .map((entry) =>
      (entry?.oneOf ?? [])
        .filter((slug) => !bySlug || bySlug.has(slug))
        .map((slug) => `{tag:${slug}}`)
        .join(" or "),
    )
    .filter(Boolean)
    .join(" and ");
}
