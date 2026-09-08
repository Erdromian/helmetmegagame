import BioForm from "./BioForm";
import GoalsPanel from "./GoalsPanel";
import StatusPanel from "./StatusPanel";
import RequestActionsProvider from "./RequestActionsProvider";
import TagsPanel from "./TagsPanel";
import CharacterPoller from "./CharacterPoller";
import RichText from "./RichText";
import PageShell from "@/app/components/PageShell";


export default function CharacterSheet({
  character,
  mode,
  currentAction,
  openTurn,
  // avatarSrc is still in the shared prop bag for CharacterLedger's band; the
  // sheet's own face moved to the page header (character/layout.js).
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
  // The Mulligan Potion this character is holding, if any, plus the name
  // parts that seed its dialog — resolved in character/page.js so no slug
  // matching reaches the browser. Null with no bottle held.
  identity = null,
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
  // The mid-game Store, folded into the Tags panel as a modal (see
  // TagsPanel.js / StorePanel.js). Absent on someone else's sheet.
  storeTags = null,
  storeHeldTags = null,
  // The seat, so the store's shelf can drop a tag this role may never buy
  // (Tag.excludedRoleSlugs). Null on someone else's sheet, like the two above.
  storeRoleSlug = null,
}) {
  const isSelf = mode === "self";

  return (
    // No header here. The name, the role, the faction and the face are the
    // bar at the top of the page now, drawn by (app)/character/layout.js so
    // this page starts at the same height as every other one.
    <PageShell width="wide">

      {/* Two real columns, not panels flowed by guessed height. The left
          column is the wide working column — tags/equipment first (what a
          player checks most), then the two small self-forms below it. The
          right column is a fixed-width rail that stays put while the left
          column scrolls past it, the same sticky treatment PointBuy.js uses
          for its own build-list aside. Below `md` both collapse into one
          stacked column, tags-and-status first since that's what a player on
          their phone actually wants — not a form. */}
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          {/* Every player action — the icon grid in StatusPanel and the
              chip-click-to-consume path in TagsPanel — reads its opener off
              this provider. It wraps both because they are siblings: the
              buttons sit in the panel ABOVE the one that needs to drive them,
              so the state can't live in either. Not mounted on someone else's
              sheet, which is what makes their chips read-only for free. */}
          {isSelf && <CharacterPoller deployVersion={deployVersion} />}
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
            <div className="flex flex-col gap-6">
              <StatusPanel
                character={character}
                isSelf={isSelf}
                currentAction={currentAction}
                openTurn={openTurn}
                carry={carry}
                zoneMoves={zoneMoves}
                zoneMovesReason={zoneMovesReason}
                travellingTo={travellingTo}
                pendingOffers={pendingOffers}
                sitesHere={sitesHere}
                craftProjects={craftProjects}
              />

              <TagsPanel
                characterTags={character.tags}
                isSelf={isSelf}
                identity={identity}
                tagPoints={character.tagPoints}
                currentTurn={openTurn?.number ?? null}
                equipSlots={equipSlots}
                storeTags={storeTags}
                storeHeldTags={storeHeldTags}
                storeRoleSlug={storeRoleSlug}
                nukeArmedTurn={nukeArmedTurn}
              />
            </div>
          </RequestActionsProvider>

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
        </div>

        <div className="flex flex-col gap-6 md:sticky md:top-4">
          {isSelf && (
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
          )}

          {!isSelf && character.appearance && (
            <section className="panel p-4">
              <h2 className="panel-header">Appearance</h2>
              <p className="text-sm">
                <RichText text={character.appearance} />
              </p>
            </section>
          )}
        </div>
      </div>
    </PageShell>
  );
}
