"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
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
import CraftDialog from "./CraftDialog";
import TagPicker from "./actions/TagPicker";
import { titleFor } from "./actionRegistry";
import Select from "./Select";
import ChipText from "./ChipText";
import ExamineDialog from "./ExamineDialog";
import QuantityField from "./QuantityField";
import { useConfirm } from "./ConfirmProvider";
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
  learnRequest,
  teachRequest,
  confessRequest,
  healCharacterRequest,
  birdMessageRequest,
} from "../(app)/character/requestActions";
import { useNotice } from "./NoticeProvider";
import { INSTANT, DIALOGS, FAST_PATHS } from "./actions";
import { ActionPoolsContext } from "./actions/poolsContext";
import { noticeLine } from "./actions/noticeLines";
// Prisma-free on purpose (it takes `db` as a parameter), so importing it here
// does not drag the @lifeweb/db barrel into the browser bundle — the same
// footing as mutilate.js below.
import { RECOVERABLE_SLUGS } from "@lifeweb/db/lib/thanati";
// Writing and sealing file no Request, so they live apart from the rest —
// see web/app/(app)/character/paperActions.js.
import {
  writePaper,
  sealLetter,
  readMyPaper,
} from "../(app)/character/paperActions";
// Safe in a "use client" bundle for the same reason constants.js is: paper.js
// requires only ./reading -> ./examineVision, and neither touches prisma. One
// definition, so the counter under the box and the server's own cap agree.
import { WRITE_MAX, BOOK_MAX, TITLE_MAX } from "@lifeweb/db/lib/paper";
import PaperSheet from "./PaperSheet";

// Every player action on the character sheet: mode state, the menus each
// mode draws from, and one RequestDialog per mode. Renders no chrome of its
// own — mounted once per sheet (CharacterSheet.js, self mode only), read
// off context by ActionGrid.js and TagsPanel.js.

const RequestActionsContext = createContext(null);

export function useRequestActions() {
  return useContext(RequestActionsContext);
}

