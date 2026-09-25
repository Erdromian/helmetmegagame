// What the visual world holds, named once so the seed (seed.mjs) that writes
// it and the spec (pages.spec.mjs) that signs in as it can never disagree.
//
// Every Discord id here starts with VISUAL_PREFIX, which is how the seed
// finds its own rows to remove and how nothing here could ever be mistaken
// for a real snowflake (those are 17–20 digits).

export const VISUAL_PREFIX = "visual-";

// Never the shared local db: goldens have to come from a world nobody else
// is clicking around in. setup.mjs builds this one; the Playwright config,
// the seed and the spec all open it and nothing else.
// The OS user is named in the URL because a bare localhost URL fails with
// Prisma's P1010 on a Postgres.app install, where that user is the owner.
export const VISUAL_DATABASE_URL =
  process.env.VISUAL_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@localhost:5432/bascinet_visual`;

// The moment every page is frozen at, in the page's own Date: a Thursday
// afternoon, 3:00 PM in Chicago (db/lib/turnClock.js's one clock). The open
// turn below ends the next morning, so the lock chip has hours left to show
// rather than a deadline already past.
export const FROZEN_NOW = new Date("2026-09-24T20:00:00Z");

export const TURN = {
  number: 3,
  dayNumber: 3,
  turnLengthHours: 24,
  startedAt: new Date("2026-09-24T14:00:00Z"), // 9:00 AM Chicago
  endsAt: new Date("2026-09-25T14:00:00Z"),
  banner: "The bell rang twice at dawn and nobody has said why.",
};

export const GAME_STARTED_AT = new Date("2026-09-22T14:00:00Z");

// Three people, three shapes of screen: the fullest sheet, the barest sheet,
// and a body. The dead one is unburied on purpose — that is the curse screen
// (db/lib/curse.js), the one a player sees most often after a death.
export const CHARACTERS = {
  full: {
    discordUserId: `${VISUAL_PREFIX}1`,
    firstName: "Vesna",
    lastName: "Hollow",
    gender: "WOMAN",
    age: 34,
    status: "ALIVE",
    zone: "town",
    location: "town-2", // the Square
    role: "mercenary",
    appearance: "Broad-shouldered, a scar through one eyebrow, hair cropped close. Smells of lamp oil.",
    tagPoints: 3,
    mood: 10,
    hungerValue: 80,
    obols: 120,
    // Filtered against the catalog at seed time; a slug the YAML no longer
    // has is skipped with a note rather than failing the build.
    tags: [
      { slug: "dagger", equipped: true },
      { slug: "mail-shirt", equipped: true },
      { slug: "hood" },
      { slug: "pickaxe" },
      { slug: "rope" },
      { slug: "paper", quantity: 3 },
      { slug: "ration-box" },
      { slug: "literacy" },
      { slug: "brave" },
      { slug: "strong" },
      { slug: "tough" },
      { slug: "rough-camper" },
    ],
  },
  bare: {
    discordUserId: `${VISUAL_PREFIX}2`,
    firstName: "Maud",
    lastName: "Kettering",
    gender: "WOMAN",
    age: 61,
    status: "ALIVE",
    zone: "fortress",
    location: "fortress-3", // the Court
    role: "migrant",
    appearance: "",
    tagPoints: 0,
    mood: 0,
    hungerValue: 100,
    obols: null, // no account opened
    tags: [],
  },
  dead: {
    discordUserId: `${VISUAL_PREFIX}3`,
    firstName: "Orrin",
    lastName: "Blackwell",
    gender: "MAN",
    age: 47,
    status: "DEAD",
    deathTurn: 2,
    zone: "town",
    location: "town-4", // the Cathedral
    role: "chaplain",
    appearance: "Was tall.",
    tagPoints: 0,
    mood: 0,
    hungerValue: 100,
    obols: null,
    tags: [],
  },
};

export const GM_ACTOR = `${VISUAL_PREFIX}gm`;

// The desk needs something to show. Two audit rows of different types on
// different targets (enough for /gm/audit's filters), and one short DM
// thread so /gm/players has a conversation to preview.
export const AUDIT_ROWS = [
  {
    actionType: "gm_transfer_resources",
    target: "full",
    details: { amount: 10 },
    createdAt: new Date("2026-09-23T15:12:00Z"),
  },
  {
    actionType: "gm_character_killed",
    target: "dead",
    details: {},
    createdAt: new Date("2026-09-23T21:40:00Z"),
  },
];

export const DM_THREAD = [
  {
    to: "full",
    direction: "OUTBOUND",
    kind: "NOTICE",
    content: "You are the Mercenary. You wake in the Square with a dagger and a debt.",
    createdAt: new Date("2026-09-22T14:05:00Z"),
  },
  {
    to: "full",
    direction: "INBOUND",
    kind: "CONVERSATION",
    content: "Can I move before the bell, or does the gate stay shut until dawn?",
    createdAt: new Date("2026-09-24T16:20:00Z"),
  },
  {
    to: "full",
    direction: "OUTBOUND",
    kind: "CONVERSATION",
    author: GM_ACTOR,
    content: "The gate opens at dawn. Anything before that is a Gambit.",
    createdAt: new Date("2026-09-24T16:31:00Z"),
  },
];
