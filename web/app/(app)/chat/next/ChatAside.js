"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import HereList from "@/app/components/HereList";
import useActionRunner from "@/app/components/useActionRunner";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import MoveDialog from "../MoveDialog";
import PartyRack from "../PartyRack";
import PlaceCard from "../PlaceCard";
import RoomPanel from "../RoomPanel";
import Things from "../ThingsDrawer";
import TravelNodes from "../TravelNodes";
import TurnCard from "../TurnCard";
import { usePlaceActions } from "../PlacePanel";
import { waitingOnYou, answerWaiting } from "../actions";
import useVisiblePoll from "../useVisiblePoll";
import useMyMove from "../useMyMove";
import FoldBlock from "./FoldBlock";
import { useAsideFolds } from "./asideFoldStore";

// THE RIGHT COLUMN, rebuilt (docs/systemdocs/CHAT-REBUILD.md phase 5).
//
// The WIRING below is ../ChatAside.js's, deliberately unchanged — the polls,
// the one usePlaceActions bag that owns every dialog, the fixture filter, the
// Move dialog's onDone chain. Those are load-bearing and already right; a
// rewrite of them would only be a chance to lose one.
//
// What is rebuilt is the SHAPE. The old column had nine sections and four
// headings: the place card, the room, travel and the party arrived as bare
// bodies with nothing naming them, so a reader scrolling the column met three
// unlabelled boxes in a row. Every framed section here wears a girder head
// (chat-vocabulary.md §4), and that head is the block's fold (./FoldBlock.js):
// every block starts open, and a player can shut the ones they do not use,
// remembered by this browser (./asideFoldStore.js). Things and the party rack
// draw their own (ThingsDrawer.js and PartyRack.js `framed`), because their
// titles are live.
//
// The children are MOUNTED, not rewritten. PlaceCard carries fixtures and the
// Depot/Factory doors, TravelNodes the crossing confirm, PartyRack
// the escort offers; they are deep game surfaces, and the plan's named risk is
// a rewrite losing things quietly. They are restyled from chat-next.css.
// A duplicate of ../ChatAside.js's, on purpose and briefly: importing it from
// there would make this file depend on the one the cutover deletes. Same key,
// same reason — HereList seeds rows into useState, so a new server list has to
// remount it rather than leave the poll answering for a street already left.
export function hereKey(people) {
  const named = (people?.named ?? []).map((person) => person.characterId).join(",");
  return `here:${named}|${(people?.concealed ?? []).length}`;
}

function WaitingList({ rows, onAnswered }) {
  const { run, pending, error } = useActionRunner();
  const openAction = useRequestActions()?.open ?? null;
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className="chat-waiting-row">
          <p className="quote">{row.label}</p>
          <div className="chat-buttons">
            {row.accept !== false && (
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: true }, { onOk: onAnswered })}
              >
                Accept
              </button>
            )}
            {row.decline !== false && (
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: false }, { onOk: onAnswered })}
              >
                Decline
              </button>
            )}
            {row.mode && openAction && (
              <button type="button" className="btn" onClick={() => openAction(row.mode)}>
                Answer
              </button>
            )}
            {row.href && (
              <Link className="btn" href={row.href}>
                Open
              </Link>
            )}
          </div>
        </div>
      ))}
      <FormError>{error}</FormError>
    </>
  );
}

// One framed section. The head and its fold are the only things every block
// shares, so they are the only things this takes — everything else is the
// child's own. `fold` is the key it is remembered under in ./asideFoldStore.js.
function Block({ head, fold, folds, children }) {
  const [shut, toggle] = folds;
  return (
    <FoldBlock head={head} open={!shut.has(fold)} onToggle={() => toggle(fold)}>
      {children}
    </FoldBlock>
  );
}

