// Re-export of db/lib/fightingSkill.js, in the shape web/lib/armorValue.js
// established.
//
// The deep path avoids the @lifeweb/db barrel, which unconditionally requires
// @prisma/client and would leak node:fs into a "use client" bundle
// (InspectorColumn.js, LedgerBand.js). It resolves because @lifeweb/db
// declares no `exports` map.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
export { fightingSkill, fightingWord, formatFightingSkill, TREES } from "@lifeweb/db/lib/fightingSkill";
