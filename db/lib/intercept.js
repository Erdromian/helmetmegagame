// LAYING IN WAIT (docs/systemdocs/INTERCEPT.md).
//
// You set a watch — a mode, a line to say, and who you are watching for — and
// when one of them walks in where you are standing they are stopped and handed
// your words. A Safe intercept holds them two minutes. An Ambush holds them
// until the turn ends, or until you let them go.
//
// This is the only module that knows what a watch is, the db/lib/escort.js
// posture. It takes `db` as a parameter and is deliberately NOT on the
// @lifeweb/db barrel (the db/lib/dm.js convention); require it by path.
//
// IT SENDS NOTHING. fireWatches returns DM descriptors the way the Caving Die
// returns `cavingDm`, and the caller sends them after its transaction commits
// — no network call may run inside a $transaction (ARCHITECTURE.md §5).
//
// THE HOLD IS DERIVED, and that is the whole reason this feature needs no
// cron, no turn pass and no rows to sweep. Character.heldUntil is a plain
// timestamp: past it, you are free, and nothing had to notice. It is the
// keyed-way pattern (MAP.md §2b) applied to a person instead of a door. An
// Ambush gets db/lib/turnClock.js#turnEndsAt for its timestamp, so the turn
// advance releases everybody for free.
//
// A hold takes MOVEMENT and nothing else. It is deliberately not an
// incapacitating tag (db/lib/incapacitation.js): those take ACT as well, and a
// person somebody is holding at knifepoint is meant to be able to talk, fight
// back and file a Gambit of their own. That is the whole shape of the thing —
// an ambush is a standoff, not a paralysis.
const { presentedIdentity, CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");
const { withArticle } = require("./concealedIdentity");
const { matchesTypedName } = require("./characterName");
const { blockerFor, ACT } = require("./incapacitation");
const { turnEndsAt } = require("./turnClock");
const { reFor } = require("./discordMarkup");
const { DM_KIND } = require("./dmKinds");
const { DM_ACTION, dmAction } = require("./dmActions");

// Two minutes, Bascinet's number. Long enough to say something and be
// answered, short enough that walking into a checkpoint is not a punishment.
const SAFE_HOLD_MS = 2 * 60 * 1000;

// What a watch may carry. The name cap is FULL_NAME_LIMIT's business; this is
// how MANY, and it is a sanity bound rather than a design statement — a
// player who wants to watch for more than this wants "Any person".
const MAX_NAMES = 12;
const MESSAGE_LIMIT = 300;

// The Release button on the ambusher's own DM. The prefix lives here, beside
// the row builder, so the sender and the answerer cannot drift — the
// db/lib/locationAnchorRow.js#keyedPromptRow precedent.
const INTERCEPT_RELEASE_PREFIX = "icept:release:";

function interceptReleaseRow(targetId, label) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `${INTERCEPT_RELEASE_PREFIX}${targetId}`, label: label.slice(0, 80) },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// The message a player typed
// ---------------------------------------------------------------------------

// Capped and de-pinged at SAVE time, never at send. Sanitizing here means the
// stored row, the DirectMessage row, /gm/messages, the player's own web thread
// and the Discord send are all clean from one place; doing it at send would
// leave the logged copy carrying the ping, and web/app/components/
// remarkDiscord.js renders that token on the web too.
//
// Only the broadcast pings go. <@id>, <#id> and <t:…> are the sanctioned
// vocabulary db/test/discordMarkup.test.js pins, and they render correctly on
// both faces — stripping them would be stripping the language.
function cleanMessage(text) {
  return (text ?? "")
    .toString()
    .replace(reFor("ping"), (m) => m.slice(1))
    .trim()
    .slice(0, MESSAGE_LIMIT);
}

function cleanNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = (raw ?? "").toString().trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The hold
// ---------------------------------------------------------------------------

