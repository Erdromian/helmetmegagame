// What kind of thing a DirectMessage IS, as opposed to what it is ABOUT.
//
// `source` (the other column) says what produced a row — "gm_letter",
// "staged_push", "mention" — and drives how it is DRAWN. This says how much
// weight it carries in the GM inbox, and it is the only thing the desk's
// queries look at.
//
// The two are deliberately orthogonal. A mention relay is a NOTICE that still
// draws as a mention; a letter is a NOTICE that still draws as a letter.
//
// **NOTICE is the default in all three sendDm functions.** That is the whole
// point of this file. The classification used to be an optional `source`
// string whose absence read as "a human wrote this", so every new DM anybody
// added landed in the GM inbox looking like mail until somebody remembered to
// tag it. Roughly seven call sites in eight are notices, so the rare case is
// the one that opts in now, and a forgotten `kind` is quiet rather than loud.
//
// No requires in this file, ever. It is imported by a client component
// (web/app/components/DmThread.js), and one require of @lifeweb/db here would
// drag PrismaClient into the browser bundle and kill the route with a
// node:fs error carrying no digest.
const DM_KIND = {
  // A human composed these words for this reader: a GM's reply, /dm, a
  // broadcast, a staged turn result, a player writing in. Sorts the inbox,
  // sets the preview, counts as unread.
  CONVERSATION: "CONVERSATION",

  // The game said it: a seat assignment, a letter arriving, hunger, a travel
  // outcome, an offer, a caving roll. Invisible to the rail — it can never
  // put a player in the inbox or move one up it — and a quiet grey line in
  // the thread itself.
  NOTICE: "NOTICE",

  // Pure plumbing: an inspect embed, the edit-flow prompt, proxy hand-back, a
  // reaction refusal. Logged so the record is complete, never rendered on
  // either face.
  QUIET: "QUIET",
};

// The two `source` values a renderer still branches on, beside their kind.
// They live here rather than in web/ because this is the one DM module both
// packages AND the browser bundle can read — which is what lets DmThread.js
// stop keeping its own hand-synced copies of these strings.
//
// A letter (db/lib/bird.js, which re-exports these): drawn as a piece of
// paper rather than as chat. Both halves are NOTICE except the reply, which
// is CONVERSATION — a GM wrote the letter and this is the answer to it.
const GM_LETTER_SOURCE = "gm_letter";
const GM_LETTER_REPLY_SOURCE = "gm_letter_reply";

// A player-to-player letter, carried by the Bird. Same treatment: it is the
// arrival of an object, so it draws as one row rather than collapsing into
// "3 automated messages" the way an ordinary notice does. Three letters
// landing on the same day are three things that happened, not noise.
const BIRD_SOURCE = "bird";

// A mention relay — "You were mentioned in X". A NOTICE like any other line
// the game speaks, and the one notice the two chairs disagree about: the GM
// desk hides it (a ping is not a conversation with a GM), the player's Chat
// pane shows it (a ping is about you, and on Discord the DM is right there).
// So it needs a source the query can name, on top of its kind. The row's meta
// carries { placeKey, where } so the pane can open the place it happened in.
const MENTION_SOURCE = "mention";

module.exports = {
  DM_KIND,
  GM_LETTER_SOURCE,
  GM_LETTER_REPLY_SOURCE,
  BIRD_SOURCE,
  MENTION_SOURCE,
};
