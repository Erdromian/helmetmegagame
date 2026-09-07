"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  sortTagsForMenu,
  sortForMode,
  menuCategories,
  formatCost,
  costColor,
  filterTagsByQuery,
  tagsById as buildTagsById,
  heldHigherTiers,
  prerequisiteNames,
  hasPrerequisite,
} from "@/lib/characterCreation";
import {
  craftableTags,
  destroyableTags,
  transferableTags,
  packableTags,
  consumableTags,
  addRequirementSatisfied,
  placementOfferedHere,
  craftFamily,
} from "@/lib/tagRequests";
// The craft Move budget. Pure arithmetic, no prisma — the same module the
// server enforces with, so the dialog's numbers and the server's refusals
// come from one place (docs/systemdocs/CRAFTING.md §2a).
import {
  WHOLE_MOVE,
  craftFamilyLabel,
  craftMoveCost,
  fitsInRemaining,
  formatMoveFraction,
  unitsAffordable,
} from "@/lib/craftBudget";
import RequestDialog from "./RequestDialog";
import CheckField from "./CheckField";
import PartySelect from "./PartySelect";
import TransferDialog from "./TransferDialog";
import CraftDialog from "./CraftDialog";
import { titleFor } from "./actionRegistry";
import Select from "./Select";
import ChipText from "./ChipText";
import ExamineDialog from "./ExamineDialog";
import QuantityField, { parseQuantity } from "./QuantityField";
import { ENGRAVE_RESOURCE_COST } from "@/lib/constants";
import { useConfirm } from "./ConfirmProvider";
import { useTags } from "./TagsProvider";
import { heldSlugsOf } from "@/lib/consumeGrants";
import { scoreMatch } from "@/lib/fuzzySearch";
import { CUSTOM_SURCHARGE, customCraftFields } from "@/lib/customCraft";
import { workLabel } from "@/lib/recipeCatalog";
import {
  craftRequest,
  continueCraft,
  cancelCraft,
  joinBuildSite,
  cancelBuildSite,
  destroyTagRequest,
  learnRequest,
  teachRequest,
  confessRequest,
  transferRequest,
  consumeTagRequest,
  healCharacterRequest,
  lootCharacterRequest,
  moveCharacterRequest,
  bindCharacterRequest,
  freeCharacterRequest,
  crucifyCharacterRequest,
  tortureCharacterRequest,
  mutilateRequest,
  disguiseSelfRequest,
  harmCharacterRequest,
  buryCharacterRequest,
  butcherCorpseRequest,
  engraveHeadstoneRequest,
  birdMessageRequest,
  extractGodfleshRequest,
  packageItemsRequest,
} from "../(app)/character/requestActions";
import { readPointer, armNuke, disarmNuke } from "@/app/(app)/character/nukeActions";
import { recallComrades, recoverEquipment, setHideout, purchaseGear } from "@/app/(app)/character/thanatiActions";
// Writing and sealing file no Request, so they live apart from the rest —
// see web/app/(app)/character/paperActions.js.
import {
  writePaper,
  sealLetter,
  readMyPaper,
} from "../(app)/character/paperActions";
// Safe from a client component: db/lib/constants.js is a leaf of bare strings
// and numbers with no requires at all, so importing it drags no part of the
// @lifeweb/db barrel into the bundle.
import { PACKAGE_MAX_LBS, PACKAGE_LABEL_MAX } from "@lifeweb/db/lib/constants";
// Safe in a "use client" bundle for the same reason constants.js is: paper.js
// requires only ./reading -> ./examineVision, and neither touches prisma. One
// definition, so the counter under the box and the server's own cap agree.
import { WRITE_MAX, BOOK_MAX, TITLE_MAX } from "@lifeweb/db/lib/paper";
// Prisma-free on purpose, so importing it here does not drag the @lifeweb/db
// barrel into the browser bundle. See the note at the top of db/lib/mutilate.js.
import { MUTILATE_PARTS } from "@lifeweb/db/lib/mutilate";
import PaperSheet from "./PaperSheet";

// Every player action on the character sheet: mode state, the menus each
// mode draws from, and one RequestDialog per mode. Renders no chrome of its
// own — mounted once per sheet (CharacterSheet.js, self mode only), read
// off context by ActionGrid.js and TagsPanel.js.

const RequestActionsContext = createContext(null);

export function useRequestActions() {
  return useContext(RequestActionsContext);
}

// The tag menu. Craft reuses PointBuy's category-tab layout without
// PointBuy's budget/tier-chain math. `byId`/`heldIds` (Craft menu only) gate
// prerequisites; the other menus just list what's already held.
function TagPicker({
  tags,
  selectedId,
  onSelect,
  byId = null,
  heldIds = null,
  emptyLabel = "Nothing available.",
  // (tag) => why this row can't be picked right now, or null. Craft's Move
  // budget uses it; the row stays listed and says why rather than vanishing,
  // because "where did my recipe go" is a worse question than a greyed row.
  blockedReason = null,
}) {
  const [query, setQuery] = useState("");

  // The Craft menu (byId set) sorts chain-aware so tier rungs read in order;
  // held-tag menus keep flat cost-then-name sort.
  const offered = useMemo(
    () => (byId ? sortForMode(tags, "group", byId) : sortTagsForMenu(tags)),
    [tags, byId],
  );
  // Gate first, derive tabs from what survives — a hidden category gets no
  // tab at all. Craft-gate only (recipe skills were already checked server-
  // side — the page hands down `knownRecipeIds`); not requirementSatisfied().
  const unlocked = useMemo(
    () =>
      byId
        ? offered.filter((t) => addRequirementSatisfied(t, byId, heldIds ?? []))
        : offered,
    [offered, byId, heldIds],
  );
  // "Unlocked by your tags": everything shown already passed the gates.
  const [requiresOnly, setRequiresOnly] = useState(false);
  const gated = useMemo(
    () => (byId && requiresOnly ? unlocked.filter(hasPrerequisite) : unlocked),
    [unlocked, byId, requiresOnly],
  );
  const pool = useMemo(() => filterTagsByQuery(gated, query), [gated, query]);
  const categories = useMemo(() => menuCategories(pool), [pool]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];
  const visible = pool.filter((t) => t.category === active);

  if (!unlocked.length)
    return <p className="text-sm text-muted">{emptyLabel}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field min-w-40 flex-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, description, or group"
          />
        </label>
        {byId && (
          <CheckField
            checked={requiresOnly}
            onChange={(e) => setRequiresOnly(e.target.checked)}
            className="pb-2"
          >
            Unlocked by your tags
          </CheckField>
        )}
      </div>

      {categories.length > 1 && (
        <div className="tab-bar">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className="tab-item"
              data-active={c === active}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* The pane scrolls itself rather than growing the dialog, so the
          reason field and the Confirm button stay reachable however long
          Items gets — the same treatment PointBuy.js gives its own catalog. */}
      <div
        className="flex flex-col gap-2 overflow-y-auto pr-1"
        style={{ maxHeight: "60vh" }}
      >
        {visible.map((tag) => {
          const isSelected = tag.id === selectedId;
          const blocked = blockedReason?.(tag) ?? null;
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={isSelected}
              disabled={Boolean(blocked)}
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className="select-card panel flex w-full items-start gap-3 p-3 text-left"
              style={{
                borderLeftColor: tag.group?.color ?? undefined,
                borderLeftWidth: tag.group?.color ? 3 : undefined,
              }}
            >
              <span aria-hidden="true">{isSelected ? "◆" : "◇"}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-bold">{tag.name}</span>
                  {tag.pointCost ? (
                    <span
                      className="text-xs"
                      style={{ color: costColor(tag.pointCost) }}
                    >
                      {formatCost(tag.pointCost)} pts
                    </span>
                  ) : null}
                  {tag.group?.name ? (
                    <span className="text-xs text-muted">{tag.group.name}</span>
                  ) : null}
                </span>
                {/* ChipText rather than RichText — the row is a <button>, so a
                    hoverable chip inside it would nest one button in another. */}
                {tag.description && (
                  <ChipText
                    text={tag.description}
                    as="span"
                    className="mt-1 block text-xs text-muted"
                  />
                )}
                {/* The gate that unlocked this row — role/faction kit would
                    otherwise be indistinguishable from the open catalog.
                    Only qualifying viewers ever see the row. */}
                {prerequisiteNames(tag).length > 0 && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    Requires: {prerequisiteNames(tag).join(", ")}
                  </span>
                )}
                {/* The recipe: what it costs and what it needs — work, ⬢,
                    skills, INGREDIENTS — all of it the price tag, not a
                    warning. Everything listed already passed the skill check
                    server-side. workLabel is the same words the Recipes tab
                    prints, so the two surfaces cannot disagree. Craft menu
                    only. */}
                {byId && tag.craftable && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {[
                      // Null for a 0-turn recipe — no Move requirement, so
                      // none is listed.
                      ...(workLabel(tag) ? [workLabel(tag)] : []),
                      `${tag.requirementResources ?? 0} ⬢`,
                      ...((tag.requirementSkills ?? []).length
                        ? [tag.requirementSkills.map((s) => s.name).join(", ")]
                        : []),
                      ...(() => {
                        const items = tag.requirementItems ?? [];
                        const spends = items
                          .filter((i) => !i.keep)
                          .map((i) => ((i.count ?? 1) > 1 ? `${i.label} ×${i.count}` : i.label));
                        const keeps = items.filter((i) => i.keep).map((i) => i.label);
                        return [
                          ...(spends.length ? [`uses ${spends.join(" + ")}`] : []),
                          ...(keeps.length ? [`needs ${keeps.join(" + ")} to hand`] : []),
                        ];
                      })(),
                    ].join(" · ")}{" "}
                  </span>
                )}
                {/* A placement is raised on the ground rather than handed
                    over, so the row says where it ends up before the recipe
                    line's turns and ⬢ are read as a pocketable thing. */}
                {byId && tag.placement && (
                  <span className="mt-1 block text-xs text-muted">
                    Built where you stand
                  </span>
                )}
                {blocked && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {blocked}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-muted">
            {query
              ? "Nothing matches that."
              : "Nothing available in this category."}
          </p>
        )}
      </div>
    </div>
  );
}

