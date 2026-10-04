"use client";

import { useState } from "react";
import CharacterMentionsProvider from "@/app/components/CharacterMentionsProvider";
import { ChevronDownIcon } from "@/app/components/icons";
import FriendsSection from "./FriendsSection";
import WhoAmISection from "./WhoAmISection";
import DaySection from "./DaySection";
import JournalList from "./JournalList";
import StarredList from "./StarredList";
import JournalComposer from "./JournalComposer";

// The five sections of /memories (docs/systemdocs/MEMORIES.md), each one a
// <details> the player opens to read. A native disclosure rather than a
// button and a store: it needs no state, it works before the page hydrates,
// and a screen reader already knows what it is. Friends opens by default,
// since it is what a player comes here for; the rest start shut.
//
// Notes and Highlights are the old /notes page's two tabs, moved over as they
// were — the Journal and the starred list keep their own filter, sort and
// paging, and still never share state.
//
// Exported for the GM's Dev Panel Memories tab, which draws the same five.
export function Section({ title, count, open = false, children }) {
  return (
    <details className="panel memory-section" open={open}>
      <summary>
        <ChevronDownIcon className="memory-section-chevron" aria-hidden="true" />
        <span className="memory-section-title">{title}</span>
        {count != null && <span className="memory-section-count">{count}</span>}
      </summary>
      <div className="memory-section-body">{children}</div>
    </details>
  );
}

export default function MemoriesBoard({
  hasCharacter,
  foggy,
  friends,
  self,
  day,
  starred,
  journal,
  roster,
  directory,
  currentTurnNumber,
}) {
  const [composerEntry, setComposerEntry] = useState(null); // null closed, {} new, {...} editing
  const [composerOpen, setComposerOpen] = useState(false);

  function openComposer(entry) {
    setComposerEntry(entry ?? {});
    setComposerOpen(true);
  }

  return (
    <CharacterMentionsProvider characters={roster} directory={directory}>
      <div>
        {/* Said once, at the top, rather than on every garbled card: the
            player needs to know the nonsense is their head, not a bug. */}
        {foggy && (
          <p className="text-sm text-muted memory-fog">
            Your head is swimming. Much of what you remember will not come clear.
          </p>
        )}

        <Section title="Friends" count={friends.length} open>
          <FriendsSection friends={friends} hasCharacter={hasCharacter} />
        </Section>

        <Section title="Who am I?">
          <WhoAmISection self={self} />
        </Section>

        <Section title="Memories of the day" count={day.length}>
          <DaySection lines={day} hasCharacter={hasCharacter} />
        </Section>

        <Section title="Notes" count={journal.length}>
          <div className="flex justify-end">
            <button type="button" className="btn" onClick={() => openComposer(null)}>
              + New entry
            </button>
          </div>
          <JournalList entries={journal} onEdit={openComposer} />
        </Section>

        <Section title="Highlights" count={starred.length}>
          <StarredList notes={starred} />
        </Section>
      </div>

      <JournalComposer
        open={composerOpen}
        entry={composerEntry}
        roster={roster}
        currentTurnNumber={currentTurnNumber}
        onClose={() => setComposerOpen(false)}
      />
    </CharacterMentionsProvider>
  );
}
