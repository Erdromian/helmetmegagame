"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import ActionButton from "@/app/components/ActionButton";
import FormError from "@/app/components/FormError";
import LookReadout from "@/app/components/LookReadout";
import NameCard from "@/app/components/NameCard";
import { EyeIcon, SpeakerIcon, SpeakerOffIcon } from "@/app/components/icons";
import { toggleMutedPerformer, useMutedPerformers } from "@/app/components/performanceStore";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { ACTION_HELP, actionFor, helpFor, reasonFor } from "@/app/components/actionRegistry";
import { lookAtRow } from "@/app/(app)/chat/actions";
import { loadPeopleHere } from "@/app/(app)/character/rosterActions";
import useVisiblePoll from "@/app/(app)/chat/useVisiblePoll";
import { actionThrowMessage } from "@/app/components/actionThrow";

// HERE: who is standing where you are, and what you can do to them. Drawn at
// the top of /chat's Place panel and the sheet's Actions panel — same rows,
// same menu. Rows come from db/lib/whosHere.js, the same function the
// Discord "Who's here?" answers with.
//
// A FACE AND AN EYE ARE EARNED: standing in a room is public, but what's over
// somebody's face is not, so a row shows a face and a look only once you've
// watched that person SPEAK this turn (db/lib/sightings.js) — and shows what
// you saw, not what's true now. Unseen, a named row keeps its own face; a
// hood gets the question-mark plate and no eye.
//
// The eye points at the LINE, not the person: `sightingSeq` is the last line
// you heard, and the server resolves the speaker off it (db/lib/examineRow.js)
// — the browser is never told who is under a hood, so there is nothing to leak.
//
// The menu is the sheet's own people dialogs, opened through
// RequestActionsProvider with the person already filled in — nothing forked.
// A HOOD GETS A SHORTER MENU, NOT A DIFFERENT ONE (PROXYING.md §5). A hooded
// row carries no character id (shipping one is the unmasking) — it carries
// the hood token (db/lib/whosHere.js#hoodToken), resolved server-side.
//
// THE METAGAMING RULE STILL HOLDS (web/app/components/actionRegistry.js): no
// row is greyed for a fact about the person it names — that's the dialog's
// answer and the server's, never a menu hint.
//
// AND THESE ARE THE REGISTRY'S ROWS, so they take the registry's `show` and
// `gate` with them — the same two keys ActionGrid.js reads. This menu used to
// carry neither, which is how Perform Miracle came to sit on the menu of every
// player who wasn't a Saint. The two rules don't fight: every gate in the
// registry is a fact about YOUR OWN sheet by construction, so honouring them
// here hides nothing about who is standing near you.
//
// Look at is NOT on this menu (the eye on the row already is it). Move
// Player is gone entirely — the party rack below this list replaced it
// (docs/systemdocs/MAP.md §3a).
// Every row carries both prefixes now, and that is the whole rule: a hood hides
// WHO you are, never THAT you are standing there, so every verb on this menu
// reaches one. The preset it hands over is a TARGET KEY — "character:<id>" for
// somebody named, "hood:<token>" for somebody in a mask — which is the shape
// every pool in web/lib/peoplePools.js is keyed by and db/lib/targetKey.js
// resolves. A row with no hoodPrefix is dropped for hoods by the filter below,
// which is how Heal and Loot used to vanish for exactly the person bleeding out
// in front of you.
//
// Everything else about a row — whether it shows at all, whether it is greyed,
// and the sentence saying why — comes from the registry, not from here.
const HOOD_KEYS = { prefix: "character:", hoodPrefix: "hood:" };
// `group` orders the menu into kind-of-act bands, drawn with a rule between
// them — roughly the sheet strip's own groups (actionRegistry.js#STRIP_GROUPS):
// look and talk, help, lessons, theft, the fight, then the things done to
// somebody tied up, then the door. `self: false` rows never appear on your own
// row — nobody kisses, searches or harms themselves.
const BAND = { look: 0, help: 1, lessons: 2, theft: 3, fight: 4, captives: 5, door: 6 };
const PEOPLE_ACTIONS = [
  // Kiss keeps its row for a hood even though kissBlock() will refuse a covered
  // face: the refusal is the gate, and the menu is not the place to re-implement
  // it (web/lib/peoplePools.js says the same about kissTargets).
  { mode: "kiss", label: "Kiss", preset: "targetId", group: BAND.help, self: false, ...HOOD_KEYS },
  { mode: "heal", label: "Heal", preset: "patientId", group: BAND.help, ...HOOD_KEYS },
  { mode: "miracle", label: "Perform Miracle", preset: "patientId", group: BAND.help, ...HOOD_KEYS },
  { mode: "transfer", label: "Transfer", preset: "toKey", group: BAND.help, ...HOOD_KEYS },
  { mode: "search", label: "Search", preset: "targetId", group: BAND.help, self: false, ...HOOD_KEYS },
  // Confess shows on every row, chaplain or not: whether somebody can hear a
  // confession is a fact about THEM, and the metagaming rule below keeps that
  // off the menu. The dialog opens with nobody picked if they can't.
  { mode: "learn", label: "Learn skill", preset: "targetId", group: BAND.lessons, self: false, ...HOOD_KEYS },
  { mode: "teach", label: "Teach skill", preset: "targetId", group: BAND.lessons, self: false, ...HOOD_KEYS },
  { mode: "confess", label: "Confess", preset: "targetId", group: BAND.lessons, self: false, ...HOOD_KEYS },
  { mode: "pickpocket", label: "Pickpocket", preset: "targetId", group: BAND.theft, self: false, ...HOOD_KEYS },
  // Loot's dialog is the Transfer one (actions/MoveThingsDialog.js), so the
  // person is the FROM end, not a target.
  { mode: "loot", label: "Loot", preset: "fromKey", group: BAND.theft, self: false, ...HOOD_KEYS },
  { mode: "attack", label: "Attack", preset: "targetId", group: BAND.fight, self: false, ...HOOD_KEYS },
  { mode: "bind", label: "Bind", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "free", label: "Free", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "harm", label: "Harm", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "torture", label: "Torture", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "crucify", label: "Crucify", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "shackle", label: "Shackle", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "mutilate", label: "Mutilate", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  { mode: "brand", label: "Brand", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  // Dosing somebody helpless; drinking it yourself is the sheet's own Poison.
  { mode: "poison", label: "Poison", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
  // Apply Collar keeps your own row: the collar roster lists yourself
  // (web/lib/peoplePools.js#collarTargets). Detonate is not here and must not
  // be — the remote knows a collar by its glyph, never by whose neck it is on
  // (COLLAR.md).
  { mode: "applycollar", label: "Apply Collar", preset: "targetId", group: BAND.captives, ...HOOD_KEYS },
  { mode: "unlockcollar", label: "Unlock Collar", preset: "targetId", group: BAND.captives, self: false, ...HOOD_KEYS },
];
// Somebody on the far side of a room that opens onto here too — every
// multi-locational room, by default (MAP.md §2d). Transfer is the one verb that
// reaches across, keyed "across:<ref>" for named and hooded alike: the ref is a
// character id or the row's lookRef, which is what acrossRecipients lists and
// resolveAcrossRecipient takes back (db/lib/whosHere.js).
const ACROSS_ACTIONS = [
  { mode: "transfer", label: "Transfer", preset: "toKey", group: BAND.help, prefix: "across:", hoodPrefix: "across:" },
];

// `person` is normalised by the two lists below to { ref, name, hooded }:
// a character id for somebody named, a hood token for somebody in one.
function PersonMenu({
  person,
  isSelf = false,
  onLook = null,
  onClose,
  onConverse,
  addPlace,
  onAddMember,
  menu = PEOPLE_ACTIONS,
}) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;
  const pools = actions?.pools ?? null;

  const pick = useCallback(
    (entry) => {
      onClose();
      if (!open) return;
      const prefix = person.hooded ? entry.hoodPrefix : entry.prefix;
      open(entry.mode, null, { [entry.preset]: prefix ? `${prefix}${person.ref}` : person.ref });
    },
    [open, onClose, person],
  );

  // A hood with no token is a hood nothing can act ON (hoodToken mints none without an AUTH_SECRET); Converse still works.
  // Then the registry's own `show`, exactly as ActionGrid.js applies it. A mode
  // the registry doesn't know stays on the menu, so nothing can vanish by
  // accident — the filter only ever removes a row somebody wrote a rule for.
  const entries = menu.filter((entry) => {
    if (isSelf && entry.self === false) return false;
    if (person.hooded && !(entry.hoodPrefix && person.ref)) return false;
    const action = actionFor(entry.mode);
    return action?.show ? Boolean(pools?.[action.show]) : true;
  });

  // Bands, in BAND's order; an empty one draws nothing.
  const bands = Object.values(BAND).map(() => []);
  if (onLook) {
    bands[BAND.look].push(
      <ActionButton
        key="look"
        variant="menu"
        label="Look at"
        onClick={() => {
          onClose();
          onLook();
        }}
      />,
    );
  }
  if (onConverse && !isSelf) {
    bands[BAND.look].push(
      <ActionButton
        key="converse"
        variant="menu"
        label="Converse"
        onClick={() => {
          onClose();
          // Opened ON this person, already ticked.
          onConverse({ ref: person.ref, name: person.name });
        }}
      />,
    );
  }
  for (const entry of entries) {
    // The label stays the menu's own — these are spelled-out verbs, not the
    // rack's glyph captions. Everything else is the registry's.
    const action = actionFor(entry.mode);
    bands[entry.group].push(
      <ActionButton
        key={entry.mode}
        variant="menu"
        label={entry.label}
        help={action ? helpFor(action, pools) : (ACTION_HELP[entry.mode] ?? null)}
        disabled={action?.gate ? !pools?.[action.gate] : false}
        reason={action ? reasonFor(action, pools) : null}
        onClick={() => pick(entry)}
      />,
    );
  }
  // Only offered where there is a door to open; the server re-checks that this character may work it.
  if (addPlace && onAddMember && person.ref && !isSelf) {
    bands[BAND.door].push(
      <ActionButton
        key="add"
        variant="menu"
        label={`Add to ${addPlace.name}`}
        onClick={() => {
          onClose();
          onAddMember(person.ref);
        }}
      />,
    );
  }

  const shown = bands.filter((band) => band.length > 0);
  return (
    <div className="chat-menu" role="menu" aria-label={person.name}>
      {shown.map((band, i) => (
        <div key={i} className="chat-menu-band" role="group">
          {band}
        </div>
      ))}
    </div>
  );
}

const HERE_POLL_MS = 60_000;

export default function HereList({
  // The server's list, or null to read it on mount — the sheet passes null,
  // since opening it is the click that asks who is standing here.
  people,
  selfId,
  onConverse = null,
  poll = false,
  // The open place, when somebody can be let into it: { placeKey, name }.
  // Null everywhere else, which keeps the row off the menu.
  addPlace = null,
  onAddMember = null,
  // False when the caller already draws its own "Here · N" head — the
  // chat aside's `Here` block (chat.css `.block h3`) does, so this component
  // would otherwise say the count twice. The sheet's Actions panel has no
  // heading of its own and keeps the default.
  showTitle = true,
}) {
  // Seeded from the server, replaced by the poll. ChatAside keys this
  // component on the server list, so a move remounts it instead of leaving a stale poll answer.
  const [live, setLive] = useState(people);
  const named = live?.named ?? [];
  const concealed = live?.concealed ?? [];
  const [openId, setOpenId] = useState(null);

  const pollPeople = useCallback(() => {
    loadPeopleHere()
      .then((res) => {
        if (res?.ok) setLive({ named: res.named, concealed: res.concealed, rooms: res.rooms });
      })
      .catch(() => {
        // A missed read costs one stale minute; the next one fixes it.
      });
  }, []);
  // No seed means nobody has asked yet; ask now, then on the minute, only while the tab is visible.
  useEffect(() => {
    if (poll && people == null) pollPeople();
  }, [poll, people, pollPeople]);
  useVisiblePoll(pollPeople, HERE_POLL_MS, { enabled: poll });
  const [hood, setHood] = useState(null);
  // "Add to …" refused, or never reached the server — shown under the list the row was on.
  const [addError, setAddError] = useState(null);
  const addAndReport = useCallback(
    (ref) => {
      if (!onAddMember) return;
      setAddError(null);
      Promise.resolve(onAddMember(ref))
        .then((res) => {
          if (res && !res.ok) setAddError(res.error ?? "Something went wrong.");
        })
        .catch((err) => setAddError(actionThrowMessage(err)));
    },
    [onAddMember],
  );
  const actions = useRequestActions();
  const wrapRef = useRef(null);

  const close = useCallback(() => setOpenId(null), []);

  // Dismissal is a document listener and an Escape key, the same pair
  // ClickMenu.js uses — NOT the focusout on the wrapper this used to carry.
  // Two things were wrong with that. Nothing closed on Escape, which every
  // other menu in the app does. And it only worked at all if opening the menu
  // had put focus inside the wrapper: on macOS neither Safari nor Firefox
  // focuses a <button> on click, so focus never entered, no focusout ever
  // fired, and the menu sat open over the roster until you clicked the same
  // row again. A pointerdown does not care whether the trigger took focus.
  //
  // Scoped to the wrapper rather than to the open menu on purpose, which keeps
  // the old behaviour exactly: a click on another row, or on that row's "Look
  // at", is inside .chat-here and leaves the menu to the row's own toggle.
  useEffect(() => {
    if (openId == null) return;
    const onPointerDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, close]);

  // Fetch-then-set from a click, not an effect: the dialog is open the whole time the readout is in flight.
  const lookAtSeq = useCallback(
    (seq) => {
      close();
      setHood({ loading: true });
      lookAtRow(seq)
        .then((res) => {
          if (res?.ok) setHood({ readout: res.readout });
          else setHood({ error: res?.error ?? "You can't see them." });
        })
        .catch(() => setHood({ error: "You can't see them." }));
    },
    [close],
  );
  // What the eye (and the menu's "Look at") does for a named row, or null for none.
  const router = useRouter();
  const lookFor = (person) => {
    if (person.sightingSeq) return () => lookAtSeq(person.sightingSeq);
    if (person.characterId === selfId) return () => router.push("/character");
    return null;
  };

  const total = named.length + concealed.length;
  // Whose playing this browser has silenced (SOUND.md, "Performances"). Only rows for
  // somebody who has ever played carry a performerKey, so only they get the button.
  const muted = useMutedPerformers();

  return (
    <div className="chat-here" ref={wrapRef}>
      {showTitle && <p className="group-label chat-section-title">Here · {total}</p>}
      {total === 0 && <EmptyState>Nobody is here.</EmptyState>}

      {named.map((person) => (
        <div key={person.characterId} className="chat-person-wrap">
          <div className="chat-person-row">
            <button
              type="button"
              className="chat-person"
              aria-haspopup="menu"
              aria-expanded={openId === person.characterId}
              onClick={() => setOpenId(openId === person.characterId ? null : person.characterId)}
            >
              {/* `avatarPath` is set only for a forced name's plaque or a face frozen at the last line you heard. */}
              <CharacterAvatar
                characterId={person.characterId}
                name={person.name}
                version={person.avatarVersion}
                src={person.avatarPath ?? undefined}
                size={24}
                online={person.online}
              />
              <span className="chat-person-name" data-role-group={person.roleGroup ?? undefined}>
                {/* Not pinnable: a click on the name still opens the menu below. */}
                {person.characterId === selfId ? (
                  person.name
                ) : (
                  <NameCard seq={person.sightingSeq} pinnable={false}>
                    {person.name}
                  </NameCard>
                )}
                {person.characterId === selfId ? <span className="text-muted"> · you</span> : null}
                {/* The avatar's glow ring is the mobile signal (portrait always
                    shows, name may not); this is desktop's second cue, beside it. */}
                {person.online ? <span className="text-muted"> · online</span> : null}
              </span>
            </button>
            {person.performerKey && (
              <span className="chat-person-eye">
                <IconButton
                  icon={muted.has(person.performerKey) ? SpeakerOffIcon : SpeakerIcon}
                  label="[PLACEHOLDER: mute this performer]"
                  aria-pressed={muted.has(person.performerKey)}
                  onClick={() => toggleMutedPerformer(person.performerKey)}
                />
              </span>
            )}
            {/* No eye until you have heard them. Absent rather than greyed — one rule instead of two.
                Your own row always has one: with no line of yours to look at, it opens your sheet. */}
            {lookFor(person) && (
              <span className="chat-person-eye">
                <IconButton icon={EyeIcon} label="Look at" onClick={lookFor(person)} />
              </span>
            )}
          </div>
          {openId === person.characterId && (
            <PersonMenu
              person={{ ref: person.characterId, name: person.name, hooded: false }}
              isSelf={person.characterId === selfId}
              onLook={lookFor(person)}
              onClose={close}
              onConverse={onConverse}
              addPlace={addPlace}
              onAddMember={onAddMember ? addAndReport : null}
            />
          )}
        </div>
      ))}

      {/* Keyed by POSITION, not token: with no AUTH_SECRET, db/lib/whosHere.js mints none, and two hoods would share `hooded-null`. */}
      {concealed.map((person, index) => (
        <div key={`hooded-${index}`} className="chat-person-wrap">
          <div className="chat-person-row">
            <button
              type="button"
              className="chat-person"
              aria-haspopup="menu"
              aria-expanded={openId === `hooded-${index}`}
              onClick={() => setOpenId(openId === `hooded-${index}` ? null : `hooded-${index}`)}
            >
              {/* The mask, only if you watched them wear it — else the question-mark plate (PROXYING.md §5). */}
              <CharacterAvatar
                characterId={null}
                name={person.alias}
                src={person.avatarPath ?? undefined}
                unknown={person.unknownFace}
                size={24}
              />
              {/* A stranger's face is not hidden, so their estate colour shows as anyone's does (STRANGERS.md). */}
              <span
                className={person.stranger ? "chat-person-name" : "chat-person-name text-muted"}
                data-role-group={person.roleGroup ?? undefined}
              >
                <NameCard seq={person.sightingSeq} pinnable={false}>
                  {person.alias}
                </NameCard>
              </span>
            </button>
            {person.sightingSeq && (
              <span className="chat-person-eye">
                <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
              </span>
            )}
          </div>
          {/* The same menu the named rows get, filtered to what you can do to somebody you cannot name. */}
          {openId === `hooded-${index}` && (
            <PersonMenu
              person={{ ref: person.token ?? null, name: person.alias, hooded: true }}
              onLook={person.sightingSeq ? () => lookAtSeq(person.sightingSeq) : null}
              onClose={close}
              onConverse={onConverse}
              addPlace={addPlace}
              onAddMember={onAddMember ? addAndReport : null}
            />
          )}
        </div>
      ))}

      {/* Across a modular gate: seen through the bars, so listed, but nothing can be done to them — no menu, no eye. */}
      {(people?.across ?? []).map((group) => (
        <div key={group.locationId}>
          <p className="group-label chat-section-title">
            {group.locationName} · {group.named.length + group.concealed.length}
          </p>
          {group.named.map((person) => (
            <div key={person.characterId} className="chat-person-row">
              <span className="chat-person">
                <CharacterAvatar
                  characterId={person.characterId}
                  name={person.name}
                  version={person.avatarVersion}
                  src={person.avatarPath ?? undefined}
                  size={24}
                />
                <span className="chat-person-name" data-role-group={person.roleGroup ?? undefined}>
                  {person.name}
                </span>
              </span>
            </div>
          ))}
          {group.concealed.map((person, index) => (
            <div key={`across-hooded-${index}`} className="chat-person-row">
              <span className="chat-person">
                <CharacterAvatar
                  characterId={null}
                  name={person.alias}
                  src={person.avatarPath ?? undefined}
                  unknown={person.unknownFace}
                  size={24}
                />
                <span
                  className={person.stranger ? "chat-person-name" : "chat-person-name text-muted"}
                  data-role-group={person.roleGroup ?? undefined}
                >
                  {person.alias}
                </span>
              </span>
            </div>
          ))}
        </div>
      ))}

      {/* Over a counter: the far side of a room that opens onto here too (db/lib/roomSides.js).
          In the room with you, so a face and an eye once you have heard them — but standing
          somewhere else, so the menu holds Transfer and nothing else: handing something
          across is the one thing done to anybody on the other side (MAP.md §2d). */}
      {(live?.rooms ?? []).map((group) => {
        const groupKey = `${group.roomId}:${group.locationId}`;
        return (
          <div key={groupKey}>
            <p className="group-label chat-section-title">
              {group.roomName} · {group.locationName} · {group.named.length + group.concealed.length}
            </p>
            {group.named.map((person) => {
              const rowId = `across:${groupKey}:${person.characterId}`;
              return (
                <div key={person.characterId} className="chat-person-wrap">
                  <div className="chat-person-row">
                    <button
                      type="button"
                      className="chat-person"
                      aria-haspopup="menu"
                      aria-expanded={openId === rowId}
                      onClick={() => setOpenId(openId === rowId ? null : rowId)}
                    >
                      <CharacterAvatar
                        characterId={person.characterId}
                        name={person.name}
                        version={person.avatarVersion}
                        src={person.avatarPath ?? undefined}
                        size={24}
                        online={person.online}
                      />
                      <span className="chat-person-name" data-role-group={person.roleGroup ?? undefined}>
                        {/* Not pinnable: a click on the name opens the menu below. */}
                        <NameCard seq={person.sightingSeq} pinnable={false}>
                          {person.name}
                        </NameCard>
                      </span>
                    </button>
                    {person.sightingSeq && (
                      <span className="chat-person-eye">
                        <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
                      </span>
                    )}
                  </div>
                  {openId === rowId && (
                    <PersonMenu
                      person={{ ref: person.characterId, name: person.name, hooded: false }}
                      onLook={person.sightingSeq ? () => lookAtSeq(person.sightingSeq) : null}
                      onClose={close}
                      menu={ACROSS_ACTIONS}
                    />
                  )}
                </div>
              );
            })}
            {group.concealed.map((person, index) => {
              const rowId = `across:${groupKey}:hooded-${index}`;
              return (
                <div key={`counter-hooded-${index}`} className="chat-person-wrap">
                  <div className="chat-person-row">
                    <button
                      type="button"
                      className="chat-person"
                      aria-haspopup="menu"
                      aria-expanded={openId === rowId}
                      onClick={() => setOpenId(openId === rowId ? null : rowId)}
                    >
                      <CharacterAvatar
                        characterId={null}
                        name={person.alias}
                        src={person.avatarPath ?? undefined}
                        unknown={person.unknownFace}
                        size={24}
                      />
                      <span
                        className={person.stranger ? "chat-person-name" : "chat-person-name text-muted"}
                        data-role-group={person.roleGroup ?? undefined}
                      >
                        <NameCard seq={person.sightingSeq} pinnable={false}>
                          {person.alias}
                        </NameCard>
                      </span>
                    </button>
                    {person.sightingSeq && (
                      <span className="chat-person-eye">
                        <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
                      </span>
                    )}
                  </div>
                  {/* The lookRef is the hood's across ref; with no AUTH_SECRET there is none, and the menu is Look at alone. */}
                  {openId === rowId && (
                    <PersonMenu
                      person={{ ref: person.lookRef ?? null, name: person.alias, hooded: true }}
                      onLook={person.sightingSeq ? () => lookAtSeq(person.sightingSeq) : null}
                      onClose={close}
                      menu={ACROSS_ACTIONS}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <FormError>{addError}</FormError>

      {hood && <LookReadout state={hood} onClose={() => setHood(null)} />}
    </div>
  );
}
