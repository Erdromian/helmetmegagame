// The house format for an ephemeral reply — the short line the bot shows only
// to the player who clicked. A refusal, a confirmation, "You're not here."
//
// It is a chevron and italics: `» *You're not here.*`. The chevron is the same
// mark every restated line in the game wears, and the italics say the game is
// answering you rather than talking to the room.
//
// Before this existed, of 158 `respond()` call sites about 101 wrote the
// chevron and italics by hand and the rest did not — three whole modules
// (the noticeboard, room storage, the bird's reply) answered in bare prose,
// and the refusal strings coming out of `db/lib` are bare by nature, because
// that layer is shared with the web and cannot carry a Discord chevron. Two
// lines had a chevron and no italics, and two opened an italic span and never
// closed it. Same kind of message, several voices.
//
// So `respond()` puts every one of them through here and the call sites go
// back to writing plain sentences. This is `ambientLine.js` for the other half
// of the bot's voice: that one is what the WORLD says into a channel, this one
// is what the game says back to one person.
//
// It sits in `bot/` rather than `db/lib/` because it is Discord-only policy.
// An ephemeral reply exists because an interaction must be acknowledged in
// three seconds and cannot exceed 2000 characters; the web has no counterpart
// and must never import this.

// Each skip below is a case that actually exists, not a hypothetical.
function ephemeralLine(content, { components } = {}) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) return content;

  // A multi-line reply is a READOUT, not a notice — Examine, "Who's here?",
  // "Secret rooms?", the Move confirmation, the noticeboard. Those already
  // carry their own shape (a header line, bold labels, `-#` lines under it),
  // and italicising a whole list flattens it.
  if (text.includes("\n")) return content;

  // A line above a picker is a PROMPT, not a notice: "Where?", "Move to
  // **X**?", "Clear what from **X**?" all read wrong behind a chevron. An
  // EMPTY `components` array is the opposite — that is a handler taking the
  // buttons off a message it is answering, so those still get the format.
  if (Array.isArray(components) && components.length > 0) return content;

  // Already formatted. Idempotent, so a call site that still writes its own
  // chevron is left exactly as it is rather than double-marked.
  if (text.startsWith("»")) return content;

  // `-#` is subtext, a quieter register than this one. `formatStashLine`
  // returns one, and it arrives here through the room Storage button.
  if (text.startsWith("-#")) return content;

  // Already carrying markdown of its own at the head. `whosHereLines` returns
  // `**Here:** …`, one line when nobody is concealed and two when somebody is,
  // and `» ***Here:**` puts three asterisks in front of Discord's parser. The
  // blank-paper line (`*Blank paper.*`) is the other shape: wrapping italics
  // in italics reads as BOLD, which says the opposite of quiet.
  if (text.startsWith("*")) return content;

  return `» *${text}*`;
}

module.exports = { ephemeralLine };
