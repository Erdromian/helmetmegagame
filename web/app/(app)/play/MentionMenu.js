"use client";

import { memo } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";

// The composer's @ list: the people standing where you stand, and nobody else.
//
// The roster is whosHere().named — the same list the right column draws, and
// the same list CharacterMentionsProvider resolves a {char:…} against on the
// way back. That is what keeps a mention honest in both directions: you can
// only name somebody you can see, and a row can only render a name its reader
// could have seen too.
//
// Concealed people are deliberately absent. A hood is somebody choosing not to
// be addressable, and an autocomplete that offered their real name would undo
// it in one keystroke.

const MentionMenu = memo(function MentionMenu({ matches, active, onPick }) {
  if (matches.length === 0) return null;
  return (
    <div className="chat-mentions" role="listbox" aria-label="Mention somebody">
      {matches.map((person, i) => (
        <button
          key={person.id}
          type="button"
          role="option"
          aria-selected={i === active}
          data-active={i === active ? "true" : "false"}
          className="menu-item"
          // Mousedown rather than click: the textarea must not lose focus
          // before the pick lands, or the caret it is about to rewrite moves.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(person);
          }}
        >
          <CharacterAvatar characterId={person.id} name={person.name} version={person.updatedAt} size={16} />
          <span className="truncate">{person.name}</span>
        </button>
      ))}
    </div>
  );
});

export default MentionMenu;

// What the composer is looking at, given the text and where the caret is.
//
// Returns `{ at, query }` for a live `@word` the caret sits at the end of, or
// null. The `@` has to open a word — mid-word it is an email address or a
// Discord handle somebody pasted, neither of which is a mention here.
export function mentionQueryAt(text, caret) {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  // A space ends it. Names have spaces in them, but an autocomplete that kept
  // matching across one would still be open three sentences later.
  if (/\s/.test(query)) return null;
  return { at, query };
}

// Case-insensitive prefix on the whole name or on any word in it, so "@bar"
// finds "Cersei, the Baroness" the way a person expects. Capped, because the
// popover is twelve rems tall and a scroll list of forty is not a shortcut.
//
// `limit` is a parameter rather than the constant it used to be, because the
// composer's person picker (Feed.js#CommandArgs) filters the same way and
// wants a wider row of chips — and it needs the UNCAPPED count to say how many
// it left out, which it gets by asking for Infinity and slicing itself.
//
// A hood has an `alias` where a named person has a `name`, and the picker
// offers both. Matching the one it has keeps typing a few letters working for
// whichever list this is called on.
export function matchRoster(roster, query, limit = 6) {
  const q = query.trim().toLowerCase();
  const hits = roster.filter((person) => {
    if (!q) return true;
    const name = (person.name ?? person.alias ?? "").toLowerCase();
    return name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q));
  });
  return limit === Infinity ? hits : hits.slice(0, limit);
}
