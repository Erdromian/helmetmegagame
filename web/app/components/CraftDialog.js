"use client";

import PartySelect from "./PartySelect";
import Select from "./Select";
import { needsWorkshop } from "@/lib/tagRequests";
import { craftFamilyLabel, formatMoveFraction } from "@/lib/craftBudget";
import {
  CUSTOM_SURCHARGE,
  CUSTOM_NAME_MAX,
  CUSTOM_DESCRIPTION_MAX,
  INSCRIPTION_MAX,
  customCraftFields,
  customCraftName,
} from "@/lib/customCraft";
import QuantityField from "./QuantityField";

// The body of the Craft dialog (docs/systemdocs/CRAFTING.md). State lives in
// RequestActionsProvider like every other mode — this is the form.
//
// Two jobs in one dialog. Pick something you already have going and the
// form becomes Continue / Cancel for it; pick nothing and it's the recipe
// menu (the provider's TagPicker, passed in as `picker`), a quantity for a
// stackable, and who pays. A recipe with turns is this turn's Move, and the
// form says so before the confirm does.
//
// "Something you have going" is two lists, not one. A CraftProject is yours
// alone; a build site standing where you are is anybody's to lend a turn to
// (db/lib/structures.js), so the two share the one dropdown under separate
// groups. The pick crosses as a prefixed key because a select has one value
// and these are two id spaces.

