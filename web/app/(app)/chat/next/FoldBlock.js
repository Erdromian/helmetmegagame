"use client";

import { ChevronDownIcon } from "@/app/components/icons";

// ONE BLOCK OF THE PLAYER'S RIGHT COLUMN, with its girder head as the fold
// (chat-vocabulary.md §1, §4). Every block in ./ChatAside.js wears one, and so
// do Things (../ThingsDrawer.js `framed`) and the party rack (../PartyRack.js
// `framed`), which draw their own heads because their titles are live.
//
// The fold state is the caller's: ./asideFoldStore.js for most blocks,
// ../thingsOpenStore.js for Things.
//
// A shut block HIDES its body rather than unmounting it. The bodies are deep
// game surfaces with state of their own — HereList seeds its rows into
// useState, TravelNodes holds a crossing confirm half-answered — and folding a
// block away for a moment must not throw that away or refetch it on reopen.
export default function FoldBlock({ head, open, onToggle, className = "", children }) {
  return (
    <section className={className ? `block ${className}` : "block"} data-open={open ? "true" : undefined}>
      <h3 className="bar">
        <button type="button" className="chat-aside-fold" aria-expanded={open} onClick={onToggle}>
          <ChevronDownIcon data-open={open ? "true" : undefined} />
          {head}
        </button>
      </h3>
      <div className="body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
