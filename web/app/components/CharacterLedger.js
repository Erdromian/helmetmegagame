"use client";

import { TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import PageShell from "@/app/components/PageShell";
import ActionGrid from "./ActionGrid";
import BioForm from "./BioForm";
import CharacterPoller from "./CharacterPoller";
import EquipmentPanel from "./EquipmentPanel";
import GoalsPanel from "./GoalsPanel";
import LedgerBand from "./LedgerBand";
import LedgerWork from "./LedgerWork";
import RequestActionsProvider from "./RequestActionsProvider";
import RichText from "./RichText";
import SoundTrumpetButton from "./SoundTrumpetButton";
import StandingHerePanel from "./StandingHerePanel";
import TagsPanel from "./TagsPanel";

// The second character sheet, at /ledger — superadmin-only while it is being
// worked on, so it can be iterated in production without a player meeting a
// half-finished page (web/app/(app)/ledger/page.js holds that gate).
//
// It takes the SAME prop bag CharacterSheet.js takes, built once in
// character/page.js and handed to whichever layout is drawing. That is the
// whole point of the arrangement: two layouts over one load, so the two
// sheets can never disagree about what a character is carrying.
//
// The difference is the frame. /character is a wide working column with a
// narrow bio rail; this is a banner of numbers over three columns — bio on
// the left, everything you DO in the middle, and the tags spread down a rail
// on the right as one card per category instead of one card of sections.
export default function CharacterLedger({
  character,
  mode,
  currentAction,
  openTurn,
  avatarSrc,
  transferParties,
  transferSilo,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  travellingTo = null,
  examineBlocked = null,
  // Six flags the page computes off your own sheet and the provider gates
  // buttons on. They were passed here and dropped for a while, which is why
  // the Nuclear Datacard never showed its buttons: the provider's default
  // `false` won, silently.
  canCrucify = false,
  canDisguise = false,
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
  hasMulligan = false,
  canSeeExtract = false,
  canExtract = false,
  extractBlocked = null,
  canSeePackage = false,
  lootTargets = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  equipSlots = 6,
  avatarUploadsEnabled = false,
  playPanelEnabled = true,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection = null,
  hasCustomAvatar = false,
  // { name, tagName } while a held tag fixes the character's presented name
  // and face (Tag.forcedName); null otherwise. Self sheet only.
  forcedIdentity = null,
  lastNameLocked = false,
  // The mid-game Store, folded into the Tags panel as a modal (see
  // TagsPanel.js / StorePanel.js). Absent on someone else's sheet.
  storeTags = null,
  storeHeldTags = null,
  // The seat, so the store's shelf can drop a tag this role may never buy
  // (Tag.excludedRoleSlugs). Null on someone else's sheet, like the two above.
  storeRoleSlug = null,
}) {
  const isSelf = mode === "self";
  // Held, not equipped: you pick a trumpet up to blow it. Same derivation
  // StatusPanel.js makes, off the same array.
  const hasTrumpet = character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === TRUMPET_SLUG);

  return (
    <PageShell width="wide">
      {isSelf && <CharacterPoller deployVersion={deployVersion} />}

      <div className="flex flex-col gap-4">
        <LedgerBand
          character={character}
          avatarSrc={avatarSrc}
          carry={carry}
          zoneMoves={zoneMoves}
          zoneMovesReason={zoneMovesReason}
          travellingTo={travellingTo}
          currentAction={currentAction}
          openTurn={openTurn}
          pendingOffers={pendingOffers}
        />

        {/* One provider around the whole grid, not around one column: the
            Actions rack in the middle and the consumable chips in the rail
            both open their dialogs through it, and they are three columns
            apart. */}
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
          hasDatacard={hasDatacard}
          hasDevice={hasDevice}
          isThanati={isThanati}
          isThanatiLeader={isThanatiLeader}
          atHideout={atHideout}
          hideoutRooms={hideoutRooms}
          hideoutStock={hideoutStock}
          thanatiWares={thanatiWares}
        >
          <div className="ledger-body">
            <div className="ledger-col">
              {isSelf ? (
                <section className="panel p-4">
                  <h2 className="panel-header">Bio</h2>
                  <BioForm
                    character={character}
                    lastNameLocked={lastNameLocked}
                    hasMulligan={hasMulligan}
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

            <div className="ledger-col">
              {isSelf && (
                <section className="panel p-4">
                  <h2 className="panel-header">Actions</h2>
                  <ActionGrid />
                  {hasTrumpet && <SoundTrumpetButton />}
                </section>
              )}

              <EquipmentPanel
                characterTags={character.tags}
                slots={equipSlots}
                isSelf={isSelf}
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

              {isSelf && <LedgerWork craftProjects={craftProjects} sitesHere={sitesHere} />}

              <StandingHerePanel sites={sitesHere} />
            </div>

            <div className="ledger-col ledger-rail">
              <TagsPanel
                variant="rail"
                showEquipment={false}
                characterTags={character.tags}
                isSelf={isSelf}
                tagPoints={character.tagPoints}
                currentTurn={openTurn?.number ?? null}
                equipSlots={equipSlots}
                storeTags={storeTags}
                storeHeldTags={storeHeldTags}
                storeRoleSlug={storeRoleSlug}
                nukeArmedTurn={nukeArmedTurn}
              />
            </div>
          </div>
        </RequestActionsProvider>
      </div>
    </PageShell>
  );
}
