"use client";

import { useState } from "react";
import { MOTION_SICKNESS_SLUG, TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import BioForm from "./BioForm";
import CharacterPoller from "./CharacterPoller";
import EquipBoard from "./EquipBoard";
import GoalsPanel from "./GoalsPanel";
import HereList from "./HereList";
import LedgerBand from "./LedgerBand";
import LedgerWork from "./LedgerWork";
import RequestActionsProvider from "./RequestActionsProvider";
import RichText from "./RichText";
import StandingHerePanel from "./StandingHerePanel";
import TagRail from "./TagRail";

// The second character sheet, at /ledger — open to every player while it is
// being judged against /character, which is still the real one. See
// docs/systemdocs/SHEET.md.
//
// It takes the SAME prop bag CharacterSheet.js takes, built once in
// character/page.js and handed to whichever layout is drawing. That is the
// whole point of the arrangement: two layouts over one load, so the two
// sheets can never disagree about what a character is carrying.
//
// The difference is the frame. /character is a page that scrolls; this fills
// the screen the way Chat does: a pinned band of numbers, the Move, the
// status and every verb, over three columns that each scroll on their own —
// bio on the left, the rig and what you are working on in the middle, and the
// tags down a rail on the right as one card per kind. On a phone the three
// columns are three tabs.

// The three columns as tabs, below the sheet's own breakpoint (globals.css).
const TABS = [
  ["you", "You"],
  ["do", "Do"],
  ["tags", "Tags"],
];

export default function CharacterLedger({
  character,
  mode,
  openTurn,
  avatarSrc,
  transferParties,
  transferSilo,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  travellingTo = null,
  examineBlocked = null,
  // Eight flags the page computes off your own sheet and the provider gates
  // buttons on. They were passed here and dropped for a while, which is why
  // the Nuclear Datacard never showed its buttons: the provider's default
  // `false` won, silently. Torture and Mutilate were dropped the same way,
  // and had never once rendered until they were added to this list.
  canCrucify = false,
  canDisguise = false,
  canTorture = false,
  canMutilate = false,
  hasDatacard = false,
  hasDevice = false,
  // The THANATI section (docs/systemdocs/THANATI.md), resolved in
  // character/page.js and handed straight through to the dialogs.
  isThanati = false,
  isThanatiLeader = false,
  atHideout = false,
  hideoutRooms = [],
  hideoutStock = null,
  thanatiWares = [],
  // Same fate: BioForm's conceal toggle reads it, and it never arrived.
  concealGear = null,
  // World state the sheet shows: the bomb's countdown on its chip, and the
  // build this render came from, for the self-refresh poll.
  nukeArmedTurn = null,
  deployVersion = null,
  hasWorkshop = false,
  tagCatalog,
  desireSlots = 2,
  desireSlotLockTurns = 1,
  desireSlotStates = [],
  desireCatalog = [],
  desireFamilies = [],
  desireFamilyGroups = [],
  desireLockNotes = [],
  desireAddiction = null,
  canHeal = false,
  healsLeft = null,
  // Lessons and Craft (LESSONS.md, CRAFTING.md), all built in character/page.js.
  hasMoved = false,
  canTeach = false,
  knownRecipeIds = [],
  deathMaskCorpses = [],
  craftProjects = [],
  // The turn's craft Move ledger and each ration's free units left, both
  // computed in character/page.js (web/lib/craftBudget.js).
  craftBudget = null,
  craftAllowances = {},
  // Building (db/lib/structures.js): what stands at this Location, and
  // whether the ground takes anything new. Both built in character/page.js.
  sitesHere = [],
  buildable = false,
  teachers = [],
  learners = [],
  confessors = [],
  mySins = [],
  pendingOffers = [],
  hasBird = false,
  canRead = false,
  canWrite = false,
  hasSeal = false,
  canSeal = false,
  paperOptions = [],
  letterOptions = [],
  sealOptions = { stamps: [], letters: [] },
  birdSentToday = false,
  birdTargets = [],
  birdZones = [],
  healTargets = [],
  healParties = null,
  // Everyone and everything in this character's zone worth acting on, built
  // once in character/page.js so the Actions dialogs can't disagree about who
  // is standing here. Empty on someone else's sheet.
  corpses = [],
  canButcher = false,
  identity = null,
  canSeeExtract = false,
  canExtract = false,
  extractBlocked = null,
  canSeePackage = false,
  lootTargets = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  avatarUploadsEnabled = false,
  playPanelEnabled = true,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection = null,
  hasCustomAvatar = false,
  // { name, tagName } while a held tag fixes the character's presented name
  // and face (Tag.forcedName); null otherwise. Self sheet only.
  forcedIdentity = null,
  // The mid-game Store, folded into the Tags panel as a modal (see
  // TagsPanel.js / StorePanel.js). Absent on someone else's sheet.
  storeTags = null,
  storeHeldTags = null,
  // The seat, so the store's shelf can drop a tag this role may never buy
  // (Tag.excludedRoleSlugs). Null on someone else's sheet, like the two above.
  storeRoleSlug = null,
  // The turn card's first paint: { turn, move } from play/actions.js#myMove,
  // read by character/page.js beside everything else.
  moveState = null,
}) {
  const isSelf = mode === "self";
  // Held, not equipped: you pick a trumpet up to blow it. Same derivation
  // StatusPanel.js makes, off the same array.
  const hasTrumpet = character.tags?.some(
    (ct) => (ct?.tag?.slug ?? ct?.slug) === TRUMPET_SLUG,
  );
  // The two facts the rig needs beyond the slot rule, because equipActions.js
  // refuses on them too: a cart is not set up indoors, and a queasy stomach
  // rules out riding anything at all.
  const indoors = Boolean(character.location?.indoors);
  const motionSick = Boolean(
    character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === MOTION_SICKNESS_SLUG),
  );
  const [tab, setTab] = useState("you");

  return (
    <div className="sheet-body">
      {isSelf && <CharacterPoller deployVersion={deployVersion} />}

      {/* One provider around the band AND the grid: the verb strip in the
            band, the rows' verbs in the rail and the wound's Heal all open
            their dialogs through it, and they are a screen apart. */}
      <RequestActionsProvider
        enabled={isSelf}
        selfId={character.id}
        selfName={character.name}
        catalog={tagCatalog ?? []}
        characterTags={character.tags}
        resources={character.resources}
        transferParties={transferParties}
        transferSilo={transferSilo}
        carry={carry}
        hasWorkshop={hasWorkshop}
        canHeal={canHeal}
        healsLeft={healsLeft}
        hasMoved={hasMoved}
        canTeach={canTeach}
        knownRecipeIds={knownRecipeIds}
        deathMaskCorpses={deathMaskCorpses}
        craftProjects={craftProjects}
        craftBudget={craftBudget}
        craftAllowances={craftAllowances}
        sitesHere={sitesHere}
        buildable={buildable}
        teachers={teachers}
        learners={learners}
        confessors={confessors}
        mySins={mySins}
        hasBird={hasBird}
        canRead={canRead}
        canWrite={canWrite}
        hasSeal={hasSeal}
        canSeal={canSeal}
        paperOptions={paperOptions}
        letterOptions={letterOptions}
        sealOptions={sealOptions}
        birdSentToday={birdSentToday}
        birdTargets={birdTargets}
        birdZones={birdZones}
        healTargets={healTargets}
        healParties={healParties}
        corpses={corpses}
        canButcher={canButcher}
        canSeeExtract={canSeeExtract}
        canExtract={canExtract}
        extractBlocked={extractBlocked}
        canSeePackage={canSeePackage}
        lootTargets={lootTargets}
        bindTargets={bindTargets}
        harmTargets={harmTargets}
        harmTags={harmTags}
        examineBlocked={examineBlocked}
        canCrucify={canCrucify}
        canDisguise={canDisguise}
        canTorture={canTorture}
        canMutilate={canMutilate}
        hasDatacard={hasDatacard}
        hasDevice={hasDevice}
        isThanati={isThanati}
        isThanatiLeader={isThanatiLeader}
        atHideout={atHideout}
        hideoutRooms={hideoutRooms}
        hideoutStock={hideoutStock}
        thanatiWares={thanatiWares}
      >
        <LedgerBand
          character={character}
          avatarSrc={avatarSrc}
          carry={carry}
          zoneMoves={zoneMoves}
          zoneMovesReason={zoneMovesReason}
          travellingTo={travellingTo}
          openTurn={openTurn}
          moveState={moveState}
          pendingOffers={pendingOffers}
          craftProjects={craftProjects}
          sitesHere={sitesHere}
          hasTrumpet={hasTrumpet}
          isSelf={isSelf}
        />

        <div className="tab-bar sheet-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="tab-item"
              data-active={tab === key ? "true" : undefined}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ledger-body" data-tab={tab}>
          <div className="ledger-col" data-col="you">
            {isSelf ? (
              <section className="panel p-4">
                <h2 className="panel-header">Bio</h2>
                <BioForm
                  character={character}
                  avatarUploadsEnabled={avatarUploadsEnabled}
                  playPanelEnabled={playPanelEnabled}
                  portraitMakerEnabled={portraitMakerEnabled}
                  portraitFantasyPartsEnabled={portraitFantasyPartsEnabled}
                  portraitSelection={portraitSelection}
                  hasCustomAvatar={hasCustomAvatar}
                  forcedIdentity={forcedIdentity}
                  concealGear={concealGear}
                />
              </section>
            ) : (
              character.appearance && (
                <section className="panel p-4">
                  <h2 className="panel-header">Appearance</h2>
                  <p className="text-sm">
                    <RichText text={character.appearance} />
                  </p>
                </section>
              )
            )}
          </div>

          <div className="ledger-col" data-col="do">
            {/* Who is standing here, with the same menu /play's column has —
                so Bind, Loot, Heal and the rest start from the person rather
                than from a picker. No seed: the list is read on mount, which
                is the click that asked. It leads this column because the
                verbs under it are mostly things you do TO somebody. */}
            {isSelf && (
              <section className="panel p-4">
                <h2 className="panel-header">Who&apos;s here</h2>
                <HereList people={null} selfId={character.id} poll />
              </section>
            )}

            <EquipBoard
              characterTags={character.tags}
              isSelf={isSelf}
              indoors={indoors}
              motionSick={motionSick}
            />

            {isSelf && (
              <GoalsPanel
                desireSlots={desireSlots}
                slotLockTurns={desireSlotLockTurns}
                slotStates={desireSlotStates}
                catalog={desireCatalog}
                families={desireFamilies}
                familyGroups={desireFamilyGroups}
                lockNotes={desireLockNotes}
                addiction={desireAddiction}
                openTurnNumber={openTurn?.number ?? null}
              />
            )}

            {isSelf && (
              <LedgerWork craftProjects={craftProjects} sitesHere={sitesHere} />
            )}

            <StandingHerePanel sites={sitesHere} />
          </div>

          <div className="ledger-col ledger-rail" data-col="tags">
            <TagRail
              characterTags={character.tags}
              isSelf={isSelf}
              selfId={character.id}
              identity={identity}
              tagPoints={character.tagPoints}
              tagCatalog={tagCatalog ?? []}
              currentTurn={openTurn?.number ?? null}
              storeTags={storeTags}
              storeHeldTags={storeHeldTags}
              storeRoleSlug={storeRoleSlug}
              nukeArmedTurn={nukeArmedTurn}
            />
          </div>
        </div>
      </RequestActionsProvider>
    </div>
  );
}