// "Nobody qualifies" line — never used to hide the action itself; see
// ActionGrid.js on why a greyed button would be its own leak.
// A corpse is identified by its tag AND where it stands: the same Nekker
// Corpse row can be lying in two different rooms, and picking "that one" has
// to mean one of them.
function corpseIdOf(corpse) {
  return `${corpse.tagId}@${corpse.sourceKey}`;
}

// What butchering this one gives you, previewed before you commit. Client-side
// off the shared MONSTER_YIELDS map, which is why db/lib/corpses.js keeps its
// pure exports free of prisma — importing anything prisma-shaped into a
// "use client" module drags the barrel into the browser bundle.
function yieldLabel(corpse) {
  return CORPSE_YIELD_NAMES[corpse.yieldSlug] ?? "something";
}

// Display names for the four yields, kept here rather than fetched: the
// dialog needs a word, not a catalog row.
const CORPSE_YIELD_NAMES = {
  "nekker-pheromones": "Nekker Pheromones",
  "graga-sac": "a Graga Sac",
  "skinless-brain": "a Skinless Brain",
  "human-flesh": "Human Flesh",
};

function NobodyHere({ children }) {
  return <p className="text-sm text-muted">{children}</p>;
}

// Maps a "kind:id" party key back to a name for the confirm prompt.
function payerLabel(parties, key) {
  const [kind, id] = (key ?? "").split(":");
  const pool = kind === "room" ? parties?.rooms : parties?.characters;
  return pool?.find((p) => p.id === id)?.name ?? "They";
}

// The modes that are not Requests at all, and so never open RequestDialog.
// Each has its own modal below.
// Look at is the one mode that files no Request AND gets its own plain modal
// — a local dialog with nothing to review and nothing to undo. Write and Seal
// file no Request either, but they DO belong in the shared dialog: they have
// real fields, so they still use the shared dialog.
const NO_REQUEST_MODES = new Set(["examine"]);

// Mutilate's subject dropdown holds two id spaces in one control — the bound
// people standing here and the corpses in reach — so the value carries its own
// prefix, the way the Craft dialog's project/site picker does.
function mutilateKeyFor(kind, id) {
  return `${kind}:${id}`;
}

// Why a person is lootable: living cases come from INCAPACITATING_SLUGS
// (db/lib/incapacitation.js); a corpse says so plainly.
function targetNote(t) {
  if (t.status === "DEAD") return "Dead";
  return t.condition ?? "Helpless";
}

