// The Discord face of the telephone's keypad (docs/systemdocs/PHONES.md §3):
// the words and the button layout, as plain data, so the layout and the
// custom-id round trip are testable without discord.js. The bot turns the
// rows into ActionRowBuilders (bot/src/events/interactions/rooms.js).
//
// A Discord message holds no state of its own, so the digits typed so far ride
// IN each button's custom id: the "5" button on a keypad reading 33 is
// `room:phone:key:<roomId>:335`, and pressing it redraws the keypad from that.
// Nothing is stored between presses, and a keypad left open in two places
// cannot disagree about anything but what its own reader has typed.
//
// Zero requires beyond phoneText, which has none — the web never loads this,
// but it should stay as cheap as the text it draws.

const { PHONE_TEXT, PHONE_DIGITS, PHONE_COST } = require("./phoneText");

// Every telephone custom id starts "room:phone:", and the plain open is
// exactly `room:phone:<roomId>` — so interactionCreate.js must try each of
// these BEFORE the open prefix, or a key press reads as picking the phone up.
const PHONE_KEY_PREFIX = "room:phone:key:";
const PHONE_CALL_PREFIX = "room:phone:call:";
const PHONE_ANSWER_PREFIX = "room:phone:answer:";
const PHONE_HANGUP_PREFIX = "room:phone:hangup:";
const PHONE_WALK_PREFIX = "room:phone:walk:";
const PHONE_COIN_PREFIX = "room:phone:coin:";

const keyId = (prefix, roomId, digits = "") => `${prefix}${roomId}:${digits}`;

/**
 * `{ roomId, digits }` out of a keypad custom id, or null. The digits are
 * untrusted — anybody can send any custom id — so they are re-checked here
 * and again by the dial itself.
 */
function parseKeyId(customId, prefix) {
  if (typeof customId !== "string" || !customId.startsWith(prefix)) return null;
  const rest = customId.slice(prefix.length);
  const at = rest.lastIndexOf(":");
  const roomId = at < 0 ? rest : rest.slice(0, at);
  const digits = at < 0 ? "" : rest.slice(at + 1);
  if (!roomId || !new RegExp(`^[0-9]{0,${PHONE_DIGITS}}$`).test(digits)) return null;
  return { roomId, digits };
}

const STATE_LINE = {
  idle: PHONE_TEXT.stateIdle,
  calling: PHONE_TEXT.stateCalling,
  connected: PHONE_TEXT.stateConnected,
  dead: PHONE_TEXT.stateDead,
};

/**
 * The keypad message's words. `handset` is db/lib/phoneFrame.js#handsetFrame;
 * `line` is what just happened, if anything. The payphone's clock is a
 * Discord timestamp, so it counts down on its own in every reader's client.
 */
function panelText(handset, digits = "", line = null) {
  const out = [];
  if (line) out.push(line);
  if (handset?.number != null) out.push(PHONE_TEXT.ownNumber(handset.number));
  out.push(STATE_LINE[handset?.state] ?? PHONE_TEXT.stateIdle);
  if (handset?.payphone) {
    if (handset.paidUntil) {
      const unix = Math.floor(new Date(handset.paidUntil).getTime() / 1000);
      out.push(`-# ${PHONE_TEXT.timeLeft}: <t:${unix}:R>${handset.needsCoin ? ` · ${PHONE_TEXT.insertAgain}` : ""}`);
    } else {
      out.push(`-# ${PHONE_TEXT.insert}`);
    }
  }
  const shown = Array.from({ length: PHONE_DIGITS }, (_, i) => digits[i] ?? "·").join(" ");
  out.push(`\`${shown}\``);
  return out.join("\n");
}

/**
 * The five rows of buttons: 1–3, 4–6, 7–9, ⌫ 0 Dial, and the handset's own
 * controls. Each button is `{ id, label, style, disabled }`, style one of
 * "primary" | "secondary". Custom ids are unique within the message by
 * construction: a digit key carries one more digit than the readout, ⌫ one
 * fewer, and Dial has a prefix of its own.
 */
function keypadRows(roomId, handset, digits = "") {
  const canDial = (handset?.state ?? "idle") === "idle";
  const full = digits.length >= PHONE_DIGITS;
  const key = (d) => ({
    id: keyId(PHONE_KEY_PREFIX, roomId, full ? digits : digits + d),
    label: d,
    style: "secondary",
    disabled: !canDial || full,
  });
  const rows = [
    ["1", "2", "3"].map(key),
    ["4", "5", "6"].map(key),
    ["7", "8", "9"].map(key),
    [
      {
        id: keyId(PHONE_KEY_PREFIX, roomId, digits.slice(0, -1)),
        label: "⌫",
        style: "secondary",
        disabled: !canDial || digits.length === 0,
      },
      key("0"),
      {
        id: keyId(PHONE_CALL_PREFIX, roomId, digits),
        label: PHONE_TEXT.dial,
        style: "primary",
        disabled: !canDial || !full,
      },
    ],
  ];
  // A full readout would make every digit key the same id as the readout
  // itself; they are disabled then, and given distinct ids anyway.
  if (full) {
    rows.slice(0, 3).forEach((row, r) => row.forEach((b, i) => (b.id = `${b.id}~${r * 3 + i}`)));
    rows[3][1].id = `${rows[3][1].id}~z`;
  }
  const controls = [
    { id: keyId(PHONE_HANGUP_PREFIX, roomId), label: PHONE_TEXT.hangUp, style: "secondary", disabled: canDial },
    { id: keyId(PHONE_WALK_PREFIX, roomId), label: PHONE_TEXT.walkAway, style: "secondary", disabled: false },
  ];
  if (handset?.payphone && handset.needsCoin && handset.paidUntil) {
    controls.push({
      id: keyId(PHONE_COIN_PREFIX, roomId),
      label: `${PHONE_TEXT.insertCoin} (${PHONE_COST} ¢)`,
      style: "primary",
      disabled: false,
    });
  }
  rows.push(controls);
  return rows;
}

module.exports = {
  PHONE_KEY_PREFIX,
  PHONE_CALL_PREFIX,
  PHONE_ANSWER_PREFIX,
  PHONE_HANGUP_PREFIX,
  PHONE_WALK_PREFIX,
  PHONE_COIN_PREFIX,
  keyId,
  parseKeyId,
  panelText,
  keypadRows,
};
