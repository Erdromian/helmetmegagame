// The Discord face of the bomb's keypad (docs/systemdocs/NUKE.md §3): the
// words and the button layout, as plain data, so the layout and the custom-id
// round trip are testable without discord.js. The bot turns the rows into
// ActionRowBuilders (bot/src/events/interactions/rooms.js).
//
// The db/lib/phoneKeypad.js trick: a Discord message holds no state of its
// own, so the digits pressed so far ride IN each button's custom id — the "5"
// on a pad reading 33 is `room:nuke:key:<roomId>:335` — and nothing is stored
// between presses. The eighth digit is checked by the server as it goes in
// (db/lib/nuke.js#nukeCheck), exactly as the web dialog does, and the green
// button carries the sequence so the press can check it again.
//
// Zero requires beyond nukeText, which has none.

const { NUKE_TEXT, NUKE_CODE_DIGITS } = require("./nukeText");

// Every bomb custom id starts "room:nuke:", and the plain open is exactly
// `room:nuke:<roomId>` — so interactionCreate.js must try each of these BEFORE
// the open prefix, or a key press reads as opening the pad again.
const NUKE_KEY_PREFIX = "room:nuke:key:";
const NUKE_PRESS_PREFIX = "room:nuke:press:";

const keyId = (prefix, roomId, digits = "") => `${prefix}${roomId}:${digits}`;

/**
 * `{ roomId, digits }` out of a keypad custom id, or null. The digits are
 * untrusted — anybody can send any custom id — so they are re-checked here and
 * again by the server.
 */
function parseKeyId(customId, prefix) {
  if (typeof customId !== "string" || !customId.startsWith(prefix)) return null;
  const rest = customId.slice(prefix.length).replace(/~\w+$/, "");
  const at = rest.lastIndexOf(":");
  const roomId = at < 0 ? rest : rest.slice(0, at);
  const digits = at < 0 ? "" : rest.slice(at + 1);
  if (!roomId || !new RegExp(`^[0-9]{0,${NUKE_CODE_DIGITS}}$`).test(digits)) return null;
  return { roomId, digits };
}

/**
 * The keypad message's words. `view` is db/lib/nuke.js#nukeView's answer;
 * `line` is what just happened, if anything.
 */
function panelText(view, digits = "", line = null) {
  const out = [];
  if (line) out.push(line);
  out.push(view?.gone ? NUKE_TEXT.gone : view?.armed ? `**${NUKE_TEXT.armedState}**` : NUKE_TEXT.safeState);
  if (view?.lockedOut) out.push(NUKE_TEXT.lockedOut);
  const shown = Array.from({ length: NUKE_CODE_DIGITS }, (_, i) => digits[i] ?? "·").join(" ");
  out.push(`\`${shown}\``);
  return out.join("\n");
}

/**
 * Five rows of buttons: 1–3, 4–6, 7–9, ⌫ 0 C, and the one button under the
 * pad. Each is `{ id, label, style, disabled }`, style one of "secondary" |
 * "success" | "danger". `green` is true once the server has said the eight
 * digits are the sequence; only then is the button live, and it is Discord's
 * green (Success). Custom ids are unique within the message by construction:
 * a digit key carries one more digit than the readout, ⌫ one fewer, C none,
 * and the button a prefix of its own.
 */
function keypadRows(roomId, view, digits = "", green = false) {
  const closed = !view?.ok || view.lockedOut || view.gone;
  const full = digits.length >= NUKE_CODE_DIGITS;
  const key = (d) => ({
    id: keyId(NUKE_KEY_PREFIX, roomId, full ? digits : digits + d),
    label: d,
    style: "secondary",
    disabled: closed || full,
  });
  const rows = [
    ["1", "2", "3"].map(key),
    ["4", "5", "6"].map(key),
    ["7", "8", "9"].map(key),
    [
      {
        id: keyId(NUKE_KEY_PREFIX, roomId, digits.slice(0, -1)),
        label: "⌫",
        style: "secondary",
        disabled: closed || digits.length === 0,
      },
      key("0"),
      {
        // "C" empties the pad; the `~c` keeps its id apart from ⌫ on a one-digit pad.
        id: `${keyId(NUKE_KEY_PREFIX, roomId, "")}~c`,
        label: "C",
        style: "secondary",
        disabled: closed || digits.length === 0,
      },
    ],
  ];
  // A full readout would make every digit key the same id as the readout
  // itself; they are disabled then, and given distinct ids anyway.
  if (full) {
    rows.slice(0, 3).forEach((row, r) => row.forEach((b, i) => (b.id = `${b.id}~${r * 3 + i}`)));
    rows[3][1].id = `${rows[3][1].id}~z`;
  }
  rows.push([
    {
      id: keyId(NUKE_PRESS_PREFIX, roomId, green ? digits : ""),
      label: view?.armed ? NUKE_TEXT.disarm : NUKE_TEXT.arm,
      style: green ? "success" : "secondary",
      disabled: closed || !green,
    },
  ]);
  return rows;
}

module.exports = {
  NUKE_KEY_PREFIX,
  NUKE_PRESS_PREFIX,
  keyId,
  parseKeyId,
  panelText,
  keypadRows,
};
