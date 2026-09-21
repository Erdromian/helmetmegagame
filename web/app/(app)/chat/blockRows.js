"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import TranscriptLine from "@/app/components/TranscriptLine";
// Safe from a client file: db/lib/decreeText.js and db/lib/turnPostText.js both
// have zero requires, the rule db/lib/dmKinds.js keeps — one require of
// @lifeweb/db here would drag Prisma and node:fs into the browser bundle.
import { DECREE_LABEL, splitDecree } from "@lifeweb/db/lib/decreeText";
import { GAME_END_TITLE, splitTurnPost, splitEndPost } from "@lifeweb/db/lib/turnPostText";

// THE NOTICES: the rows that draw as a bordered block across the log rather
// than as a line in it — a heading, the words at reading size, a rule top and
// bottom (REDESIGN.md §6). Four of them now, so they live here rather than as a
// ternary inside a `SystemRow`: ../Feed.js and ../next/Feed.js both render
// through this, and a fifth kind is one entry rather than two edits that drift.
//
// All four are ONE component, TranscriptLine's variant="block", with different
// heading faces. A PA, a proclamation, a turn opening and a game ending are the
// same shape — the world interrupting — and drawing them four times is how the
// four come to disagree about what a notice looks like.

// Discord's copy of an intercom line opens with the words the PA is wearing as
// a heading here, so the body would say it twice. Cut on the web only.
const INTERCOM_PREFIX = /^you hear a voice from the intercom:\s*/i;

export const BLOCK_KINDS = new Set(["intercom", "decree", "turn", "gameend"]);

// The only two turn pictures there are. A whitelist, since the name comes out of a stored row.
const TURN_PLATES = new Set(["nuke", "hellfire"]);

// A loudspeaker is a machine, so it gets the machine's face: a small caps
// micro-label, and both what it is and where it was heard in the one line,
// since a PA has no title of its own.
function intercomBlock(row, zone) {
  return {
    face: "caps",
    heading: zone ? `Intercom · ${zone}` : "Intercom",
    byline: null,
    body: <ChatMarkdown content={String(row.content ?? "").replace(INTERCOM_PREFIX, "")} />,
  };
}

// A decree carries its own title, written by a GM: the row is the title, a
// blank line, then the words. Blackletter, which is the one thing --font-display
// is for — the world speaking in its own voice.
function decreeBlock(row, zone) {
  const parts = splitDecree(row.content);
  return {
    face: "blackletter",
    heading: parts.title || zone || "Ravenheart",
    byline: zone ? `${DECREE_LABEL} · ${zone}` : DECREE_LABEL,
    body: <ChatMarkdown content={parts.body} />,
  };
}

// THE TURN, in the Game channel (db/lib/gameChannel.js). The head is the number
// itself, large, in the serif — the blackletter is spoken for by the decree, and
// two proclamation faces in one feed would say the same thing twice.
//
// The clock is the one part of this that is machine output, so it sits under a
// hairline at the foot in the mono face, like a stamp on a docket rather than a
// sentence in the notice. Its <t:…> tags render as a live local time and a
// ticking relative in each reader's own timezone — the one thing the web does
// that the Discord post it copies cannot.
function turnBlock(row) {
  const turn = splitTurnPost(row.content);
  const stamp = [turn.day ? `Day ${turn.day}` : null, turn.date || null].filter(Boolean).join(" · ");
  return {
    face: "ordinal",
    heading: (
      <>
        <span className="turn-word">Turn</span>
        <span className="turn-ord">{turn.number || "—"}</span>
      </>
    ),
    byline: stamp || null,
    body: (
      <>
        {/* The one picture a turn can carry, the same one Discord's #turns
            posts: the nuke's or the hellfire's (db/lib/turnBanner.js). */}
        {TURN_PLATES.has(turn.plate) ? (
          <img className="turn-plate" src={`/assets/turn/${turn.plate}.jpg`} alt="" loading="lazy" />
        ) : null}
        {turn.note ? <ChatMarkdown content={turn.note} /> : null}
        {/* A DIV, not a `p`: ChatMarkdown renders its own paragraph, and a `p`
            inside a `p` is invalid HTML — the browser closes the outer one
            early, so the rule and the mono face land on an empty element and
            the clock draws as ordinary body text. */}
        {turn.clock ? (
          <div className="turn-clock">
            <ChatMarkdown content={turn.clock} />
          </div>
        ) : null}
      </>
    ),
  };
}

// THE END. Blackletter here and nowhere else in this channel: a game ending is
// the world speaking in its own voice, which is exactly what the decree's face
// is for. The facts line is already one sentence, so it reads as the byline with
// no rewriting; the closing note becomes a pull-quote, which is what the Discord
// post's `»` is doing in a face that has no chevrons.
function endBlock(row) {
  const end = splitEndPost(row.content);
  return {
    face: "blackletter",
    heading: GAME_END_TITLE,
    byline: end.facts || null,
    body: (
      <>
        {end.note ? <p className="end-note">{end.note}</p> : null}
        {end.body ? <ChatMarkdown content={end.body} /> : null}
      </>
    ),
  };
}

const BLOCKS = {
  intercom: intercomBlock,
  decree: decreeBlock,
  turn: turnBlock,
  gameend: endBlock,
};

// The one renderer both feeds call. `zone` is where the row was read, which only
// the two scene blocks have any use for.
export default function BlockRow({ row, zone = null }) {
  const build = BLOCKS[row.channelKind];
  if (!build) return null;
  const { face, heading, byline, body } = build(row, zone);
  return (
    <TranscriptLine
      variant="block"
      channelKind={row.channelKind}
      headingFace={face}
      heading={heading}
      byline={byline}
      seq={row.seq}
    >
      {body}
    </TranscriptLine>
  );
}