// PURE. `character` needs heldUntil only. Returns the refusal sentence, or
// null when they may walk. Every surface that draws a way out reads this, and
// so does the one gate in db/lib/locationTravel.js#performLocationMove, so a
// picker and the mover can never disagree about whether somebody is held.
function heldReasonFor(character, now = new Date()) {
  const until = character?.heldUntil ? new Date(character.heldUntil) : null;
  if (!until || until.getTime() <= now.getTime()) return null;
  const seconds = Math.ceil((until.getTime() - now.getTime()) / 1000);
  // Under five minutes it is worth counting down; a hold that runs to the end
  // of the turn is not, and saying "43188s" would be worse than saying nothing.
  return seconds <= 300
    ? `Somebody has hold of you. You can't move for another ${seconds}s. ‡`
    : "Somebody has hold of you. You can't move until the end of the turn. ‡";
}

// The one write that ends a hold early, and the three callers that use it: the
// holder's Release button on the web, the same button in their DM, and the
// holder walking away or dying. Conditional on `heldById` so nobody can free
// somebody else's prisoner, and so a hold that has already lapsed or been
// handed on is not clobbered.
async function releaseHeldBy(db, holderId, { targetId = null } = {}) {
  const where = { heldById: holderId, heldUntil: { gt: new Date() } };
  if (targetId) where.id = targetId;
  const freed = await db.character.findMany({
    where,
    select: { id: true, name: true, discordUserId: true, status: true },
  });
  if (freed.length === 0) return [];
  await db.character.updateMany({
    where: { id: { in: freed.map((c) => c.id) } },
    data: { heldUntil: null, heldById: null },
  });
  return freed;
}

// ---------------------------------------------------------------------------
// Who a watch catches
// ---------------------------------------------------------------------------

// A HOOD BEATS A NAME, and this is the line that makes it true.
//
// A typed name is matched against the identity the room would SEE, never
// against the row. So a hooded Greeblus reads as "a young man" and no watch
// naming him reaches him — which is what the "any concealed person" option is
// for. Without this rule Intercept would be a hood-defeating radar: a watch
// costing nothing would tell you Greeblus is here AND that he is hiding it,
// which is precisely what the hood is bought to prevent. A forced name (Apex
// Form's "Beast") is not matchable either, and for the same reason.
//
// `presented` is presentedIdentity()'s result for the arrival.
function matchesArrival(watch, arrival, presented) {
  if (!watch) return null;
  if (watch.anyPerson) return "anyPerson";
  if (presented?.concealed || presented?.forced) {
    return watch.anyConcealed && presented.concealed ? "anyConcealed" : null;
  }
  const typed = (watch.targetNames ?? []).find((name) => matchesTypedName(arrival, name));
  return typed ? "name" : null;
}

// What the room saw. "Lord Greeblus", or "a young man" for anybody hiding it.
// Both directions of every Intercept DM go through this, which is what stops
// the confirmation DM being the unmasking tool matchesArrival just closed.
function seenAs(presented) {
  if (!presented) return "somebody";
  return presented.concealed ? withArticle(presented.name.toLowerCase()) : presented.name;
}

// "He said" / "She said" / "They said". Bascinet's line is "He said", which is
// wrong for half the cast; the shape is theirs, the agreement is arithmetic.
// Straight off Character.gender, the same column concealedIdentity.js reads.
function saidWord(character) {
  if (character?.gender === "MAN") return "He said";
  if (character?.gender === "WOMAN") return "She said";
  return "They said";
}

// Everything presentedIdentity needs, for a character loaded fresh.
const IDENTITY_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  age: true,
  gender: true,
  concealed: true,
  status: true,
  locationId: true,
  discordUserId: true,
  updatedAt: true,
  tags: {
    where: { quantity: { gt: 0 } },
    select: { equipped: true, tag: { select: { ...CONCEALMENT_TAG_FIELDS, slug: true, forcedName: true } } },
  },
};

