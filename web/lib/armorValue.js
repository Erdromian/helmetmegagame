// Re-export of db/lib/armorValue.js, in the shape web/lib/formatTagArmor.js
// established.
//
// The deep path avoids the @lifeweb/db barrel, which unconditionally requires
// @prisma/client and would leak node:fs into this "use client" bundle
// (InspectorColumn.js). It resolves because @lifeweb/db declares no
// `exports` map.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
export { combineArmor, armorWord } from "@lifeweb/db/lib/armorValue";