// "Nobody qualifies" line — never used to hide the action itself; see
// ActionGrid.js on why a greyed button would be its own leak.
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
  // The Death Mask's corpse shortlist — held corpses whose face is still
  // theirs, server-computed in character/page.js. See ingredientPick below.
  deathMaskCorpses = [],
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
  // The Bird's guessed zone.
  const [zoneId, setZoneId] = useState("");
  // Move Player's destination.
  const [locationId, setLocationId] = useState("");
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
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const notice = useNotice();
  // Which instant verb is in flight, so its button can say so.
  const [busy, setBusy] = useState(null);
  // What a caller already knew when it opened the dialog — the person whose
  // row was clicked, the stack, the two ends of a move — handed to the dialog
  // component for the mode (components/actions/*).
  const [presets, setPresets] = useState(null);

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
  const consumable = useMemo(
    () => consumableTags(characterTags),
    [characterTags],
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
  const chosen = useMemo(() => {
    // heal/harm/learn/teach's tagId isn't a tag this character holds, so
    // they opt out.
    const pool = mode === "craft" ? craftable : [];
    return pool.find((t) => t.id === tagId) ?? null;
  }, [mode, tagId, craftable]);
  // Consume always takes one, so it opts out of the quantity field. So does a
  // placement: a structure is a place, not a stack, and openBuildSiteImpl
  // ignores the count anyway.
  const stacking = Boolean(chosen?.stackable) && !chosen?.placement;

  // Lessons: the counterpart picked, and the skills on offer with them.
  const lessonPeople = mode === "teach" ? learners : teachers;
  const lessonPartner = useMemo(
    () => lessonPeople.find((p) => p.id === targetId) ?? null,
    [lessonPeople, targetId],
  );

  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);
  // Which of the robes and the mask are NOT on this sheet — what Recover
  // Equipment would hand back, and the label the button wears
  // (actionRegistry.js#labelFor). Your own pockets, so the button may grey.
  const recoverMissing = useMemo(
    () => RECOVERABLE_SLUGS.filter((slug) => !heldSlugs.has(slug)),
    [heldSlugs],
  );

  // Bird recipients filtered by typed text — dead stay in it; current pick kept.
  const birdChoices = useMemo(() => {
    const q = birdQuery.trim();
    if (!q) return birdTargets;
    return birdTargets.filter(
      (t) => t.id === targetId || scoreMatch(q, { name: t.name }),
    );
  }, [birdTargets, birdQuery, targetId]);

  // An `anyOf` ingredient (Tag.requirementItems) is the one part of a recipe
  // the catalog cannot decide for the player: which delicacy goes into the
  // Lavish Meal. Only members they are actually holding are offered — the
  // server re-checks both membership and possession, so this is a shortlist,
  // not a gate. At most one per recipe; the sync refuses a second.
  const ingredientPick = useMemo(() => {
    if (mode !== "craft") return null;
    // The Death Mask's `group` corpse entry needs a SPECIFIC body — same
    // picker, same ingredientChoice channel (a recipe never carries both an
    // anyOf and this; the sync caps anyOf at one and only this recipe binds
    // a group member). The server re-resolves the choice like any other
    // (requestActions.js#resolveDeathMaskSource).
    if (chosen?.slug === "death-mask") {
      return { label: "Whose face?", options: deathMaskCorpses };
    }
    const entry = (chosen?.requirementItems ?? []).find(
      (i) => i?.kind === "anyOf",
    );
    if (!entry) return null;
    return {
      label: entry.label,
      options: (entry.options ?? []).filter((o) => heldSlugs.has(o.slug)),
    };
  }, [mode, chosen, heldSlugs, deathMaskCorpses]);
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

  // `presetTagId` lets a sheet-chip click open this dialog pre-selected.
  // `presets` seeds the one field a caller already knows: Chat's people
  // column opens Heal or Loot from a person's own row, and asking them to
  // pick that person again out of a dropdown would be a worse dialog than
  // the sheet's. Only `targetId` / `patientId` / `toKey` / `fromKey` /
  // `picks` are seedable — everything else in a dialog is a decision, not a
  // context.
  // An instant verb: no dialog. Ask the one-line question if the verb has
  // one — OUTSIDE the transition, or the confirm never renders (DESIGN-SYSTEM.md
  // §8) — then run it and say what happened as a notice. Recall's roster
  // rides along as rows under the line.
  // Everything the migrated dialogs read (components/actions/poolsContext.js):
  // the page's rosters as seeds, and the own-sheet facts. A plain object, so
  // a dialog always sees this render's props.
  const bag = {
    selfId,
    selfName,
    characterTags,
    resources,
    carry,
    transferParties,
    transferSilo,
    lootTargets,
    bindTargets,
    harmTargets,
    harmTags,
    corpses,
    healTargets,
    healParties,
    healsLeft,
    hasMoved,
    canTeach,
    teachers,
    learners,
    confessors,
    mySins,
    paperOptions,
    letterOptions,
    sealOptions,
    birdTargets,
    birdZones,
    hideoutRooms,
    hideoutStock,
    thanatiWares,
    atHideout,
  };
  // Read through a ref by `open`, which is memoized and would otherwise hold
  // the first render's rosters forever — the pattern Modal.js uses for
  // onClose. Written in an effect, never during render.
  const bagRef = useRef(bag);
  useEffect(() => {
    bagRef.current = bag;
  });

  const runNow = useCallback(
    async (next, { ask = null, run, ctx = null }) => {
      if (ask && !(await confirm(ask))) return;
      setBusy(next);
      startTransition(async () => {
        try {
          const res = await run();
          if (!res?.ok) {
            notice({ text: res?.error ?? "Something went wrong.", tone: "bad" });
            return;
          }
          notice({
            text: noticeLine(next, res, ctx),
            rows: Array.isArray(res.roster)
              ? res.roster.map((r) => ({ name: r.name, note: r.role, mark: r.leader ? "[LEADER]" : null }))
              : null,
          });
        } catch {
          notice({ text: "Could not reach the server. Nothing was changed. ‡", tone: "bad" });
        } finally {
          setBusy(null);
        }
      });
    },
    [confirm, notice],
  );

  const runInstant = useCallback(
    (next) => {
      const verb = INSTANT[next];
      if (!verb) return;
      runNow(next, { ask: verb.confirm({ recoverMissing }), run: verb.run });
    },
    [runNow, recoverMissing],
  );

  const open = useCallback(
    (next, presetTagId = null, presets = null) => {
      // The world is NOT re-read here any more. It used to be — a whole server
      // render of the sheet page on every open, to keep "who is standing here"
      // honest. Each dialog now reads its own slice the moment it mounts
      // (components/actions/useRoster.js), which is cheaper, and paints the
      // page's copy until the answer lands.
      const seed = { ...(presets ?? {}), ...(presetTagId ? { tagId: presetTagId } : {}) };
      if (INSTANT[next]) {
        runInstant(next);
        return;
      }
      // Opened from a person's own row with everything already decided —
      // Bind from Ada's menu — the picker is skipped and the one question
      // asked straight away.
      const shortcut = FAST_PATHS[next]?.(seed, bagRef.current);
      if (shortcut) {
        runNow(next, shortcut);
        return;
      }
      setPresets(seed);
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
      setZoneId("");
      setLocationId("");
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
      setError(null);
      // After the resets above, never before — a preset is the exception to
      // the blank slate, not part of it.
      if (presets?.patientId) setPatientId(presets.patientId);
      if (presets?.targetId) setTargetId(presets.targetId);
    },
    [selfId, runInstant, runNow],
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
    if (mode === "heal" && payerKey !== `character:${selfId}`) {
      const payerName = payerLabel(healParties, payerKey);
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction?.cost ?? 0} ⬢ for this treatment.`,
        confirmLabel: "Charge them",
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
      case "learn":
        return learnRequest({ teacherId: targetId, tagId });
      case "teach":
        return teachRequest({ learnerId: targetId, tagId });
      case "confess":
        return confessRequest({ chaplainId: targetId, tagId });
      case "heal":
        return healCharacterRequest({
          targetCharacterId: patientId,
          tagId,
          payerKey,
        });
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
      case "heal":
        return Boolean(patientId && payerKey && affliction);
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
      canRecover: recoverMissing.length > 0,
      recoverMissing,
    }),
    [
      recoverMissing,
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
  // Chat's room panel is the one that needs it (Drop and Take name both ends).
  const value = useMemo(
    () => (enabled ? { open, pools, selfId, busy } : null),
    [enabled, open, pools, selfId, busy],
  );

  // The dialog for the open mode, once it has moved out of this file. A mode
  // with no entry is still drawn by the inline block below — that is what
  // lets the dialogs migrate one at a time.
  const Dialog = mode ? (DIALOGS[mode] ?? null) : null;
  // Closes the dialog and says what it did, if it did anything.
  const done = useCallback(
    (line) => {
      setMode(null);
      if (line) notice(line);
    },
    [notice],
  );

  const title = titleFor(mode);
  const dialogWidth = mode === "craft" ? "wide" : undefined;

  return (
    <RequestActionsContext.Provider value={value}>
      {children}

      {enabled && (
        <>
          {/* Look at files no Request and has no fields, so it gets its own
          plain modal rather than being forced through the Requests popup. It
          does call the server, but only to read (examineActions.js). */}
          {/* `targetId` is seeded by open("examine", null, { targetId }) —
              Chat's HERE rows and its feed rows both name the person
              before the dialog opens, so the picker is skipped. Read only
              while Look at is the open mode: the same state backs every other
              dialog's target. */}
          <ExamineDialog
            open={mode === "examine"}
            targetId={mode === "examine" ? targetId || null : null}
            onClose={() => setMode(null)}
          />

          {Dialog && (
            <ActionPoolsContext.Provider value={bag}>
              <Dialog mode={mode} presets={presets ?? {}} onDone={done} onClose={() => setMode(null)} />
            </ActionPoolsContext.Provider>
          )}

          <RequestDialog
            open={mode !== null && !Dialog && !NO_REQUEST_MODES.has(mode)}
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
