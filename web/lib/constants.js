export const APPEARANCE_MAX_LENGTH = 400;

// The biggest picture a player may upload for their face. Lives here because
// BOTH sides need the same number: updateCharacterProfile refuses above it
// (that is the real gate), and AvatarField refuses above it before submitting,
// so an oversized photo is named in the field instead of being carried all the
// way to the server to die. Read the bodySizeLimit note in next.config.mjs
// before raising it — the action body limit has to stay above this.
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

// The browser shrinks a picture to this longest edge before posting it
// (lib/shrinkImage.js), so the bytes that actually travel are tens of KB and
// the cap above almost never comes into play. 1024 is 4x the 256 the server
// stores, which leaves the cover-crop real pixels to work from and leaves room
// if AVATAR_SIZE ever grows.
export const MAX_AVATAR_UPLOAD_EDGE = 1024;

// Below this, a picture already within MAX_AVATAR_UPLOAD_EDGE is posted
// untouched rather than re-encoded — there is nothing to win, and a lossy
// round-trip would only cost quality.
export const SHRINK_SKIP_BELOW_BYTES = 512 * 1024;

// The sanity cap, refused WITHOUT being decoded. Shrinking means a big photo is
// fine now, so the only thing left to refuse is something absurd — decoding a
// 2GB file would lock the tab up before any check could speak. Deliberately far
// above anything a camera produces.
export const MAX_AVATAR_PICK_BYTES = 50 * 1024 * 1024;

// One owner for the refusal sentence, because two caps now speak it — 50MB at
// pick time, 5MB for what reaches the server — and hard-coding "under 5MB" for
// a 60MB file would be a lie. Both the client field and the server action call
// this, so the wording cannot drift between them.
export function avatarTooBigMessage(bytes, limit = MAX_AVATAR_UPLOAD_BYTES) {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return `That image is ${mb}MB. It has to be under ${Math.round(limit / 1024 / 1024)}MB.`;
}

// Lives here rather than in lib/requests.js because RequestDialog is a client
// component: importing it from requests.js drags @lifeweb/db (and node:fs)
// into the browser bundle. Same reason lib/formatTagRequirement.js exists.
export const MAX_REASON_LENGTH = 500;

// Every GM-authored message that actually reaches Discord: a staged private
// message or public declaration on /gm/turns, the broadcast composer, the
// per-row composer, the /gm/messages reply, and the Dev Panel's message modal.
//
// One Discord message is 2000 characters. Everything above splits across
// several rather than failing — DMs through sendDm/postDmBatched, public
// declarations through postMessageBatched — all of it via chunkMessage
// (db/lib/chunkText.js), which breaks on blank lines. So this number is not
// Discord's limit; it is how much prose a GM may stage in one row before they
// should be splitting it themselves. 6000 is about three messages.
//
// It is NOT a truncation point. The composers show the count and refuse to
// stage over it, so a long paste is visible and trimmable rather than silently
// cut — which is exactly the bug the old client-side maxLength caused.
export const GM_MESSAGE_MAX_LENGTH = 6000;

// What a player may write to Bascinet from Chat in one go
// (web/app/(app)/chat/DmPane.js). Discord's own DM ceiling, so a message
// typed on either face is the same size.
export const PLAYER_DM_MAX_LENGTH = 2000;

// The Move Result box (Action.resultMessage) — GM-facing canon that is never
// sent to Discord, so it has no business sharing a Discord-shaped cap. Bounded
// only against a runaway paste; the column itself is unbounded.
export const RESULT_BOX_MAX_LENGTH = 12000;

// A player's private Journal entry (/notes) — generous, since it's a personal
// record rather than something read aloud, but capped so a runaway paste
// can't bloat a single row indefinitely.
export const JOURNAL_TITLE_MAX_LENGTH = 120;
export const JOURNAL_BODY_MAX_LENGTH = 8000;
export const JOURNAL_LABEL_MAX_LENGTH = 24;
export const JOURNAL_MAX_LABELS = 8;

// What carving a headstone costs (docs/systemdocs/CORPSES.md). MIRRORS
// db/lib/constants.js#ENGRAVE_RESOURCE_COST rather than importing it — the
// Engrave dialog is a client component, and the house rule here is that a
// "use client" module never reaches into @lifeweb/db for a value. The server
// action charges the db/ copy; this one only puts the number in the sentence.
// Change both together.
export const ENGRAVE_RESOURCE_COST = 4;