// IDENTITY_SELECT already filters the held tags to quantity > 0, so both
// helpers see exactly what the character has on them.
function identityOf(row) {
  const tags = row?.tags ?? [];
  return presentedIdentity(row, { forcedName: forcedNameFrom(tags), concealment: concealmentFrom(tags) });
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

// Called once by db/lib/locationTravel.js#performLocationMove with everyone
// who just arrived — the mover first, then their whole escort party, which is
// what makes "if several people come up together, all of them get stopped"
// free rather than a feature of its own.
//
// Runs AFTER the move's transaction commits, and does its own small
// transactions per catch. Returns DM descriptors; sends nothing.
async function fireWatches(db, { arrivals, locationId, openTurn }) {
  const dms = [];
  if (!locationId || !openTurn || !Array.isArray(arrivals) || arrivals.length === 0) return { dms, hits: [] };

  const arrivalIds = new Set(arrivals.map((a) => a.id).filter(Boolean));

  // Everybody laying in wait here, with what a watch needs to be allowed to
  // fire at all. Loaded once for the whole party.
  const watches = await db.interceptWatch.findMany({
    where: {
      character: { locationId, status: "ALIVE" },
      OR: [{ anyPerson: true }, { anyConcealed: true }, { NOT: { targetNames: { isEmpty: true } } }],
    },
    include: { character: { select: IDENTITY_SELECT } },
  });

  const live = watches.filter((w) => {
    // You cannot lay in wait while you are walking. A watcher who arrived in
    // the same party as their quarry has been on the road all day, not
    // standing in it — and catching the person you travelled with would be a
    // trick nobody meant to build.
    if (arrivalIds.has(w.characterId)) return false;
    // Dying, bound, catatonic, crucified: none of them stop a stranger walking
    // past. The watch row survives — it is a standing preference, like an
    // escort consent, and it works again the moment they can act.
    return !blockerFor(w.character.tags, ACT);
  });
  if (live.length === 0) return { dms, hits: [] };

  const now = new Date();
  // An Ambush runs to the end of the turn. Never SHORTER than a Safe stop,
  // though: turnEndsAt is the boundary after the turn STARTED, so a turn the
  // cron has not closed on time — paused, or opened by hand — would otherwise
  // put the deadline in the past and an ambush would hold nobody at all.
  const boundary = turnEndsAt(openTurn);
  const floor = new Date(now.getTime() + SAFE_HOLD_MS);
  const turnEnd = boundary && boundary > floor ? boundary : floor;
  const hits = [];

  for (const arrival of arrivals) {
    const row = await db.character.findUnique({ where: { id: arrival.id }, select: IDENTITY_SELECT });
    if (!row || row.status !== "ALIVE") continue;
    // They may have walked straight on again, or been walked on by somebody
    // else, between the move committing and this running.
    if (row.locationId !== locationId) continue;
    const presented = identityOf(row);

    for (const watch of live) {
      const matchedBy = matchesArrival(watch, row, presented);
      if (!matchedBy) continue;

      // THE RATION, and the insert IS the enforcement. Without it a lapsed
      // two-minute hold is walked straight back into, and a Safe watch on a
      // busy road becomes an endless roadblock and an endless DM feed. A
      // unique violation means this watch already caught this person this
      // turn, which is not an error — it is the rule working.
      try {
        await db.interceptHit.create({
          data: { watchId: watch.id, targetCharacterId: row.id, turnId: openTurn.id },
        });
      } catch (err) {
        if (err?.code === "P2002") continue;
        throw err;
      }

      const ambush = watch.mode === "AMBUSH";
      const until = ambush ? turnEnd : new Date(now.getTime() + SAFE_HOLD_MS);
      hits.push({ watch, interceptor: watch.character, target: row, presented, matchedBy, ambush, until });

      // The record a GM reads on /gm/audit. turnId is set because the once-
      // per-turn rule is turn-scoped and a row without it is unreadable as a
      // record of that rule — though the rule is ENFORCED by the unique above,
      // never by counting these (REQUESTS.md §1a). `presented` and not the
      // real name: the audit log is not a place to unmask somebody the game
      // just refused to unmask.
      await db.auditLog
        .create({
          data: {
            actorDiscordUserId: watch.character.discordUserId ?? null,
            actionType: "request_intercept_fired",
            targetCharacterId: row.id,
            turnId: openTurn.id,
            details: { mode: watch.mode, matchedBy, presented: presented.name, locationId },
          },
        })
        .catch((err) => console.error(`Intercept: audit row failed for ${row.id}:`, err.message ?? err));
    }
  }

  if (hits.length === 0) return { dms, hits: [] };

  // ONE hold per person, however many people caught them: the longest wins, so
  // an Ambush always beats a Safe stop and a second Safe stop cannot shorten
  // the first. Conditional on the clock, so a hold already running longer than
  // this one is left exactly where it is.
  const longest = new Map();
  for (const hit of hits) {
    const best = longest.get(hit.target.id);
    if (!best || (hit.until && hit.until > best.until)) longest.set(hit.target.id, hit);
  }
  for (const hit of longest.values()) {
    if (!hit.until) continue;
    await db.character.updateMany({
      where: { id: hit.target.id, OR: [{ heldUntil: null }, { heldUntil: { lt: hit.until } }] },
      data: { heldUntil: hit.until, heldById: hit.interceptor.id },
    });
  }

  // The victim hears from each of them. Three guards at the gate is three
  // lines, because walking into three people is what happened.
  for (const hit of hits) {
    if (!hit.target.discordUserId) continue;
    const stopper = seenAs(identityOf(hit.interceptor));
    if (hit.ambush) {
      dms.push({
        discordUserId: hit.target.discordUserId,
        content: [
          "You were stopped on the road. It's an ambush! You can't move until the end of the turn. Make a Gambit declaring your intent!",
          ...(hit.watch.message ? [`» ${hit.watch.message}`] : []),
        ].join("\n"),
        kind: hit.watch.message ? DM_KIND.CONVERSATION : DM_KIND.NOTICE,
        authorDiscordUserId: hit.watch.message ? hit.interceptor.discordUserId ?? null : null,
      });
    } else {
      dms.push({
        discordUserId: hit.target.discordUserId,
        content: [
          `You were stopped on the road by ${stopper}. ${saidWord(hit.interceptor)}:`,
          `» ${hit.watch.message || "…"}`,
          "You can't move for two minutes.",
        ].join("\n"),
        // A person composed those words for this reader, which is the whole
        // definition of a CONVERSATION (db/lib/dmKinds.js) — it sorts the GM
        // inbox and counts as unread. Everything else Intercept sends is the
        // game talking.
        kind: DM_KIND.CONVERSATION,
        authorDiscordUserId: hit.interceptor.discordUserId ?? null,
      });
    }
  }

  // And the interceptor hears what they caught. A Safe watch reports its whole
  // haul in one line; an Ambush is one DM each, because each carries a Release
  // button and a button answers about exactly one person
  // (db/lib/dmActions.js#dmAction).
  const byInterceptor = new Map();
  for (const hit of hits) {
    if (!byInterceptor.has(hit.interceptor.id)) byInterceptor.set(hit.interceptor.id, []);
    byInterceptor.get(hit.interceptor.id).push(hit);
  }
  for (const group of byInterceptor.values()) {
    const who = group[0].interceptor;
    if (!who.discordUserId) continue;
    const safe = group.filter((h) => !h.ambush);
    if (safe.length > 0) {
      dms.push({
        discordUserId: who.discordUserId,
        content: `You successfully intercepted ${safe.map((h) => seenAs(h.presented)).join(", ")}.`,
        kind: DM_KIND.NOTICE,
      });
    }
    for (const hit of group.filter((h) => h.ambush)) {
      const name = seenAs(hit.presented);
      dms.push({
        discordUserId: who.discordUserId,
        content: `You successfully ambushed ${name}.`,
        kind: DM_KIND.NOTICE,
        components: interceptReleaseRow(hit.target.id, `Release ${name}`),
        meta: dmAction(DM_ACTION.INTERCEPT_HOLD, hit.target.id),
      });
    }
  }

  return { dms, hits };
}

module.exports = {
  SAFE_HOLD_MS,
  MAX_NAMES,
  MESSAGE_LIMIT,
  INTERCEPT_RELEASE_PREFIX,
  interceptReleaseRow,
  cleanMessage,
  cleanNames,
  heldReasonFor,
  releaseHeldBy,
  matchesArrival,
  seenAs,
  saidWord,
  IDENTITY_SELECT,
  identityOf,
  fireWatches,
};