export default function RequestActionsProvider({
  children,
  // False on someone else's sheet — hooks still run unconditionally, but no
  // context/dialog is handed down, so TagsPanel's chips stay read-only.
  enabled = true,
  selfId,
  selfName,
  catalog = [],
  characterTags = [],
  resources = 0,
  transferParties = null,
  // Your faction's silo, when there is one and you are in its zone: a
  // deposit-only destination the Transfer dialog pins above the rooms here
  // (FACTIONS.md). Null the rest of the time.
  transferSilo = null,
  // Load vs caps for the Transfer dialog's projection line (CARRY.md).
  carry = null,
  // Why this character's eyes cannot look anyone over right now, or null.
  // Resolved server-side in character/page.js (db/lib/examineVision.js) —
  // examineActions.js refuses with the same sentence.
  examineBlocked = null,
  hasWorkshop = false,
  canHeal = false,
  healsLeft = null,
  healTargets = [],
  // Who can pay for a treatment or a craft: you, anyone here, rooms here.
  healParties = null,
  // Craft (CRAFTING.md): the recipe ids whose skills you hold, decided
  // server-side, and your projects in progress.
  knownRecipeIds = [],
  craftProjects = [],
  // The craft Move budget (CRAFTING.md §2a), both server-computed in
  // character/page.js. `craftBudget` is this turn's ledger — which family of
  // work the Routine is committed to and how much of the Move is left, or
  // null. `craftAllowances` is `{ [tagId]: { per, left } }` for every rationed
  // 0-turn recipe. Advisory: craftRequest re-checks all of it under a lock.
  craftBudget = null,
  craftAllowances = {},
  // Building (db/lib/structures.js). `sitesHere` is every structure at this
  // Location, all statuses; `buildable` is whether the ground takes anything
  // new at all. Both decided server-side in character/page.js, and both are
  // menu hygiene — openBuildSiteImpl re-checks each refusal.
  sitesHere = [],
  buildable = false,
  // Lessons (LESSONS.md): who could teach you what, and whom you could teach.
  canTeach = false,
  teachers = [],
  learners = [],
  // Confession (CONFESSION.md). `confessors` is who here can hear one;
  // `mySins` is my own psychological tags. There is no chaplain-side list.
  confessors = [],
  mySins = [],
  // Whether a Move is already filed this turn — a craft with turns needs one.
  hasMoved = false,
  // Built once in character/page.js so the four target menus can't disagree.
  lootTargets = [],
  moveTargets = [],
  moveLocations = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  // Corpses (CORPSES.md): every body in reach — yours and the ones lying in
  // rooms here — built once server-side by db/lib/corpses.js#corpsesInReach so
  // the menu and the two server re-checks can't disagree about what you can
  // touch. canButcher is just "do you hold the Butcher tag".
  corpses = [],
  canButcher = false,
  // The Bird. birdTargets is EVERY character, alive or dead, on purpose.
  hasBird = false,
  birdSentToday = false,
  birdTargets = [],
  birdZones = [],
  // Paperwork (docs/systemdocs/PAPERWORK.md). `canRead` is letters AND eyes,
  // resolved server-side so the button, the tag chip and the action's own
  // refusal all say the same thing. The option lists carry an EXCERPT rather
  // than the whole text, and only for a reader — the full text is fetched on
  // demand so an unreadable sheet never sits in the page source.
  canRead = false,
  canWrite = false,
  hasSeal = false,
  canSeal = false,
  paperOptions = [],
  // Everything the bird could carry: written notes AND sealed letters. A
  // courier does not have to be able to read what they are carrying, so this
  // is not gated on literacy — only the excerpts inside it are.
  letterOptions = [],
  sealOptions = { stamps: [], letters: [] },
  // Books (docs/systemdocs/PAPERWORK.md). No excerpts here — a book's name IS
  // its title, unlike a note's deliberately anonymous waybill code.
  // The Godard Factory (docs/systemdocs/FACTORY.md). All three are facts about
  // where this character is standing and what is in their hands, resolved
  // server-side in character/page.js — the actions re-check every one.
  canSeeExtract = false,
  canExtract = false,
  extractBlocked = null,
  canSeePackage = false,
  // Crucify: you hold `fundamentalist` and a COMPLETE Cross stands where you
  // are. Both facts about YOUR sheet and YOUR ground, resolved in
  // character/page.js; the action re-checks both.
  canCrucify = false,
  // Disguise: you are carrying a disguise kit. Hidden rather than greyed —
  // see actionRegistry.js.
  canDisguise = false,
  // Torture: you hold `torturer`. Your own sheet; the action re-checks it and
  // that the target is Bound.
  canTorture = false,
  canMutilate = false,
  // The datacard, and the device itself. Both facts about your own sheet.
  hasDatacard = false,
  hasDevice = false,
  // THE THANATI (docs/systemdocs/THANATI.md). Whether you are one and whether
  // you lead are your own sheet; the hideout is one you set. `hideoutRooms`
  // is Set Hideout's picker, `thanatiWares` / `hideoutStock` are Purchase
  // Gear's shelf and the purse on the hideout's floor.
  isThanati = false,
  isThanatiLeader = false,
  atHideout = false,
  hideoutRooms = [],
  hideoutStock = null,
  thanatiWares = [],
}) {
  const [mode, setMode] = useState(null);
  const [tagId, setTagId] = useState(null);
  const [quantity, setQuantity] = useState("1");
  // Craft: a project in progress, and what to do with it.
  const [projectId, setProjectId] = useState("");
  // A build site standing here, picked from the same dropdown as a project.
  const [siteId, setSiteId] = useState("");
  const [projectChoice, setProjectChoice] = useState("continue");
  // Which member of a recipe's `anyOf` ingredient goes in (Craft only).
  const [ingredientChoice, setIngredientChoice] = useState("");
  // The custom-item fields on a `customizable` recipe, and the builder's
  // line on an inscribable placement (CRAFTING.md). Raw as typed — the
  // shared cleaner (web/lib/customCraft.js) decides what they amount to, on
  // both sides, so the +1 ⬢ shown is the +1 ⬢ billed.
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [inscription, setInscription] = useState("");
  const [recipient, setRecipient] = useState("");
  const [patientId, setPatientId] = useState("");
  const [payerKey, setPayerKey] = useState("");
  const [targetId, setTargetId] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [amount, setAmount] = useState("1");
  // tagId -> quantity, for Loot. Always replaced wholesale, never mutated
  // (react-hooks/immutability is an error here).
  const [picks, setPicks] = useState({});
  // The Bird's guessed zone.
  const [zoneId, setZoneId] = useState("");
  // Move Player's destination.
  const [locationId, setLocationId] = useState("");
  const [lethal, setLethal] = useState(false);
  // Engrave types its target instead of picking it — a dropdown would be a
  // list of the dead, and this one searches every zone (REQUESTS.md §5d).
  // This input used to belong to Bury, which now picks a corpse instead.
  const [engraveName, setEngraveName] = useState("");
  // The false name typed into the Disguise dialog. Separate from engraveName
  // so switching modes never carries one name into the other dialog.
  const [disguiseName, setDisguiseName] = useState("");
  // Butcher and Bury both act on one corpse, identified by BOTH its tag and
  // where it is standing — the same body can be in two places for two people.
  const [corpseKey, setCorpseKey] = useState("");
  // Mutilate: the prefixed subject key (person:<id> / corpse:<tagId>|<sourceKey>)
  // and which part is coming off. It keeps its own key rather than sharing
  // corpseKey, because the same control also offers living people.
  const [mutilateKey, setMutilateKey] = useState("");
  const [mutilatePart, setMutilatePart] = useState(MUTILATE_PARTS[0].key);
  // Package: what goes in the crate, and the line printed on its side.
  // tagId -> quantity, replaced wholesale like `picks` above.
  const [packed, setPacked] = useState({});
  const [crateLabel, setCrateLabel] = useState("");
  const [birdBody, setBirdBody] = useState("");
  const [birdQuery, setBirdQuery] = useState("");
  // Which letter the bird carries. The Bird no longer holds text of its own —
  // it delivers a paper you are holding (docs/systemdocs/PAPERWORK.md).
  const [birdTagId, setBirdTagId] = useState("");
  // Write: which sheet, and what is being added to it. `paperExisting` is the
  // PaperSheet shape ({ kind, text, plain }) of what
  // is already on it, fetched when the sheet is chosen so it can be shown
  // read-only above the box — writing only ever appends.
  const [paperId, setPaperId] = useState("");
  const [paperBody, setPaperBody] = useState("");
  const [paperExisting, setPaperExisting] = useState(null);
  // Seal: which stamp, which letter.
  const [stampId, setStampId] = useState("");
  // Bind a Book: the title on the spine and everything inside it, written in
  // one pass because a bound book can never be added to.
  const [bookTitle, setBookTitle] = useState("");
  const [error, setError] = useState(null);
  // Set Hideout's room and Purchase Gear's cart (tagId -> quantity draft) and
  // which of the hideout floor's two purses pays.
  const [hideoutRoomId, setHideoutRoomId] = useState("");
  const [gearCart, setGearCart] = useState({});
  const [gearSource, setGearSource] = useState("obols");
  const gearLines = thanatiWares
    .map((w) => ({ ...w, quantity: parseQuantity(gearCart[w.tagId], { min: 0, max: 99 }) ?? 0 }))
    .filter((w) => w.quantity > 0);
  const gearTotal = gearLines.reduce((sum, w) => sum + w[gearSource] * w.quantity, 0);
  const gearPurse = hideoutStock?.[gearSource] ?? 0;
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const heldIds = useMemo(
    () => characterTags.map((ct) => ct.tagId),
    [characterTags],
  );
  // The catalog excludes gate-opening tags (Demoness). Fold in
  // held tags too, or a chain walk from a held gate tag dead-ends.
  const gateById = useMemo(
    () =>
      buildTagsById([
        ...catalog,
        ...characterTags.map((ct) => ct.tag).filter(Boolean),
      ]),
    [catalog, characterTags],
  );
  // heldHigherTiers hides rungs below a held chain tier — craftRequest
  // rejects the same thing server-side.
  // A site is only joinable while it is going up; the rest of sitesHere is
  // for the standing-here panel.
  const buildSites = useMemo(
    () => sitesHere.filter((s) => s.status === "UNDER_CONSTRUCTION"),
    [sitesHere],
  );
  const craftable = useMemo(
    () =>
      craftableTags(catalog, heldIds, knownRecipeIds)
        .filter((t) => heldHigherTiers(t, gateById, heldIds).length === 0)
        // A placement you could not raise on this ground is dropped rather
        // than offered and refused.
        .filter((t) =>
          placementOfferedHere(t, { buildable, sites: sitesHere }),
        ),
    [catalog, heldIds, knownRecipeIds, gateById, buildable, sitesHere],
  );
  const removable = useMemo(
    () => destroyableTags(characterTags),
    [characterTags],
  );
  const transferable = useMemo(
    () => transferableTags(characterTags),
    [characterTags],
  );
  const consumable = useMemo(
    () => consumableTags(characterTags),
    [characterTags],
  );
  const packable = useMemo(() => packableTags(characterTags), [characterTags]);
  // What the current selection weighs, against the 150 lb a crate holds. The
  // server recomputes it — this is the readout that stops somebody filling a
  // form they can't submit.
  const packedLbs = useMemo(
    () =>
      Object.entries(packed).reduce((sum, [id, q]) => {
        const row = packable.find((t) => t.id === id);
        // QuantityField keeps its value as a STRING, and a half-typed box is
        // "" — Number("") is 0, which is the right answer for a blank one.
        return sum + (row?.weightLbs ?? 0) * (Number(q) || 0);
      }, 0),
    [packed, packable],
  );

  // Heal's menus are per-patient, not per-tag, so they sit outside `chosen`
  // — an affliction row is server-built, not a catalog Tag.
  const patient = useMemo(
    () => healTargets.find((t) => t.id === patientId) ?? null,
    [healTargets, patientId],
  );
  const affliction = useMemo(
    () => patient?.healable.find((h) => h.tagId === tagId) ?? null,
    [patient, tagId],
  );
  // The room stashes here, in lootTargets' shape, keyed "room:<id>" so the
  // one picker can hold both and the submit can tell them apart. Same list
  // Transfer's From uses (accessibleRooms — locked rooms you can't open never
  // arrive), so looting a room is Transfer's room → you path under Loot's
  // button, which is where a player looks for it.
  const lootRooms = useMemo(
    () =>
      (transferParties?.rooms ?? []).map((r) => ({
        id: `room:${r.id}`,
        name: r.name,
        room: true,
        resources: r.resources ?? 0,
        tags: (r.tags ?? []).map((t) => ({
          tagId: t.tagId,
          tagName: t.name,
          stackable: t.stackable,
          quantity: t.quantity ?? 1,
        })),
      })),
    [transferParties],
  );
  const lootTarget = useMemo(
    () =>
      lootTargets.find((t) => t.id === targetId) ??
      lootRooms.find((r) => r.id === targetId) ??
      null,
    [lootTargets, lootRooms, targetId],
  );
  // Bind, Free, Torture and Crucify share one roster: Bind wants the untied,
  // Free and Torture the tied, Crucify anyone not already on the cross.
  const bindable = useMemo(
    () =>
      bindTargets.filter((t) =>
        mode === "bind"
          ? !t.bound
          : mode === "free" || mode === "torture"
            ? t.bound
            : !t.crucified,
      ),
    [bindTargets, mode],
  );

  // Mutilate's two rosters, in one list. The tied-up living come from the same
  // bindTargets pool Bind and Torture use; the bodies from the same corpses
  // list Butcher and Bury use. Monster corpses are left out rather than
  // offered and refused — the same posture Bury takes.
  const mutilateSubjects = useMemo(() => {
    const people = bindTargets
      .filter((t) => t.bound)
      .map((t) => ({ key: mutilateKeyFor("person", t.id), label: t.name, kind: "person" }));
    const bodies = corpses
      .filter((c) => c.human)
      .map((c) => ({
        key: mutilateKeyFor("corpse", corpseIdOf(c)),
        label: `${c.tagName} — ${c.source.name}`,
        kind: "corpse",
      }));
    return { people, bodies };
  }, [bindTargets, corpses]);

  const chosen = useMemo(() => {
    // heal/harm/learn/teach's tagId isn't a tag this character holds, so
    // they opt out.
    const pool =
      mode === "craft"
        ? craftable
        : mode === "destroy"
          ? removable
          : mode === "consume"
            ? consumable
            : mode === "heal" ||
                mode === "harm" ||
                mode === "learn" ||
                mode === "teach" ||
                mode === "confess"
              ? []
              : transferable;
    return pool.find((t) => t.id === tagId) ?? null;
  }, [mode, tagId, craftable, removable, transferable, consumable]);
  // Consume always takes one, so it opts out of the quantity field. So does a
  // placement: a structure is a place, not a stack, and openBuildSiteImpl
  // ignores the count anyway.
  const stacking =
    Boolean(chosen?.stackable) && mode !== "consume" && !chosen?.placement;
  const heldCount = mode === "craft" ? undefined : (chosen?.quantity ?? 1);

  // Lessons: the counterpart picked, and the skills on offer with them.
  const lessonPeople = mode === "teach" ? learners : teachers;
  const lessonPartner = useMemo(
    () => lessonPeople.find((p) => p.id === targetId) ?? null,
    [lessonPeople, targetId],
  );

  // Slug -> name for "Becomes:". A consumesIntoOneOf position isn't resolved
  // via resolveConsumeGrants here (that rolls a real pick); rendered as
  // "A or B" off the raw sidecar instead, so the preview stays honest.
  const { tagsBySlug } = useTags();
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);

  // Bird recipients filtered by typed text — dead stay in it; current pick kept.
  const birdChoices = useMemo(() => {
    const q = birdQuery.trim();
    if (!q) return birdTargets;
    return birdTargets.filter(
      (t) => t.id === targetId || scoreMatch(q, { name: t.name }),
    );
  }, [birdTargets, birdQuery, targetId]);
  const nameOf = (slug) => tagsBySlug.get(slug)?.name ?? slug;
  const becomes = (chosen?.consumesInto ?? [])
    .map((slug, i) => {
      const blockers = chosen?.consumesIntoUnless?.[slug] ?? null;
      if (blockers?.some((b) => heldSlugs.has(b))) return null;
      const alternatives = chosen?.consumesIntoOneOf?.[i];
      return Array.isArray(alternatives)
        ? alternatives.map(nameOf).join(" or ")
        : nameOf(slug);
    })
    .filter(Boolean);

  // An `anyOf` ingredient (Tag.requirementItems) is the one part of a recipe
  // the catalog cannot decide for the player: which delicacy goes into the
  // Lavish Meal. Only members they are actually holding are offered — the
  // server re-checks both membership and possession, so this is a shortlist,
  // not a gate. At most one per recipe; the sync refuses a second.
  const ingredientPick = useMemo(() => {
    if (mode !== "craft") return null;
    const entry = (chosen?.requirementItems ?? []).find(
      (i) => i?.kind === "anyOf",
    );
    if (!entry) return null;
    return {
      label: entry.label,
      options: (entry.options ?? []).filter((o) => heldSlugs.has(o.slug)),
    };
  }, [mode, chosen, heldSlugs]);
  // One option needs no decision, so it is taken as made rather than asked for.
  const ingredientChoiceValue =
    ingredientChoice ||
    (ingredientPick?.options.length === 1
      ? ingredientPick.options[0].slug
      : "");

  // --- Craft's Move budget ------------------------------------------------
  //
  // Everything here is a READOUT. The numbers come off the two server-computed
  // props, the arithmetic is the same module craftRequest enforces with, and
  // every refusal below is repeated server-side under a row lock. A greyed row
  // is a hint; the server is the lock.
  const craftQty =
    mode === "craft" && chosen?.stackable
      ? Math.max(1, Number(quantity) || 1)
      : 1;
  const craftRemaining = useMemo(
    () =>
      craftBudget
        ? { num: craftBudget.remainingNum, den: craftBudget.remainingDen }
        : hasMoved
          ? { num: 0, den: 1 }
          : WHOLE_MOVE,
    [craftBudget, hasMoved],
  );
  // What one recipe costs of the Move at a given count, priced against the
  // free units this turn has left.
  const priceRecipe = useCallback(
    (tag, units) =>
      craftMoveCost(tag, {
        quantity: units,
        allowance: craftAllowances[tag.id]?.per ?? null,
        freeLeft: craftAllowances[tag.id]?.left ?? null,
      }),
    [craftAllowances],
  );
  // Can the turn still pay for this? A free craft always can.
  const affordsMove = useCallback(
    (cost) => {
      if (!cost || cost.kind === "free") return true;
      if (cost.kind === "capped") return false;
      if (craftBudget && craftBudget.family !== cost.family) return false;
      return fitsInRemaining(cost, craftRemaining);
    },
    [craftBudget, craftRemaining],
  );
  const craftCost = useMemo(
    () => (mode === "craft" && chosen ? priceRecipe(chosen, craftQty) : null),
    [mode, chosen, craftQty, priceRecipe],
  );
  const craftAllowance = chosen ? (craftAllowances[chosen.id] ?? null) : null;
  const craftMoveOk = affordsMove(craftCost);
  // What the quantity stepper stops at: the ingredients on your own sheet, and
  // what the Move can still pay for. The 99 is craftRequest's own clamp.
  const heldBySlug = useMemo(
    () =>
      new Map(
        characterTags
          .filter((ct) => ct.tag?.slug)
          .map((ct) => [ct.tag.slug, ct.quantity ?? 1]),
      ),
    [characterTags],
  );
  // Why a recipe can't be picked at all right now. Ingredients first — a
  // spent ingredient you don't hold blocks the recipe Move or no Move, and
  // greyed-with-a-reason beats a refusal after the confirm. `group` entries
  // (a corpse to hand) stay the server's call. The Move questions are only
  // asked once the turn's Move is spoken for, so an untouched turn greys
  // nothing on that account.
  const recipeBlocked = useCallback(
    (tag) => {
      for (const item of tag.requirementItems ?? []) {
        if (item.keep || item.kind === "group") continue;
        const held =
          item.kind === "anyOf"
            ? (item.options ?? []).some((o) => (heldBySlug.get(o.slug) ?? 0) >= (item.count ?? 1))
            : (heldBySlug.get(item.slug) ?? 0) >= (item.count ?? 1);
        if (!held)
          return `You don't have the ${item.label || "ingredients"} it uses.`;
      }
      if (!hasMoved) return null;
      const cost = priceRecipe(tag, 1);
      if (cost.kind === "free" || affordsMove(cost)) return null;
      // A capped recipe hit its ration, not the Move — bone-mask past its
      // one-a-turn would otherwise be blamed on a Routine it never touches.
      if (cost.kind === "capped") {
        return "You've made all of those a turn allows.";
      }
      if (craftBudget && craftBudget.family !== cost.family) {
        return `Your Routine is ${craftFamilyLabel(craftBudget.family)} work this turn.`;
      }
      if (!craftBudget) return "You've already used your Move this turn.";
      return "There isn't enough of your Move left for that.";
    },
    [hasMoved, craftBudget, priceRecipe, affordsMove, heldBySlug],
  );
  const craftQuantityMax = useMemo(() => {
    if (mode !== "craft" || !chosen) return 99;
    let max = 99;
    for (const item of chosen.requirementItems ?? []) {
      if (item.keep || item.kind === "group") continue;
      const slug = item.kind === "anyOf" ? ingredientChoiceValue : item.slug;
      if (!slug) continue;
      max = Math.min(max, Math.floor((heldBySlug.get(slug) ?? 0) / (item.count ?? 1)));
    }
    const per = craftAllowances[chosen.id]?.per ?? null;
    const left = craftAllowances[chosen.id]?.left ?? 0;
    const family = craftFamily(chosen);
    const turns = chosen.requirementTurns ?? 1;
    const perTurn = chosen.requirementPerTurn ?? null;
    if (turns === 0 && per != null) {
      // Free units first, then whatever the Move can still buy at 1/per each.
      max = Math.min(
        max,
        family ? left + unitsAffordable(craftRemaining, per) : left,
      );
    } else if (turns === 1) {
      // The server's batch rule: `perTurn` or ONE per turn of work. A family
      // recipe stops where the Move does; the odd no-family one (holy water)
      // stops at the count itself.
      const batch = perTurn > 0 ? perTurn : 1;
      max = Math.min(
        max,
        family ? unitsAffordable(craftRemaining, batch) : batch,
      );
    } else {
      // A project's turns are per piece — it makes one at a time.
      max = 1;
    }
    return Math.max(1, max);
  }, [
    mode,
    chosen,
    heldBySlug,
    ingredientChoiceValue,
    craftAllowances,
    craftRemaining,
  ]);

  function pick(nextTagId) {
    setTagId(nextTagId);
    setQuantity("1");
    setIngredientChoice("");
    setCustomName("");
    setCustomDescription("");
    setInscription("");
  }

  // Loot takes a mix, so its picks are a checkbox set rather than one choice.
  function togglePick(id, held) {
    setPicks((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = String(Math.min(1, held) || 1);
      return next;
    });
  }
  function setPickQuantity(id, value) {
    setPicks((prev) => ({ ...prev, [id]: value }));
  }
  // Package's selection, same shape as `picks` above and for the same reason.
  function togglePacked(id, held) {
    setPacked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = String(Math.min(1, held) || 1);
      return next;
    });
  }
  function setPackedQuantity(id, value) {
    setPacked((prev) => ({ ...prev, [id]: value }));
  }

  // `presetTagId` lets a sheet-chip click open this dialog pre-selected.
  // `presets` seeds the one field a caller already knows: the Hall's people
  // column opens Heal or Loot from a person's own row, and asking them to
  // pick that person again out of a dropdown would be a worse dialog than
  // the sheet's. Only `targetId` / `patientId` / `toKey` / `fromKey` /
  // `picks` are seedable — everything else in a dialog is a decision, not a
  // context.
  const open = useCallback(
    (next, presetTagId = null, presets = null) => {
      setMode(next);
      setTagId(presetTagId);
      setQuantity("1");
      setProjectId("");
      setSiteId("");
      setProjectChoice("continue");
      setRecipient("");
      setPatientId("");
      setPayerKey(selfId ? `character:${selfId}` : "");
      setTargetId("");
      setFromKey(selfId ? `character:${selfId}` : "");
      setToKey("");
      // Transfer's ⬢ is optional, so it starts at nothing rather than one.
      setAmount(next === "transfer" ? "0" : "1");
      setPicks({});
      setPacked({});
      setCrateLabel("");
      setZoneId("");
      setLocationId("");
      setLethal(false);
      setEngraveName("");
      setDisguiseName("");
      setCorpseKey("");
      setMutilateKey("");
      setMutilatePart(MUTILATE_PARTS[0].key);
      setBirdBody("");
      setBirdQuery("");
      setBirdTagId("");
      setPaperId("");
      setPaperBody("");
      setBookTitle("");
      setCustomName("");
      setCustomDescription("");
      setInscription("");
      setPaperExisting(null);
      setStampId("");
      setHideoutRoomId("");
      setGearCart({});
      setGearSource("obols");
      setError(null);
      // After the resets above, never before — a preset is the exception to
      // the blank slate, not part of it.
      if (presets?.patientId) setPatientId(presets.patientId);
      if (presets?.targetId) setTargetId(presets.targetId);
      if (presets?.toKey) setToKey(presets.toKey);
      // Transfer's two ends and a first pick. The Hall's room panel opens this
      // dialog three ways — Drop, Take, and a click straight on a stack lying
      // in the room — and each of those is context the player has already
      // given by choosing the button, not a decision to ask for again.
      if (presets?.fromKey) setFromKey(presets.fromKey);
      if (presets?.picks) setPicks(presets.picks);
    },
    [selfId],
  );

  // Picking a sheet in the Write dialog fetches what is already on it, so the
  // box can show it read-only above the cursor. Fetched on demand rather than
  // shipped with the page: an unreadable sheet must never have its text
  // sitting in the page source where a blind or illiterate holder could read
  // it straight out of DevTools. The server re-checks the same gate.
  // Which of the two things you can start from scratch: a sheet, or a blank
  // book. A book takes a title and six times the text, and is finished for
  // good the moment it is written (db/lib/paperMint.js#bindBook).
  const writingBook = Boolean(paperOptions.find((o) => o.tagId === paperId)?.book);
  const writeMax = writingBook ? BOOK_MAX : WRITE_MAX;

  const choosePaper = useCallback(
    (nextId) => {
      setPaperId(nextId);
      setPaperExisting(null);
      const chosenPaper = paperOptions.find((o) => o.tagId === nextId);
      if (!nextId || chosenPaper?.blank || chosenPaper?.book) return;
      startTransition(async () => {
        const res = await readMyPaper(nextId);
        // A refusal shows in the box like anything else — the sentence is the
        // same "You can't read this" the chip gives, so nothing is disclosed.
        setPaperExisting(res?.ok ? (res.paper ?? { kind: res.kind ?? null, text: res.text, plain: false }) : null);
      });
    },
    [paperOptions],
  );

  // Heal-someone-else, Harm's lethal branch, Destroy and any Craft that
  // spends ⬢ or a Move ask twice. Confirm is awaited OUTSIDE
  // startTransition, or the dialog never renders.
  async function submit() {
    if (mode === "craft" && !projectId && !siteId && chosen) {
      const turns = chosen.requirementTurns ?? 1;
      const qty = craftQty;
      // The same price craftRequestImpl charges: custom words are
      // +CUSTOM_SURCHARGE ⬢ a unit, and the confirm must not quote less.
      const surcharge =
        chosen.customizable &&
        customCraftFields({ customName, customDescription }).active
          ? CUSTOM_SURCHARGE
          : 0;
      const cost = ((chosen.requirementResources ?? 0) + surcharge) * qty;
      const what = qty > 1 ? `${qty}× ${chosen.name}` : chosen.name;
      // What this costs of the Move, in the player's words. Three shapes: it
      // locks the Routine to a family of work, it spends from a lock already
      // taken, or — the new one — it spills past a free allowance into the
      // Move. Declining crafts nothing.
      const move = craftCost;
      const family = craftFamilyLabel(move?.family);
      const share =
        move && move.num < move.den
          ? `${formatMoveFraction(move.num, move.den)} of your Move`
          : "your whole Move for the turn";
      let moveLine = null;
      if (move && move.kind !== "free" && move.kind !== "capped") {
        if (move.kind === "whole" && !craftBudget) {
          moveLine = "This is your Move for the turn.";
        } else {
          const takes =
            move.freeQty > 0
              ? `The first ${move.freeQty} ${move.freeQty === 1 ? "is" : "are"} free; the rest take ${share}`
              : `That takes ${share}`;
          // A spill is the one Move spend a player may not have planned as
          // their day's work, so it alone says what a filed Action always
          // costs: the day's labor pay (CRAFTING.md §2a).
          const labor =
            move.freeQty > 0 && !craftBudget
              ? " That counts as your day's work — no labor pay today."
              : "";
          moveLine = craftBudget
            ? `${takes}, on top of the ${family} work you've already put this turn into.`
            : `${takes}. It locks the rest of your Routine to ${family} work — you can keep at that until the turn is spent.${labor}`;
        }
      }
      if (moveLine || cost > 0) {
        const ok = await confirm({
          title: turns > 1 ? "Start the work?" : "Make it?",
          message: [
            turns > 1
              ? `${what} takes ${turns} turns of work.`
              : `Make ${what}?`,
            cost > 0
              ? `${cost} ⬢ ${cost === 1 ? "is" : "are"} paid now by ${payerLabel(healParties, payerKey)}, and not refunded if you stop.`
              : null,
            moveLine,
            // The one-line Move note is signed-off copy; the budget wording is not.
            moveLine && moveLine !== "This is your Move for the turn." ? "" : "",
          ]
            .filter(Boolean)
            .join(" "),
          confirmLabel: turns > 1 ? "Start" : "Make it",
        });
        if (!ok) return;
      }
    }
    if (mode === "craft" && projectId && projectChoice === "cancel") {
      const name =
        craftProjects.find((p) => p.id === projectId)?.tagName ?? "the work";
      const ok = await confirm({
        title: "Give it up?",
        message: `${name} stays unfinished and whatever you paid for it is gone.`,
        confirmLabel: "Give it up",
      });
      if (!ok) return;
    }
    if (mode === "craft" && siteId && projectChoice === "cancel") {
      const name =
        buildSites.find((s) => s.id === siteId)?.typeName ?? "the work";
      const ok = await confirm({
        title: "Give it up?",
        message: `The ${name} is left where it stands, and the ⬢ that went into it are gone. Anyone else working on it loses that work too.`,
        confirmLabel: "Give it up",
      });
      if (!ok) return;
    }
    if (mode === "destroy" && chosen) {
      const ok = await confirm({
        title: "Destroy it?",
        message: `${chosen.name} is gone for good. Nothing comes back.`,
        confirmLabel: "Destroy",
      });
      if (!ok) return;
    }
    if (mode === "heal" && payerKey !== `character:${selfId}`) {
      const payerName = payerLabel(healParties, payerKey);
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction?.cost ?? 0} ⬢ for this treatment.`,
        confirmLabel: "Charge them",
      });
      if (!ok) return;
    }
    if (mode === "harm" && lethal) {
      const name = harmTargets.find((t) => t.id === targetId)?.name ?? "them";
      const ok = await confirm({
        title: "Finish them off?",
        message: `This kills ${name}, now and for good.`,
        confirmLabel: "Kill them",
      });
      if (!ok) return;
    }

    setError(null);
    startTransition(async () => {
      const res = await runAction();
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setMode(null);
    });
  }

  function runAction() {
    switch (mode) {
      case "craft":
        // A build site takes the same two verbs as a project, against the
        // structure instead of the CraftProject.
        if (siteId) {
          return projectChoice === "cancel"
            ? cancelBuildSite({ structureId: siteId })
            : joinBuildSite({ structureId: siteId });
        }
        if (projectId) {
          return projectChoice === "cancel"
            ? cancelCraft({ projectId })
            : continueCraft({ projectId });
        }
        // Always sent; the server pins it to 1 for a non-stackable tag anyway.
        return craftRequest({
          tagId,
          quantity,
          payerKey,
          customName,
          customDescription,
          inscription,
          ingredientChoice: ingredientChoiceValue,
          // What the confirm just showed as billable against the Move — 0
          // when it read as free. The server refuses to bill past this, so a
          // stale tab gets a retry instead of a silent Move charge.
          billedSeen: String(craftCost?.billedQty ?? 0),
        });
      case "destroy":
        return destroyTagRequest({ tagId, quantity });
      case "learn":
        return learnRequest({ teacherId: targetId, tagId });
      case "teach":
        return teachRequest({ learnerId: targetId, tagId });
      case "confess":
        return confessRequest({ chaplainId: targetId, tagId });
      case "consume":
        return consumeTagRequest({ tagId });
      case "extract":
        return extractGodfleshRequest();
      case "package":
        return packageItemsRequest({
          lines: Object.entries(packed).map(([id, q]) => ({
            tagId: id,
            quantity: q,
          })),
          label: crateLabel,
        });
      case "heal":
        return healCharacterRequest({
          targetCharacterId: patientId,
          tagId,
          payerKey,
        });
      case "transfer":
        return transferRequest({
          fromKey,
          toKey,
          tags: Object.entries(picks).map(([id, q]) => ({
            tagId: id,
            quantity: q,
          })),
          amount,
        });
      case "loot":
        // A room is Transfer's room → you, so reach, holdings, the audit rows
        // and the room thread's alias line all come from the one path.
        if (targetId.startsWith("room:")) {
          return transferRequest({
            fromKey: targetId,
            toKey: `character:${selfId}`,
            tags: Object.entries(picks).map(([id, q]) => ({
              tagId: id,
              quantity: q,
            })),
            amount,
          });
        }
        return lootCharacterRequest({
          targetCharacterId: targetId,
          tagPicks: Object.entries(picks).map(([id, q]) => ({
            tagId: id,
            quantity: q,
          })),
          amount,
        });
      case "move":
        return moveCharacterRequest({
          targetCharacterId: targetId,
          targetLocationId: locationId,
        });
      case "bind":
        return bindCharacterRequest({ targetCharacterId: targetId });
      case "free":
        return freeCharacterRequest({ targetCharacterId: targetId });
      case "crucify":
        return crucifyCharacterRequest({ targetCharacterId: targetId });
      case "torture":
        return tortureCharacterRequest({ targetCharacterId: targetId });
      case "harm":
        return harmCharacterRequest({
          targetCharacterId: targetId,
          tagId,
          lethal,
        });
      case "bury": {
        const corpse = corpses.find((c) => corpseIdOf(c) === corpseKey);
        return buryCharacterRequest({
          tagId: corpse?.tagId,
          sourceKey: corpse?.sourceKey,
        });
      }
      case "butcher": {
        const corpse = corpses.find((c) => corpseIdOf(c) === corpseKey);
        return butcherCorpseRequest({
          tagId: corpse?.tagId,
          sourceKey: corpse?.sourceKey,
        });
      }
      case "mutilate": {
        // One dropdown, two id spaces — the prefix says which, the way the
        // Craft dialog splits project: from site:.
        const cut = mutilateKey.indexOf(":");
        const kind = mutilateKey.slice(0, cut);
        const rest = mutilateKey.slice(cut + 1);
        if (kind === "corpse") {
          const corpse = corpses.find((c) => corpseIdOf(c) === rest);
          return mutilateRequest({
            tagId: corpse?.tagId,
            sourceKey: corpse?.sourceKey,
            part: mutilatePart,
          });
        }
        return mutilateRequest({
          targetCharacterId: rest,
          part: mutilatePart,
        });
      }
      case "engrave":
        return engraveHeadstoneRequest({ firstName: engraveName });
      case "disguise":
        return disguiseSelfRequest({ name: disguiseName });
      case "pointer":
        return readPointer();
      case "recall":
        return recallComrades();
      case "recover":
        return recoverEquipment();
      case "hideout":
        return setHideout({ roomId: hideoutRoomId });
      case "purchase":
        return purchaseGear({
          items: gearLines.map((w) => ({ tagId: w.tagId, quantity: w.quantity })),
          source: gearSource,
        });
      case "arm":
        return armNuke();
      case "disarm":
        return disarmNuke();
      // Neither files a Request — see web/app/(app)/character/paperActions.js
      // for why. Both still come back as { ok, error } like everything else.
      case "write":
        return writePaper({ tagId: paperId, text: paperBody, title: bookTitle });
      case "seal":
        return sealLetter({ tagId: tagId, stampTagId: stampId });
      case "bird":
        // No reason: the letter is the record. See RequestDialog.js.
        return birdMessageRequest({
          recipientId: targetId,
          guessedZoneId: zoneId,
          tagId: birdTagId,
        });
      default:
        return Promise.resolve({ ok: false, error: "Nothing to do." });
    }
  }

  const sameParty = fromKey && fromKey === toKey;
  const takingSomething = Object.keys(picks).length > 0 || Number(amount) > 0;

  const canSubmit = (() => {
    switch (mode) {
      case "write":
        return Boolean(
          paperId && paperBody.trim().length > 0 && (!writingBook || bookTitle.trim()),
        );
      case "seal":
        return Boolean(tagId && stampId);
      case "bird":
        return Boolean(targetId && zoneId && birdTagId);
      case "transfer":
        return Boolean(fromKey && toKey && !sameParty && takingSomething);
      case "heal":
        return Boolean(patientId && payerKey && affliction);
      case "loot":
        return Boolean(targetId && takingSomething);
      case "move":
        return Boolean(targetId && locationId);
      case "bind":
      case "free":
      case "crucify":
      case "torture":
        return Boolean(targetId);
      case "harm":
        return Boolean(targetId && (tagId || lethal));
      case "bury":
      case "butcher":
        return Boolean(corpseKey);
      case "mutilate":
        return Boolean(mutilateKey && mutilatePart);
      case "engrave":
        return Boolean(engraveName.trim());
      case "disguise":
        return Boolean(disguiseName.trim());
      // The pointer asks nothing and costs nothing, so there is nothing to
      // fill in before pressing it.
      case "pointer":
        return true;
      case "recall":
      case "recover":
        return true;
      case "hideout":
        return Boolean(hideoutRoomId);
      case "purchase":
        return gearLines.length > 0 && gearTotal <= gearPurse;
      case "arm":
      case "disarm":
        return hasDevice;
      case "craft": {
        if (siteId) {
          const site = buildSites.find((s) => s.id === siteId);
          if (!site) return false;
          // Cancelling is the opener's alone and costs no Move; joining is a
          // Move like any other turn of work.
          return projectChoice === "cancel" ? Boolean(site.mine) : !hasMoved;
        }
        if (projectId) {
          const project = craftProjects.find((p) => p.id === projectId);
          if (!project) return false;
          return (
            projectChoice === "cancel" || (!hasMoved && !project.workedThisTurn)
          );
        }
        if (!chosen) return false;
        // A recipe with a pick and nothing to pick from cannot be made at all.
        if (ingredientPick && !ingredientChoiceValue) return false;
        // Custom words are +CUSTOM_SURCHARGE ⬢ a unit — the same shared
        // verdict the server bills by (web/lib/customCraft.js).
        const surcharge =
          chosen.customizable &&
          customCraftFields({ customName, customDescription }).active
            ? CUSTOM_SURCHARGE
            : 0;
        const cost = ((chosen.requirementResources ?? 0) + surcharge) * craftQty;
        // A 0-turn craft inside its free allowance never needed a Move and
        // still doesn't; everything else has to fit in what the turn has left
        // (CRAFTING.md §2a). craftRequest refuses the same cases regardless.
        return Boolean(cost === 0 || payerKey) && craftMoveOk;
      }
      case "learn":
      case "teach":
      case "confess":
        return Boolean(targetId && tagId);
      case "extract":
        return canExtract;
      case "package":
        return (
          Object.keys(packed).length > 0 &&
          crateLabel.trim().length > 0 &&
          packedLbs <= PACKAGE_MAX_LBS
        );
      default:
        return Boolean(tagId);
    }
  })();

  // What the grid needs to grey a button out — this character's sheet only.
  const pools = useMemo(
    () => ({
      canCraft:
        craftable.length > 0 ||
        craftProjects.length > 0 ||
        buildSites.length > 0,
      canDestroy: removable.length > 0,
      canConsume: consumable.length > 0,
      canHeal,
      canExamine: !examineBlocked,
      // The sentence ActionGrid appends to a greyed button's tooltip, so a
      // player reads why instead of DMing to ask.
      gateReason: { examine: examineBlocked, extract: extractBlocked },
      canLearn: teachers.length > 0,
      canTeach,
      // Your own sheet only. Greying this on whether a chaplain happens to be
      // standing here would announce their presence to anyone who glanced at
      // their own page — the rule at the top of actionRegistry.js.
      canConfess: mySins.length > 0,
      // `show` gates whether ActionGrid renders the icon; canSendBirdToday
      // is a `gate` on top, so the button exists but is dead post-send.
      hasBird,
      canRead,
      canWrite,
      hasSeal,
      canSeal,
      // Holding a book IS having one to tear up — no second prop for it.
      canSendBirdToday: !birdSentToday,
      canButcher,
      canSeeExtract,
      canExtract,
      canSeePackage,
      canCrucify,
      canDisguise,
      canTorture,
      canMutilate,
      hasDatacard,
      hasDevice,
      isThanati,
      isThanatiLeader,
      atHideout,
    }),
    [
      craftable,
      craftProjects,
      buildSites,
      removable,
      consumable,
      canHeal,
      examineBlocked,
      extractBlocked,
      teachers,
      canTeach,
      mySins,
      hasBird,
      canRead,
      canWrite,
      hasSeal,
      canSeal,
      birdSentToday,
      canButcher,
      canSeeExtract,
      canExtract,
      canSeePackage,
      canCrucify,
      canDisguise,
      canTorture,
      canMutilate,
      hasDatacard,
      hasDevice,
      isThanati,
      isThanatiLeader,
      atHideout,
    ],
  );

  // `selfId` rides along so a caller can build the `character:<id>` party key
  // the Transfer presets take without being handed the id a second way. The
  // Hall's room panel is the one that needs it (Drop and Take name both ends).
  const value = useMemo(
    () => (enabled ? { open, pools, selfId } : null),
    [enabled, open, pools, selfId],
  );

  const title = titleFor(mode);
  const dialogWidth =
    mode === "craft" ||
    mode === "harm" ||
    mode === "loot" ||
    mode === "transfer" ||
    mode === "purchase"
      ? "wide"
      : undefined;

  return (
    <RequestActionsContext.Provider value={value}>
      {children}

      {enabled && (
        <>
          {/* Look at files no Request and has no fields, so it gets its own
          plain modal rather than being forced through the Requests popup. It
          does call the server, but only to read (examineActions.js). */}
          {/* `targetId` is seeded by open("examine", null, { targetId }) —
              the Hall's HERE rows and its feed rows both name the person
              before the dialog opens, so the picker is skipped. Read only
              while Look at is the open mode: the same state backs every other
              dialog's target. */}
          <ExamineDialog
            open={mode === "examine"}
            targetId={mode === "examine" ? targetId || null : null}
            onClose={() => setMode(null)}
          />

          <RequestDialog
            open={mode !== null && !NO_REQUEST_MODES.has(mode)}
            title={title}
            submitLabel={
              mode === "craft" && (projectId || siteId)
                ? projectChoice === "cancel"
                  ? "Give it up"
                  : "Keep working"
                : title
            }
            width={dialogWidth}
            busy={pending}
            error={error}
            canSubmit={canSubmit}
            onCancel={() => !pending && setMode(null)}
            onConfirm={submit}
          >
            {mode === "craft" && (
              <CraftDialog
                hasWorkshop={hasWorkshop}
                projects={craftProjects}
                projectId={projectId}
                sites={buildSites}
                siteId={siteId}
                // One dropdown, two id spaces — the prefix says which.
                onPick={(key) => {
                  const [kind, id] = key.split(":");
                  setProjectId(kind === "project" ? id : "");
                  setSiteId(kind === "site" ? id : "");
                  setProjectChoice("continue");
                }}
                projectChoice={projectChoice}
                onProjectChoice={setProjectChoice}
                picker={
                  <TagPicker
                    tags={craftable}
                    selectedId={tagId}
                    onSelect={pick}
                    byId={gateById}
                    heldIds={heldIds}
                    blockedReason={recipeBlocked}
                    emptyLabel="Nothing you could make right now."
                  />
                }
                chosen={chosen}
                stacking={stacking}
                quantity={quantity}
                onQuantity={setQuantity}
                quantityMax={craftQuantityMax}
                budget={craftBudget}
                moveCost={craftCost}
                allowance={craftAllowance}
                moveOk={craftMoveOk}
                ingredientPick={ingredientPick}
                ingredientChoice={ingredientChoiceValue}
                onIngredientChoice={(slug) => {
                  // The quantity cap is per-ingredient (you may hold 5 tea
                  // and 1 honey), so switching resets the count rather than
                  // stranding a 5 over a max of 1.
                  setIngredientChoice(slug);
                  setQuantity("1");
                }}
                customName={customName}
                onCustomName={setCustomName}
                customDescription={customDescription}
                onCustomDescription={setCustomDescription}
                inscription={inscription}
                onInscription={setInscription}
                payerKey={payerKey}
                onPayer={setPayerKey}
                parties={healParties}
                selfId={selfId}
                hasMoved={hasMoved}
              />
            )}

            {mode === "destroy" && (
              <>
                <label className="field">
                  <span className="field-label">
                    What are you destroying?
                  </span>
                  <Select
                    value={tagId ?? ""}
                    onChange={(e) => pick(e.target.value || null)}
                    required
                  >
                    <option value="" disabled>
                      Choose a tag…
                    </option>
                    {removable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                {stacking && (
                  <QuantityField
                    value={quantity}
                    onChange={setQuantity}
                    max={heldCount}
                    label={`How many? (you have ${heldCount})`}
                  />
                )}
              </>
            )}

            {(mode === "learn" || mode === "teach") && (
              <>
                {lessonPeople.length === 0 ? (
                  <NobodyHere>
                    {mode === "learn"
                      ? "Nobody here can teach you anything right now."
                      : "There's nobody here you could teach anything."}
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">
                        {mode === "learn"
                          ? "Who are you learning from?"
                          : "Who are you teaching?"}
                      </span>
                      <Select
                        value={targetId}
                        onChange={(e) => {
                          setTargetId(e.target.value);
                          setTagId(null);
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {lessonPeople.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {lessonPartner && (
                      <label className="field">
                        <span className="field-label">Which skill?</span>
                        <Select
                          value={tagId ?? ""}
                          onChange={(e) => setTagId(e.target.value || null)}
                          required
                        >
                          <option value="" disabled>
                            Choose a skill…
                          </option>
                          {lessonPartner.skills.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                  </>
                )}
                {hasMoved && !canTeach && (
                  <p className="text-xs text-muted">
                    You&apos;ve already used your Move this turn.
                  </p>
                )}
              </>
            )}

            {mode === "confess" && (
              <>
                {confessors.length === 0 ? (
                  <NobodyHere>Nobody here can hear a confession.</NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">
                        Who are you confessing to?
                      </span>
                      <Select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {confessors.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="field">
                      <span className="field-label">
                        What are you confessing?
                      </span>
                      <Select
                        value={tagId ?? ""}
                        onChange={(e) => setTagId(e.target.value || null)}
                        required
                      >
                        <option value="" disabled>
                          Choose what weighs on you…
                        </option>
                        {mySins.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </>
                )}
                {hasMoved && (
                  <p className="text-xs text-muted">
                    You&apos;ve already used your Move this turn.
                  </p>
                )}
              </>
            )}

            {mode === "consume" && (
              <>
                <label className="field">
                  <span className="field-label">What are you using up?</span>
                  <Select
                    value={tagId ?? ""}
                    onChange={(e) => pick(e.target.value || null)}
                    required
                  >
                    <option value="" disabled>
                      Choose a tag…
                    </option>
                    {consumable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                {/* A Depot crate says nothing here: what falls out of it is
                    printed on the crate itself, and it grants runtime rows
                    rather than the catalog slugs `becomes` reads — so the
                    fallback line below would claim it leaves nothing behind,
                    which is the one thing that is never true of a crate. */}
                {chosen && !chosen.crateContents && (
                  <p className="text-xs text-muted">
                    {becomes.length
                      ? `Becomes: ${becomes.join(", ")}.`
                      : "Gets used up — it doesn't leave anything behind."}
                    {chosen.quantity > 1
                      ? ` Takes one of your ${chosen.quantity}.`
                      : ""}
                  </p>
                )}
              </>
            )}

            {mode === "heal" && (
              <>
                <label className="field">
                  <span className="field-label">Who are you treating?</span>
                  <Select
                    value={patientId}
                    onChange={(e) => {
                      setPatientId(e.target.value);
                      setTagId(null);
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {healTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id === selfId ? `${t.name} (you)` : t.name}
                      </option>
                    ))}
                  </Select>
                </label>
                {patient && (
                  <label className="field">
                    <span className="field-label">What are you treating?</span>
                    <Select
                      value={tagId ?? ""}
                      onChange={(e) => setTagId(e.target.value || null)}
                      required
                    >
                      <option value="" disabled>
                        Choose an affliction…
                      </option>
                      {patient.healable.map((h) => (
                        <option key={h.tagId} value={h.tagId}>
                          {h.tagName}
                          {h.gambit ? " — Gambit" : ""}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {affliction && (
                  <>
                    <PartySelect
                      label="Paid for by"
                      value={payerKey}
                      onChange={setPayerKey}
                      hint="Choose who pays…"
                      characters={healParties?.characters ?? []}
                      rooms={healParties?.rooms ?? []}
                      selfId={selfId}
                    />
                    <p
                      className={`text-xs ${affliction.gambit ? "text-accent" : "text-muted"}`}
                    >
                      Costs <span className="mono">{affliction.cost} ⬢</span>.
                      {affliction.gambit
                        ? " This is beyond routine, so it counts as a Gambit. It uses your Move, a die is rolled, and a poor result can leave them worse off. You'll both know the outcome at the end of the turn."
                        : affliction.counts
                          ? ` One of the ${healsLeft ?? "few"} cases you can work this turn.`
                          : " First aid doesn't cost a Move."}
                    </p>
                  </>
                )}
              </>
            )}

            {mode === "transfer" && (
              <TransferDialog
                selfId={selfId}
                parties={transferParties}
                lootable={lootTargets}
                silo={transferSilo}
                transferable={transferable}
                carry={carry}
                fromKey={fromKey}
                toKey={toKey}
                onFrom={(key) => {
                  setFromKey(key);
                  setPicks({});
                }}
                onTo={setToKey}
                picks={picks}
                onTogglePick={togglePick}
                onPickQuantity={setPickQuantity}
                amount={amount}
                onAmount={setAmount}
              />
            )}

            {mode === "loot" && (
              <>
                {lootTargets.length === 0 && lootRooms.length === 0 ? (
                  <NobodyHere>
                    Nothing here to search.
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">
                        What are you searching?
                      </span>
                      <Select
                        value={targetId}
                        onChange={(e) => {
                          setTargetId(e.target.value);
                          setPicks({});
                          setAmount("0");
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {lootRooms.length > 0 && (
                          <optgroup label="Rooms here">
                            {lootRooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {lootTargets.length > 0 && (
                          <optgroup label="People here">
                            {lootTargets.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} — {targetNote(t)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </Select>
                    </label>

                    {lootTarget && (
                      <>
                        {lootTarget.tags.length === 0 ? (
                          <p className="text-xs text-muted">
                            {lootTarget.room
                              ? "Nothing is stored here."
                              : "They\u2019re carrying nothing worth taking."}
                          </p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <span className="field-label">Take</span>
                            {lootTarget.tags.map((t) => {
                              const checked = t.tagId in picks;
                              return (
                                <div
                                  key={t.tagId}
                                  className="flex flex-wrap items-center gap-3"
                                >
                                  <CheckField
                                    checked={checked}
                                    onChange={() =>
                                      togglePick(t.tagId, t.quantity)
                                    }
                                  >
                                    {t.tagName}
                                    {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                                  </CheckField>
                                  {checked && t.stackable && t.quantity > 1 && (
                                    <QuantityField
                                      label="How many?"
                                      max={t.quantity}
                                      value={picks[t.tagId]}
                                      onChange={(v) =>
                                        setPickQuantity(t.tagId, v)
                                      }
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <label className="field" style={{ width: "10rem" }}>
                          <span className="field-label">
                            {lootTarget.room
                              ? `Resources (${lootTarget.resources} here)`
                              : `Resources (they have ${lootTarget.resources})`}
                          </span>
                          <input
                            type="number"
                            min="0"
                            max={lootTarget.resources}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {mode === "move" && (
              <>
                {moveTargets.length === 0 ? (
                  <NobodyHere>There&apos;s nobody here to move.</NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Who are you moving?</span>
                      <Select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {moveTargets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.status === "DEAD" ? " — body" : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="field">
                      <span className="field-label">Where to?</span>
                      <Select
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Choose somewhere next door…
                        </option>
                        {moveLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                            {l.crossesZone && l.zoneName
                              ? ` — crosses into ${l.zoneName}`
                              : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </>
                )}
              </>
            )}

            {mode === "extract" && (
              <>
                <p className="text-sm">You wade out and cut. A day of it.</p>
                {extractBlocked ? (
                  <p className="text-sm text-accent">{extractBlocked}</p>
                ) : (
                  <p className="text-xs text-muted">
                    Rolls 1d6, and you&apos;ll be told what it came up. A 6 pays extra. A 1 means it grabbed hold of you first; Armored Gloves protect your hands.
                  </p>
                )}
              </>
            )}

            {mode === "package" && (
              <>
                {packable.length === 0 ? (
                  <NobodyHere>
                    You aren&apos;t carrying anything that could go in a crate.
                  </NobodyHere>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <span className="field-label">What goes in?</span>
                      {sortTagsForMenu(packable).map((tag) => {
                        const checked = tag.id in packed;
                        return (
                          <div
                            key={tag.id}
                            className="flex flex-wrap items-center gap-3"
                          >
                            <CheckField
                              checked={checked}
                              onChange={() =>
                                togglePacked(tag.id, tag.quantity)
                              }
                            >
                              {tag.name}
                              {tag.quantity > 1 ? ` ×${tag.quantity}` : ""}
                              <span className="mono ml-2 text-xs text-muted">{`${tag.weightLbs ?? 0} lb`}</span>
                            </CheckField>
                            {checked && tag.stackable && tag.quantity > 1 && (
                              <QuantityField
                                label="How many?"
                                max={tag.quantity}
                                value={packed[tag.id]}
                                onChange={(v) => setPackedQuantity(tag.id, v)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <label className="field">
                      <span className="field-label">
                        What does the crate say?
                      </span>
                      <input
                        type="text"
                        value={crateLabel}
                        onChange={(e) => setCrateLabel(e.target.value)}
                        placeholder="Squeeze, 7 cubes"
                        autoComplete="off"
                        maxLength={PACKAGE_LABEL_MAX}
                        required
                      />
                    </label>

                    <p
                      className={
                        packedLbs > PACKAGE_MAX_LBS
                          ? "text-sm text-accent"
                          : "text-xs text-muted"
                      }
                    >
                      {`${packedLbs} / ${PACKAGE_MAX_LBS} lb packed. The crate will weigh ${Math.max(
                        1,
                        Math.ceil(packedLbs / 2),
                      )} lb. `}
                      {packedLbs > PACKAGE_MAX_LBS
                        ? "That won't go in one crate."
                        : "Nobody checks the line on the side against what's actually in there."}
                    </p>
                  </>
                )}
              </>
            )}

            {(mode === "bury" || mode === "butcher") && (
              <>
                {/* Butcher takes anything; Bury needs a person. A Nekker has
                no soul to free, so it isn't offered here rather than being
                offered and refused. */}
                {(() => {
                  const list =
                    mode === "bury" ? corpses.filter((c) => c.human) : corpses;
                  if (list.length === 0) {
                    return (
                      <NobodyHere>
                        {mode === "bury"
                          ? "You aren’t holding a body, and there’s none lying anywhere you can reach."
                          : "There’s nothing here to cut up."}
                      </NobodyHere>
                    );
                  }
                  const chosen = list.find((c) => corpseIdOf(c) === corpseKey);
                  return (
                    <>
                      <label className="field">
                        <span className="field-label">Whose body?</span>
                        <Select
                          value={corpseKey}
                          onChange={(e) => setCorpseKey(e.target.value)}
                          required
                        >
                          <option value="">Pick a body…</option>
                          {list.map((c) => (
                            <option key={corpseIdOf(c)} value={corpseIdOf(c)}>
                              {`${c.tagName} — ${c.source.name}`}
                            </option>
                          ))}
                        </Select>
                      </label>
                      {mode === "butcher" && chosen ? (
                        <p className="text-xs text-muted">
                          Cutting this one up gives you {yieldLabel(chosen)}.
                        </p>
                      ) : null}
                    </>
                  );
                })()}
              </>
            )}

            {mode === "engrave" && (
              <>
                <label className="field">
                  <span className="field-label">Whose name?</span>
                  <input
                    type="text"
                    value={engraveName}
                    onChange={(e) => setEngraveName(e.target.value)}
                    placeholder="First name"
                    autoComplete="off"
                    maxLength={24}
                    required
                  />
                </label>
                {/* No target list, and no "nobody here" line either — both would
                answer "who is dead?" without anyone choosing to ask, and this
                one searches every zone rather than just this room. You type a
                name and find out whether you were right. */}
                <p className="text-xs text-muted">
                  Costs {ENGRAVE_RESOURCE_COST} ⬢ and your turn.
                </p>
              </>
            )}

            {mode === "pointer" && (
              <p className="text-xs text-muted">
                The card wakes and swings. Press to read it&mdash;the answer
                comes to you privately, and nobody here is told you looked.
              </p>
            )}

            {/* THE THANATI (docs/systemdocs/THANATI.md). Recall and Recover
                ask nothing — the dialog is the confirm — and by Bascinet's
                ruling none of the four carries a line of explanation. */}
            {mode === "hideout" && (
              <label className="field">
                <span className="field-label">Room</span>
                <Select
                  value={hideoutRoomId}
                  onChange={(e) => setHideoutRoomId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose a room…
                  </option>
                  {hideoutRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.current ? " ✓" : ""}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {mode === "purchase" && (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="field" style={{ width: "10rem" }}>
                    <span className="field-label">Pay with</span>
                    <Select value={gearSource} onChange={(e) => setGearSource(e.target.value)}>
                      <option value="obols">Obols</option>
                      <option value="resources">⬢</option>
                    </Select>
                  </label>
                  <span className="mono text-sm text-muted">
                    {hideoutStock?.obols ?? 0} ¢ · {hideoutStock?.resources ?? 0} ⬢
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ware</th>
                        <th>Obols</th>
                        <th>⬢</th>
                        <th>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {thanatiWares.map((w) => (
                        <tr key={w.tagId}>
                          <td>{w.name}</td>
                          <td className="mono">{w.obols}</td>
                          <td className="mono">{w.resources}</td>
                          <td>
                            <QuantityField
                              inline
                              min={0}
                              max={99}
                              ariaLabel={w.name}
                              value={gearCart[w.tagId] ?? "0"}
                              onChange={(v) => setGearCart((prev) => ({ ...prev, [w.tagId]: v }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <span className={`mono text-sm ${gearTotal > gearPurse ? "text-danger" : ""}`}>
                    {gearTotal} {gearSource === "obols" ? "¢" : "⬢"}
                  </span>
                </div>
              </>
            )}

            {(mode === "arm" || mode === "disarm") && (
              <>
                {!hasDevice ? (
                  <NobodyHere>
                    You have the card, but not the device. You can only work it
                    with the thing in your hands.
                  </NobodyHere>
                ) : mode === "arm" ? (
                  <p className="text-xs text-muted">
                    The card goes in and the count begins. It detonates at the
                    close of the turn after next, and everyone who is not
                    underground when it does will die&mdash;you included, unless
                    you are. You can still take the card out before then.
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    The card comes out and the count stops. You can put it back
                    whenever you like.
                  </p>
                )}
              </>
            )}

            {mode === "disguise" && (
              <>
                <label className="field">
                  <span className="field-label">Go by what name?</span>
                  <input
                    type="text"
                    value={disguiseName}
                    onChange={(e) => setDisguiseName(e.target.value)}
                    placeholder="A name"
                    autoComplete="off"
                    maxLength={24}
                    required
                  />
                </label>
                {/* No people-picker: you are disguising yourself, not choosing
                a target, and the name is free text on purpose — impersonating
                somebody real is a thing you do by typing their name, and
                whether you get away with it is a GM's question, not a
                dropdown's. */}
                <p className="text-xs text-muted">
                  For 3 turns nobody sees your name or your face&mdash;you speak
                  as this instead. You cannot conceal yourself on top of a
                  disguise, and it wears off on its own. The kit is not used
                  up.
                </p>
              </>
            )}

            {(mode === "bind" || mode === "free" || mode === "crucify" || mode === "torture") && (
              <>
                {bindable.length === 0 ? (
                  <NobodyHere>
                    {mode === "bind"
                      ? "There’s nobody here left to tie up."
                      : mode === "free"
                        ? "Nobody here is bound."
                        : mode === "torture"
                          ? "Nobody here is tied up."
                          : "There’s nobody here to put on the cross."}
                  </NobodyHere>
                ) : (
                  <label className="field">
                    <span className="field-label">
                      {mode === "bind"
                        ? "Who are you tying up?"
                        : mode === "free"
                          ? "Who are you cutting loose?"
                          : mode === "torture"
                            ? "Who are you torturing?"
                            : "Who are you crucifying?"}
                    </span>
                    <Select
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {bindable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {(mode === "torture" || mode === "crucify") && (
                  <p className="text-xs text-muted">
                    {mode === "torture"
                      ? "It takes your Move. One die, resolved now: what they gave up arrives by DM."
                      : "They go up on the cross now. They can still speak, but nothing else — and in a turn they are Dying. It doesn't spend your Move. Say why."}
                  </p>
                )}
              </>
            )}

            {/* Two dropdowns and nothing else. No helper line, no yield
            preview, no per-part explanation — unlike Butcher's "cutting this
            one up gives you…". The part list is also DELIBERATELY UNFILTERED:
            narrowing it to the rungs a subject has left would answer "what are
            they already missing?" to anybody who opened the dialog, which is
            the same leak the metagaming rule in actionRegistry.js is about.
            You find out by trying, and the server refuses. */}
            {mode === "mutilate" && (
              <>
                {mutilateSubjects.people.length === 0 &&
                mutilateSubjects.bodies.length === 0 ? (
                  <NobodyHere>
                    There’s nobody here you could do that to. ‡
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Who?</span>
                      <Select
                        value={mutilateKey}
                        onChange={(e) => setMutilateKey(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {mutilateSubjects.people.length > 0 && (
                          <optgroup label="Here">
                            {mutilateSubjects.people.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {mutilateSubjects.bodies.length > 0 && (
                          <optgroup label="Bodies">
                            {mutilateSubjects.bodies.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </Select>
                    </label>
                    <label className="field">
                      <span className="field-label">What?</span>
                      <Select
                        value={mutilatePart}
                        onChange={(e) => setMutilatePart(e.target.value)}
                        required
                      >
                        {MUTILATE_PARTS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </>
                )}
              </>
            )}

            {mode === "harm" && (
              <>
                {harmTargets.length === 0 ? (
                  <NobodyHere>
                    Nobody here is helpless enough for that.
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Who are you hurting?</span>
                      <Select
                        value={targetId}
                        onChange={(e) => {
                          setTargetId(e.target.value);
                          setLethal(false);
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {harmTargets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {t.condition ?? "Helpless"}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <span className="field-label">What injury? (optional)</span>
                    <TagPicker
                      tags={harmTags}
                      selectedId={tagId}
                      onSelect={setTagId}
                      emptyLabel="No injuries in the catalog."
                    />

                    <CheckField
                      checked={lethal}
                      onChange={(e) => setLethal(e.target.checked)}
                      disabled={
                        !harmTargets.find((t) => t.id === targetId)?.finishable
                      }
                    >
                      Finish them off
                    </CheckField>
                    <p className="text-xs text-muted">
                      Only someone Dying or Bound can be finished off, and doing
                      it <strong>kills them</strong> — there is no taking it
                      back. Pick an injury, tick the box, or both.
                    </p>
                  </>
                )}
              </>
            )}

            {mode === "write" && (
              <>
                {paperOptions.length === 0 ? (
                  <NobodyHere>
                    You have no paper. The Depot sells it.
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">
                        What are you writing on?
                      </span>
                      <Select
                        value={paperId}
                        onChange={(e) => choosePaper(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Pick a sheet
                        </option>
                        {paperOptions.map((o) => (
                          <option key={o.tagId} value={o.tagId}>
                            {o.blank || o.book
                              ? `${o.name}${o.quantity > 1 ? ` ×${o.quantity}` : ""} — blank`
                              : `${o.name}${o.excerpt ? ` — ${o.excerpt}` : ""}`}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {/* Read-only, always. You can always write more; you can
                    never take anything back off a sheet. */}
                    {paperExisting && (
                      <div className="field">
                        <span className="field-label">Already on it</span>
                        <PaperSheet paper={paperExisting} />
                      </div>
                    )}

                    {/* A book's Tag.name is its title, read off a shelf. A
                    sheet's is an anonymous waybill code, so only a book asks. */}
                    {writingBook && (
                      <label className="field">
                        <span className="field-label">What is it called?</span>
                        <input
                          type="text"
                          value={bookTitle}
                          onChange={(e) => setBookTitle(e.target.value)}
                          maxLength={TITLE_MAX}
                          required
                        />
                      </label>
                    )}

                    <label className="field">
                      <span className="field-label">
                        {paperExisting
                          ? "Add underneath"
                          : "What does it say?"}
                      </span>
                      <textarea
                        rows={writingBook ? 12 : 6}
                        maxLength={writeMax}
                        value={paperBody}
                        onChange={(e) => setPaperBody(e.target.value)}
                        placeholder="Write here."
                      />
                      <span className="text-xs text-muted mono">
                        {paperBody.length} / {writeMax}
                      </span>
                    </label>
                    {writingBook && (
                      <p className="text-xs text-muted">
                        A book is written in one pass. Nothing can be added later.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {mode === "seal" && (
              <>
                {sealOptions.letters.length === 0 ? (
                  <NobodyHere>
                    You aren&apos;t carrying a written letter to close.
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Which letter?</span>
                      <Select
                        value={tagId ?? ""}
                        onChange={(e) => setTagId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Pick a letter
                        </option>
                        {sealOptions.letters.map((o) => (
                          <option key={o.tagId} value={o.tagId}>
                            {o.name}
                            {o.excerpt ? ` — ${o.excerpt}` : ""}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <label className="field">
                      <span className="field-label">Whose wax?</span>
                      <Select
                        value={stampId}
                        onChange={(e) => setStampId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Pick a stamp
                        </option>
                        {sealOptions.stamps.map((o) => (
                          <option key={o.tagId} value={o.tagId}>
                            {o.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </>
                )}
              </>
            )}

            {mode === "bird" && (
              <>
                {/* EVERY character, alive or dead, unfiltered. Narrowing this to
                the living would turn the picker into a casualty list that
                updates itself — the same disclosure REQUESTS.md §3 refuses
                for the transfer dropdowns. A letter to someone already dead
                simply never arrives, and you find that out a turn later.
                The search box below narrows on the NAME THE PLAYER TYPED,
                which is not a disclosure — it tells them nothing they did not
                already have to guess. */}
                <label className="field">
                  <span className="field-label">Who is it for?</span>
                  <input
                    type="search"
                    value={birdQuery}
                    onChange={(e) => setBirdQuery(e.target.value)}
                    placeholder="Search by name"
                  />
                  <Select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Pick someone
                    </option>
                    {birdChoices.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-muted mono">
                    {birdChoices.length} / {birdTargets.length}
                  </span>
                </label>

                <label className="field">
                  <span className="field-label">
                    Where do you think they are?
                  </span>
                  <Select
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Pick a place
                    </option>
                    {birdZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="field">
                  <span className="field-label">Which letter?</span>
                  {letterOptions.length === 0 ? (
                    <NobodyHere>
                      You aren&apos;t carrying anything written. Use Write
                      first.
                    </NobodyHere>
                  ) : (
                    <Select
                      value={birdTagId}
                      onChange={(e) => setBirdTagId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Pick a letter
                      </option>
                      {letterOptions.map((o) => (
                        <option key={o.tagId} value={o.tagId}>
                          {o.name}
                          {o.excerpt ? ` — ${o.excerpt}` : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                  <p className="text-xs text-muted">
                    The bird takes it out of your hands. Guess the wrong place
                    and it comes back with the letter still on it.
                  </p>
                </label>
              </>
            )}
          </RequestDialog>
        </>
      )}
    </RequestActionsContext.Provider>
  );
}
