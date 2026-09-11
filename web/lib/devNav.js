// The Dev Panel's destinations, in one list.
//
// There are two shells under /gm/dev and they each need a nav: the desk-shaped
// panel itself (web/app/(desk)/gm/dev/OpsNav.js, a vertical rail of sections)
// and the three PageShell sub-pages that hang off it —  Characters, Factions,
// Tags — which wear a horizontal row in their AppHeader
// (web/app/(app)/gm/dev/DevSubNav.js). Two shells is a layout fact, not a
// choice: they are in different route groups and the rail would look wrong in
// a page header.
//
// What was NOT a fact is that each of them kept its own hand-written copy of
// where the other one lives, so a fourth sub-page (or a rename) meant editing
// two files and, in practice, forgetting one. This is the list; both render it.
//
// `panel` is the Dev Panel itself. OpsNav drops it — from inside the panel it
// is not somewhere to go — and DevSubNav keeps it as the way back.
export const DEV_PAGES = [
  { key: "panel", href: "/gm/dev", label: "Dev Panel" },
  { key: "characters", href: "/gm/dev/characters", label: "Characters" },
  { key: "factions", href: "/gm/dev/factions", label: "Factions" },
  { key: "tags", href: "/gm/dev/tags", label: "Tags" },
];

// What OpsNav's fourth group offers: everywhere but the panel you are on.
export const DEV_ELSEWHERE = DEV_PAGES.filter((p) => p.key !== "panel");
