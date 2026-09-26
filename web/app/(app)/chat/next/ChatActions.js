"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { resourcesOf } from "@lifeweb/db/lib/resourceStack";
import ActionButton from "@/app/components/ActionButton";
import ClickMenu from "@/app/components/ClickMenu";
import IconButton from "@/app/components/IconButton";
import RequestActionsProvider, { useRequestActions } from "@/app/components/RequestActionsProvider";
import { ACTION_SECTIONS, labelFor, helpFor, reasonFor } from "@/app/components/actionRegistry";
import { ActionsIcon } from "@/app/components/icons";
import { loadActionSheet } from "../actionSheet";

// THE ACTIONS MENU in chat's head. Players spend their day in /chat, and until
// this the sheet's verbs — Craft, Mine, Learn skill, Write — were only on
// /character, so "where is the button for X" had no answer from the page they
// were on. One button, and a menu that opens under it.
//
// It stays small by being CONTEXT-SENSITIVE rather than complete:
//   - work this place offers (Mine, Farm, Harvest Godflesh…) comes first, under
//     the place's name, and is shown even when greyed, with the reason written
//     out — being here is the context, and "you're worn out" is worth reading;
//   - everything else is listed only when it is lit right now. A greyed verb is
//     a fact about your own sheet, and the sheet is one link away at the foot,
//     which says how many it left out.
//
// The pools come from the sheet's own load, fetched when the menu opens
// (../actionSheet.js), and a SECOND RequestActionsProvider is mounted over
// them. Chat's page-level provider carries only the people half of the pools
// (chat/page.js), which is enough for the Here list and the Things drawer but
// not for Craft or Learn. This one stays mounted once loaded, so a dialog the
// menu opened outlives the menu closing under it.

// Work a PLACE offers: these only ever show where the Location allows them
// (each is a `canSee…` show in actionRegistry.js), so their presence is itself
// the context.
const WORK_HERE = new Set(["extract", "refine", "mine", "farm", "breakin", "package"]);

// Chat's own headings for the two big registry sections. The sheet's "You" and
// "Others" read as columns beside each other there; in a list they need to say
// what the verbs are done TO.
const HEADINGS = { self: "Yourself", others: "Someone here" };

// The sheet's props as the provider's. The names are the provider's own
// already (character/page.js builds them for it), bar the five CharacterSheet
// renames on its way in.
function providerProps(sheet) {
  const { character, tagCatalog, ...rest } = sheet;
  return {
    ...rest,
    selfId: character.id,
    selfName: character.name,
    catalog: tagCatalog ?? [],
    characterTags: character.tags,
    resources: resourcesOf(character),
  };
}

function MenuBody({ placeName, onPicked, loading, error }) {
  const actions = useRequestActions();
  if (!actions) return null;
  const { open, pools, busy } = actions;

  const work = [];
  const groups = [];
  let leftOut = 0;
  for (const section of ACTION_SECTIONS) {
    const lit = [];
    for (const action of section.actions) {
      if (action.show && !pools[action.show]) continue;
      const gated = action.gate ? !pools[action.gate] : false;
      if (WORK_HERE.has(action.mode)) work.push({ action, gated });
      else if (gated) leftOut += 1;
      else lit.push(action);
    }
    if (lit.length > 0) groups.push({ key: section.key, label: HEADINGS[section.key] ?? section.label, actions: lit });
  }

  const item = (action, gated = false) => (
    <div key={action.mode} className="chat-actions-item">
      <ActionButton
        variant="menu"
        icon={action.icon}
        label={labelFor(action, pools)}
        help={helpFor(action, pools)}
        reason={reasonFor(action, pools)}
        disabled={gated}
        busy={busy === action.mode}
        onClick={() => {
          onPicked();
          open(action.mode);
        }}
      />
      {gated && <p className="chat-actions-why">{reasonFor(action, pools)}</p>}
    </div>
  );

  return (
    <>
      {work.length > 0 && (
        <div className="chat-menu-band" role="group" aria-label={placeName ?? "Here"}>
          <p className="chat-actions-head">{placeName ? `Work at ${placeName}` : "Work here"}</p>
          {work.map(({ action, gated }) => item(action, gated))}
        </div>
      )}
      {groups.map((group) => (
        <div key={group.key} className="chat-menu-band" role="group" aria-label={group.label}>
          <p className="chat-actions-head">{group.label}</p>
          <div className="chat-actions-grid">{group.actions.map((action) => item(action))}</div>
        </div>
      ))}
      {loading && <p className="chat-actions-note">Checking what you can do…</p>}
      {error && <p className="chat-actions-note">{error}</p>}
      <div className="chat-menu-band">
        <Link href="/character" className="chat-actions-sheet" onClick={onPicked}>
          {leftOut > 0 ? `${leftOut} more you can't do right now — on your sheet` : "Everything else is on your sheet"}
        </Link>
      </div>
    </>
  );
}

export default function ChatActions({ narrow = false, placeName = null }) {
  const triggerRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [loading, startLoading] = useTransition();

  // Every open asks again: what is lit changes as you walk, eat and act, and a
  // menu showing the last visit's verbs would be the stale kind of wrong. The
  // last answer stays on screen while the new one comes in.
  const load = useCallback(() => {
    setError(null);
    startLoading(async () => {
      try {
        const res = await loadActionSheet();
        if (res?.ok) setSheet(res.sheet);
        else setError(res?.error ?? "Couldn't load your actions.");
      } catch {
        setError("Couldn't load your actions. Try again.");
      }
    });
  }, []);

  const toggle = () => {
    if (!menuOpen) load();
    setMenuOpen((was) => !was);
  };
  const close = useCallback(() => setMenuOpen(false), []);

  const trigger = narrow ? (
    <IconButton
      ref={triggerRef}
      icon={ActionsIcon}
      label="Actions"
      size="lg"
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      onClick={toggle}
    />
  ) : (
    <button
      ref={triggerRef}
      type="button"
      className="btn-secondary chat-head-actions"
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      onClick={toggle}
    >
      <ActionsIcon width={14} height={14} aria-hidden="true" /> Actions
    </button>
  );

  const menu = (body) =>
    menuOpen ? (
      <ClickMenu triggerRef={triggerRef} onClose={close} ariaLabel="Actions" className="chat-actions-menu">
        {body}
      </ClickMenu>
    ) : null;

  return (
    <>
      {trigger}
      {/* Escaped to document.body: the provider draws its dialogs where it
          is mounted, and mounted here that is inside the head's girder, whose
          uppercase bold face every dialog then inherited. The sheet's dialogs
          sit at page level; these now do too. `sheet` is only ever set in the
          browser, so there is no document to miss on the server. */}
      {sheet ? (
        createPortal(
          <RequestActionsProvider {...providerProps(sheet)}>
            {menu(<MenuBody placeName={placeName} onPicked={close} loading={loading} error={error} />)}
          </RequestActionsProvider>,
          document.body,
        )
      ) : (
        menu(<p className="chat-actions-note">{error ?? "Checking what you can do…"}</p>)
      )}
    </>
  );
}