export default function ChatAside({
  people,
  affordances,
  place,
  zone,
  placeLines,
  waiting: initialWaiting,
  selfId,
  turn,
  moveCharacterId,
  move,
  things,
  depotHref = null,
  canSeeExtract = false,
  selected,
  travelPick = null,
  addPlace = null,
  onAddMember = null,
  onPlaceChanged = null,
  onOpenMap = null,
}) {
  const { affordances: live, openFixture, openConverse, say: placeSay, notice, error, pending, dialogs } =
    usePlaceActions(affordances, onPlaceChanged);
  const requestActions = useRequestActions();
  const folds = useAsideFolds();
  const openAction = requestActions?.open ?? null;

  // Travel / Who's here? / Secret rooms? / Examine are answered by this column
  // being on the page; they stay in db/lib/placeAffordances.js for Discord.
  // Charon's Leave is a place affordance too: it is how you get OFF the ship,
  // and the ship is a Location with no edge, so Travel cannot offer it
  // (docs/systemdocs/CHARON.md).
  const fixtures = live.filter(
    (entry) =>
      (entry.kind === "place" && (entry.id === "noticeboard" || entry.id === "charonLeave")) ||
      entry.kind === "gate" ||
      entry.kind === "keyed",
  );

  const moveState = useMyMove({ turn, move, characterId: moveCharacterId });
  const [dialog, setDialog] = useState(null);
  const [waiting, setWaiting] = useState(initialWaiting);

  const refreshWaiting = useCallback(() => {
    waitingOnYou()
      .then((res) => {
        if (res?.ok) setWaiting(res.rows);
      })
      .catch(() => {
        // A reminder, not the record — a failed refresh loses nothing.
      });
  }, []);
  useVisiblePoll(refreshWaiting, 60_000);

  const onWaitingAnswered = useCallback(() => {
    refreshWaiting();
    moveState.refresh();
  }, [refreshWaiting, moveState]);

  const hereCount = (people?.named?.length ?? 0) + (people?.concealed?.length ?? 0);

  // The order is Chat Overhaul.docx's: Travel highest, then the room you are
  // in (when you are in one), then Here, then Turn. The You plate lives in the
  // places column's foot now (./YouPlate.js), and the Desires fold and the
  // Sheet link are gone from chat altogether.
  return (
    <div className="chat-aside-stack">
      <Block head="Travel" fold="travel" folds={folds}>
        <TravelNodes onDone={placeSay} pick={travelPick} showTitle={false} />
      </Block>

      {selected?.kind === "room" && (
        <Block head={selected?.name ?? "Room"} fold="room" folds={folds}>
          <RoomPanel selected={selected} affordances={live} onFixture={openFixture} pending={pending} />
        </Block>
      )}

      <Block head={`Here · ${hereCount}`} fold="here" folds={folds}>
        {/* Keyed on the SERVER's list, so walking out remounts it rather than
            leaving the poll's answer for the street you have left. */}
        <HereList
          key={hereKey(people)}
          people={people}
          selfId={selfId}
          onConverse={openConverse}
          addPlace={addPlace}
          onAddMember={onAddMember}
          poll
          showTitle={false}
        />
      </Block>

      <Block head="Turn" fold="turn" folds={folds}>
        <TurnCard
          turn={moveState.turn}
          move={moveState.move}
          onFile={() => setDialog("move")}
          onEdit={() => setDialog("move")}
        />
      </Block>

      {/* No card at all when nothing is waiting — an empty box saying it is
          empty is one more thing to read past. */}
      {waiting.length > 0 && (
        <Block head={`Waiting · ${waiting.length}`} fold="waiting" folds={folds}>
          <WaitingList rows={waiting} onAnswered={onWaitingAnswered} />
        </Block>
      )}

      {/* Above the place card, open by default, with a girder head like
          every other block: it was a small fold line at the very foot of the
          column, shut, and players reported not finding what they could do
          with an item. It draws its own head, since the fold lives in it. */}
      <Things groups={things} framed />

      <Block head={place?.name ?? "Place"} fold="place" folds={folds}>
        <PlaceCard
          place={place}
          zone={zone}
          lines={placeLines}
          fixtures={fixtures}
          onFixture={openFixture}
          onConverse={openConverse}
          depotHref={depotHref}
          onFactory={canSeeExtract && openAction ? () => openAction("extract") : null}
          onOpenMap={onOpenMap}
          pending={pending}
          showTitle={false}
        />
        {/* A server string, RENDERED not printed — some carry `-#`/`**`,
            since the same sentence also goes out to Discord. */}
        {notice && (
          <div className="chat-quiet-line">
            <ChatMarkdown content={notice} />
          </div>
        )}
        <FormError>{error}</FormError>
      </Block>

      {/* BELOW the place card on purpose (MAP.md §3a): it fetches its party on
          mount, so above the card the Location's prose would jump every visit.
          Framed by itself rather than in a Block: it hides itself entirely
          when there is nobody to bring, and a "Party" girder over nothing would
          be a permanent empty box for most players. */}
      <PartyRack framed />

      {dialog === "move" && (
        <MoveDialog
          turn={moveState.turn}
          characterId={moveState.characterId}
          existing={moveState.move?.editable ? moveState.move : null}
          onClose={() => setDialog(null)}
          onDone={(res) => {
            setDialog(null);
            onWaitingAnswered();
            placeSay?.(res);
          }}
        />
      )}

      {/* Outside every block on purpose: a dialog opened from one must not
          unmount because the reader scrolled past another. */}
      {dialogs}
    </div>
  );
}
