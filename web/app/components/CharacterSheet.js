import BioForm from "./BioForm";
import GoalsPanel from "./GoalsPanel";
import StatusPanel from "./StatusPanel";
import RequestActionsProvider from "./RequestActionsProvider";
import TagsPanel from "./TagsPanel";
import CharacterPoller from "./CharacterPoller";
import RichText from "./RichText";
import FactionLink from "./FactionLink";
import PageShell, { PageHeader } from "@/app/components/PageShell";

// The header's avatar, rendered into PageHeader's `actions` slot. A plain
// image rather than a button — the portrait maker and avatar upload live in
// the Bio panel below, not up here.
function Avatar({ avatarSrc, name }) {
  return avatarSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarSrc}
      alt={name}
      className="h-16 w-16 object-cover"
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
      }}
    />
  ) : (
    <div
      aria-hidden="true"
      className="h-16 w-16"
      style={{
        background: "var(--field-bg)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
      }}
    />
  );
}

export default function CharacterSheet({
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
  canBindBook = false,
  bindBlocked = null,
  bookOptions = [],
  canCrucify = false,
  canDisguise = false,
  hasDatacard = false,
  hasDevice = false,
  // Same fate: BioForm's conceal toggle reads it, and it never arrived.
  concealGear = null,
  // World state the sheet shows: the bomb's countdown on its chip, and the
  // build this render came from, for the self-refresh poll.
  nukeArmedTurn = null,
  deployVersion = null,
  hasWorkshop = false,
  tagCatalog,
  desireSlots = 2,
  desireSlotLockTurns = 2,
  desireSlotStates = [],
  desireCatalog = [],
  desireFamilies = [],
  desireFamilyGroups = [],
  desireLockNotes = [],
  desireAddiction = null,
  desiresEnabled = true,
  canHeal = false,
  healsLeft = null,
  hasSurgicalSite = false,
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
  moveTargets = [],
  moveLocations = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  doseTargets = [],
  equipSlots = 6,
  avatarUploadsEnabled = false,
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

  return (
    <PageShell width="wide">
      <PageHeader
        title={character.name}
        subtitle={
          <>
            {character.roleTitle ?? "No role"} —{" "}
            <FactionLink
              factionId={character.factionId}
              name={character.faction?.name ?? "No faction"}
            />
          </>
        }
        actions={<Avatar avatarSrc={avatarSrc} name={character.name} />}
      />

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
            hasSurgicalSite={hasSurgicalSite}
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
            moveTargets={moveTargets}
            moveLocations={moveLocations}
            bindTargets={bindTargets}
            harmTargets={harmTargets}
            harmTags={harmTags}
            doseTargets={doseTargets}
            examineBlocked={examineBlocked}
            canBindBook={canBindBook}
            bindBlocked={bindBlocked}
            bookOptions={bookOptions}
            canCrucify={canCrucify}
            canDisguise={canDisguise}
            hasDatacard={hasDatacard}
            hasDevice={hasDevice}
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
              desiresEnabled={desiresEnabled}
            />
          )}
        </div>

        <div className="flex flex-col gap-6 md:sticky md:top-4">
          {isSelf && (
            <section className="panel p-4">
              <h2 className="panel-header">Bio</h2>
              <BioForm
                character={character}
                lastNameLocked={lastNameLocked}
                hasMulligan={hasMulligan}
                avatarUploadsEnabled={avatarUploadsEnabled}
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
