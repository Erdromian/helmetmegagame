// Server-side re-export of the threat catalog, for the GM pages. NEVER import this, or
// db/lib/threats.js, from a client component: the file is CommonJS, so the bundler ships
// all of it — which seats are real, the briefs, the spawn names — to every browser that
// loads the page. The lobby and the wizard used to, and did exactly that. They get a
// yes/no and the blurb as props now, and the server builds the seat list.
// Named rather than `export *`: the target is CommonJS, so a star re-export warns on every build.
export {
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  PARTIES,
  partyOf,
  optInName,
  optInWhitelisted,
  WHITELISTED_OPT_IN_SLUGS,
  ANTAGONISTS,
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
  takeableAntagonistSlugs,
  ANTAGONIST_BLURB,
} from "@lifeweb/db/lib/threats";