export default function CraftDialog({
  projects,
  projectId,
  // Build sites UNDER_CONSTRUCTION at this Location, and which one is picked.
  sites = [],
  siteId = "",
  // Takes "" | "project:<id>" | "site:<id>".
  onPick,
  projectChoice,
  onProjectChoice,
  picker,
  chosen,
  stacking,
  quantity,
  onQuantity,
  // The Move budget (docs/systemdocs/CRAFTING.md §2a), all of it priced by the
  // provider off server-computed numbers: what the turn's Routine is already
  // committed to (`budget`), what this order costs of the Move (`moveCost`),
  // the recipe's free ration and what is left of it today (`allowance`),
  // whether the turn can still pay (`moveOk`), and the count the stepper stops
  // at (`quantityMax` — ingredients and budget, whichever runs out first).
  quantityMax = 99,
  budget = null,
  moveCost = null,
  allowance = null,
  moveOk = true,
  // The one ingredient a recipe leaves to the player: { label, options } for
  // an `anyOf` entry, already narrowed to what this character holds, or null.
  ingredientPick = null,
  ingredientChoice = "",
  onIngredientChoice,
  // Custom-item fields on a `customizable` recipe, and the builder's line on
  // an inscribable placement (CRAFTING.md). Raw as typed — the shared
  // cleaner in web/lib/customCraft.js is the one verdict on what counts.
  customName = "",
  onCustomName,
  customDescription = "",
  onCustomDescription,
  inscription = "",
  onInscription,
  payerKey,
  onPayer,
  parties,
  selfId,
  hasMoved,
  hasWorkshop = false,
}) {
  const project = projects.find((p) => p.id === projectId) ?? null;
  const site = sites.find((s) => s.id === siteId) ?? null;
  const inProgress = project ? `project:${project.id}` : site ? `site:${site.id}` : "";
  const projectOptions = projects.map((p) => (
    <option key={p.id} value={`project:${p.id}`}>
      {p.quantity > 1 ? `${p.quantity}× ` : ""}
      {p.tagName} — {p.turnsDone} of {p.turnsNeeded} turns ‡
    </option>
  ));
  const turns = chosen?.requirementTurns ?? 1;
  const qty = Math.max(1, Number(quantity) || 1);
  // The same shared verdict the server bills by: customized words are
  // +CUSTOM_SURCHARGE ⬢ a unit, and blank-after-cleaning fields cost nothing.
  const custom = chosen?.customizable
    ? customCraftFields({ customName, customDescription })
    : null;
  const cost =
    ((chosen?.requirementResources ?? 0) + (custom?.active ? CUSTOM_SURCHARGE : 0)) *
    (chosen?.stackable ? qty : 1);
  // Smith's work needs a forge in reach (SMITHING.md). Said here so a player
  // sees it before committing; craftRequest re-checks it regardless — and
  // grants the same fieldwork exemption the server does, or the hint would
  // warn about a kit a drying rack never needed.
  const wantsWorkshop = chosen ? needsWorkshop(chosen) && !chosen.placement?.fieldwork : false;
  // Ingredients (Tag.requirementItems). Spent and kept are said separately,
  // because they are different bargains: a spend scales with the count and
  // leaves the sheet, a keep is a thing you have to be holding and still have
  // afterwards. Said here rather than only on the chip, since this is the
  // moment it costs something.
  const units = chosen?.stackable ? qty : 1;
  const spends = (chosen?.requirementItems ?? [])
    .filter((i) => !i.keep)
    .map((i) => (units > 1 ? `${units} × ${i.label}` : i.label));
  const keeps = (chosen?.requirementItems ?? [])
    .filter((i) => i.keep)
    .map((i) => i.label);
  const ingredientNote = [
    spends.length ? `Uses up ${spends.join(" and ")}.` : null,
    keeps.length
      ? `Needs ${keeps.join(" and ")} to hand, which isn't used up.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {(projects.length > 0 || sites.length > 0) && (
        <label className="field">
          <span className="field-label">In progress ‡</span>
          <Select value={inProgress} onChange={(e) => onPick(e.target.value)}>
            <option value="">Start something new… ‡</option>
            {/* Grouped only when there is a second group to tell them apart
                from — one list of your own projects reads better bare. */}
            {projects.length > 0 &&
              (sites.length > 0 ? (
                <optgroup label="Your work ‡">{projectOptions}</optgroup>
              ) : (
                projectOptions
              ))}
            {sites.length > 0 && (
              <optgroup label="Build sites here ‡">
                {sites.map((s) => (
                  <option key={s.id} value={`site:${s.id}`}>
                    {s.typeName} ({s.turnsDone}/{s.turnsNeeded}) ‡
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </label>
      )}

      {site ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="craft-project"
                checked={projectChoice === "continue"}
                onChange={() => onProjectChoice("continue")}
                disabled={hasMoved}
              />
              Keep working on it ‡
            </label>
            {/* Only the person who opened the site may call it off, and
                cancelBuildSite refuses anyone else regardless. */}
            {site.mine && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="craft-project"
                  checked={projectChoice === "cancel"}
                  onChange={() => onProjectChoice("cancel")}
                />
                Give it up ‡
              </label>
            )}
          </div>
          <p className="text-xs text-muted">
            {hasMoved
              ? "You've used your Move this turn, so the work waits. ‡"
              : `One more turn of work — your Move for this turn. ${site.turnsNeeded - site.turnsDone === 1 ? "That finishes it." : `${site.turnsNeeded - site.turnsDone} to go.`} ‡`}
          </p>
        </>
      ) : project ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="craft-project"
                checked={projectChoice === "continue"}
                onChange={() => onProjectChoice("continue")}
                disabled={hasMoved || project.workedThisTurn}
              />
              Keep working on it ‡
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="craft-project"
                checked={projectChoice === "cancel"}
                onChange={() => onProjectChoice("cancel")}
              />
              Give it up ‡
            </label>
          </div>
          <p className="text-xs text-muted">
            {project.workedThisTurn
              ? "You've already put this turn into it. Come back next turn. ‡"
              : hasMoved
                ? "You've used your Move this turn, so the work waits. ‡"
                : `One more turn of work — your Move for this turn. ${project.turnsNeeded - project.turnsDone === 1 ? "That finishes it." : `${project.turnsNeeded - project.turnsDone} to go.`} ‡`}
            {project.resourcesCost
              ? ` The ${project.resourcesCost} ⬢ went into materials when you started and don't come back. ‡`
              : ""}
          </p>
        </>
      ) : (
        <>
          {/* What this turn's Routine is already doing, if anything. A craft
              Routine takes one family of work and a fraction of the Move at a
              time, so the menu below is narrower than it looks. */}
          {budget && (
            <p className="text-xs text-accent">
              {budget.remainingNum > 0
                ? `Your Routine this turn is ${craftFamilyLabel(budget.family)} work — ${formatMoveFraction(budget.remainingNum, budget.remainingDen)} of your Move is left. ‡`
                : `Your Routine this turn is spent on ${craftFamilyLabel(budget.family)} work. ‡`}
            </p>
          )}
          {picker}
          {chosen && (
            <>
              {/* The cap is the first of three to run out: the ingredients on
                  your own sheet, what the Move can still pay for, and the
                  server's own clamp of 99 (craftRequestImpl's parseCount).
                  Typed values past it are refused server-side, not here. */}
              {stacking && (
                <QuantityField
                  label="How many? ‡"
                  max={quantityMax}
                  value={quantity}
                  onChange={onQuantity}
                />
              )}
              {ingredientPick &&
                (ingredientPick.options.length > 0 ? (
                  <label className="field">
                    <span className="field-label">
                      Which goes in? ‡
                    </span>
                    <Select
                      value={ingredientChoice}
                      onChange={(e) => onIngredientChoice(e.target.value)}
                    >
                      <option value="">Choose one… ‡</option>
                      {ingredientPick.options.map((o) => (
                        <option key={o.slug} value={o.slug}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : (
                  <p className="text-xs text-accent">
                    This needs {ingredientPick.label}, and you have none of
                    them. ‡
                  </p>
                ))}
              {chosen.customizable && (
                <>
                  <label className="field">
                    <span className="field-label">Name it (optional) ‡</span>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => onCustomName(e.target.value)}
                      autoComplete="off"
                      maxLength={CUSTOM_NAME_MAX}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Describe it (optional) ‡</span>
                    <textarea
                      value={customDescription}
                      onChange={(e) => onCustomDescription(e.target.value)}
                      rows={2}
                      maxLength={CUSTOM_DESCRIPTION_MAX}
                    />
                  </label>
                  {custom?.active && (
                    <p className="text-xs text-muted">
                      Your words on your work, +{CUSTOM_SURCHARGE} ⬢ each. It
                      will read as “{customCraftName(chosen.name, custom.name)}”. ‡
                    </p>
                  )}
                </>
              )}
              {chosen.placement?.inscribable && (
                <>
                  <label className="field">
                    <span className="field-label">
                      Write something on it (optional) ‡
                    </span>
                    <textarea
                      value={inscription}
                      onChange={(e) => onInscription(e.target.value)}
                      rows={2}
                      maxLength={INSCRIPTION_MAX}
                    />
                  </label>
                  <p className="text-xs text-muted">
                    Whoever examines it will read your words in place of the
                    usual line. ‡
                  </p>
                </>
              )}
              {cost > 0 && (
                <PartySelect
                  label="Paid for by ‡"
                  value={payerKey}
                  onChange={onPayer}
                  hint="Choose who pays… ‡"
                  characters={parties?.characters ?? []}
                  rooms={parties?.rooms ?? []}
                  selfId={selfId}
                />
              )}
              <p className="text-xs text-muted">
                {turns === 0
                  ? allowance
                    ? chosen.requirementPerTurn != null
                      ? // This recipe rations ITSELF — the count only moves
                        // when you make more of this one thing.
                        `No Move needed for the first ${allowance.per} of these a turn, and ${allowance.left} of those are left today. ‡`
                      : // The pool is SHARED across every Dead Simple recipe, so
                        // the count moves when you make a different simple item —
                        // said here, or the number reads as a per-recipe cap.
                        `No Move needed for the first ${allowance.per} simple things a turn — shared across all of them — and ${allowance.left} of those are left today. ‡`
                    : "No Move needed. ‡"
                  : turns === 1
                    ? moveCost?.kind === "share"
                      ? `One turn of work, and ${formatMoveFraction(moveCost.num, moveCost.den)} of your Move — up to ${moveCost.allowance} a turn. ‡`
                      : "One turn of work — this is your Move for the turn. ‡"
                    : chosen.placement
                      ? // The crew-turns pitch, said at the point of decision:
                        // a build site is anybody's to advance, which is the
                        // one way it differs from a project of your own.
                        `${turns} turns of work, and not necessarily yours alone: anyone standing at the site can put their Move into it. This turn is the first. ‡`
                      : `${turns} turns of work. This turn is the first; come back here to continue. ‡`}
                {cost > 0 ? ` Costs ${cost} ⬢, paid now. ‡` : " Costs nothing. ‡"}
                {/* Past the free ration: a recipe with a craft family bills
                    the overflow to the Move; one without (a butcher's mask)
                    simply cannot go past it. */}
                {moveCost?.kind === "spill"
                  ? ` The ${moveCost.billedQty} past that ${moveCost.billedQty === 1 ? "spends" : "spend"} ${formatMoveFraction(moveCost.num, moveCost.den)} of your Move. ‡`
                  : ""}
                {moveCost?.kind === "capped"
                  ? ` You can't make more than ${moveCost.allowance} in a turn. ‡`
                  : ""}
                {!moveOk && moveCost?.kind !== "capped"
                  ? budget
                    ? budget.family !== moveCost?.family
                      ? ` Your Routine this turn is ${craftFamilyLabel(budget.family)} work, and this isn't. ‡`
                      : " There isn't enough of your Move left this turn. ‡"
                    : hasMoved
                      ? " You've already used your Move this turn. ‡"
                      : " That's more than a turn's work — make fewer at once. ‡"
                  : ""}
              </p>
              {ingredientNote && (
                <p className="text-xs text-muted">{`${ingredientNote} ‡`}</p>
              )}
              {wantsWorkshop && (
                <p className={`text-xs ${hasWorkshop ? "text-muted" : "text-accent"}`}>
                  {hasWorkshop
                    ? "Smith's work, and the means are in reach — a kit to hand, or one standing where you are. ‡"
                    : "Smith's work: you need Workshop Equipment, held or set up where you're standing. ‡"}
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
