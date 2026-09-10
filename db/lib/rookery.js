// The Rookery: what a building does to the Bird's daily allowance.
//
// The Bird gives one letter an in-game DAY (BIRD.md), claimed on
// Character.birdTurnId. A Rookery standing where the sender is raises that
// allowance — `placement.birdSendsPerDay` in docs/tags.yaml — and puts a
// three-minute wall clock between flights instead.
//
// WHY THE ALLOWANCE IS RAISED RATHER THAN REMOVED. The Bird's whole shape is
// a guess: you name the zone you think somebody is in, and a wrong guess is
// told to you a turn later. requestActions.js is explicit that a miss does not
// cost the letter — "THE LETTER ONLY LEAVES YOUR HANDS IF IT ARRIVES" — so the
// once-a-day claim is the ENTIRE price of guessing wrong. Take it away and a
// miss costs nothing at all, which turns the guess into a search: six
// bird-reachable zones, three minutes apart, and anybody can be found inside
// twenty minutes. Six flights a day is deliberately the same six: a Rookery
// holder CAN find one person in a day, by spending every flight they have on
// it and writing to nobody.
//
// The cooldown is a DateTime column rather than the in-memory Map /shout keeps
// (bot/src/events/interactionCreate.js). Two reasons, and both are why the
// bell uses a column too: a bot restart must not hand somebody a free flight,
// and the Bird is sent from the WEB face, which cannot see the bot's memory at
// all.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { placementOf, WORKING_STATUSES } = require("./structures");

// Three minutes between flights. Short enough that "many messages" is true,
// long enough that the allowance is spent deliberately rather than in one
// burst. Hardcoded for the db/lib/roleIds.js reason: one right answer, and a
// missing env var would have been a silent no-op.
const ROOKERY_COOLDOWN_MS = 3 * 60_000;

// What the Bird is worth with no building involved. One a day is the feature
// as BIRD.md describes it, and every character without a rookery in reach
// keeps exactly that.
const BASE_BIRD_SENDS_PER_DAY = 1;

// The allowance the structures standing here are worth. Biggest wins rather
// than summing — the same best-per-kind posture laborAccess.js#structureTools
// keeps, so two rookeries are not twice a rookery. Returns the BASE when
// nothing here raises it.
//
// `structures` are rows from db/lib/structures.js#structuresAt, already
// carrying their catalog type as `.type`.
function birdAllowanceFrom(structures) {
  let best = BASE_BIRD_SENDS_PER_DAY;
  for (const s of structures ?? []) {
    // WORKING_STATUSES, not COMPLETE alone: a damaged rookery is still a
    // tower full of birds. Nothing about a bird needs the roof mended.
    if (!WORKING_STATUSES.includes(s.status)) continue;
    const n = s.placement?.birdSendsPerDay ?? placementOf(s.type)?.birdSendsPerDay;
    if (Number.isInteger(n) && n > best) best = n;
  }
  return best;
}

// Null until they have sent one. Returns { ok } or { ok: false, secondsLeft,
// readyAt }, the bellCooldown shape — `readyAt` is a unix second so the caller
// can hand Discord a live <t:…:R> rather than pre-formatting a wait that is
// wrong by the time it is read (db/lib/discordMarkup.js).
function rookeryCooldown(birdLastSentAt, now = Date.now()) {
  if (!birdLastSentAt) return { ok: true, secondsLeft: 0, readyAt: null };
  const readyMs = new Date(birdLastSentAt).getTime() + ROOKERY_COOLDOWN_MS;
  const remaining = readyMs - now;
  if (remaining <= 0) return { ok: true, secondsLeft: 0, readyAt: null };
  return {
    ok: false,
    secondsLeft: Math.ceil(remaining / 1000),
    readyAt: Math.ceil(readyMs / 1000),
  };
}

module.exports = {
  ROOKERY_COOLDOWN_MS,
  BASE_BIRD_SENDS_PER_DAY,
  birdAllowanceFrom,
  rookeryCooldown,
};
