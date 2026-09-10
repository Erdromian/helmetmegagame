"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { useTags } from "../TagsProvider";
import { consumableTags } from "@/lib/tagRequests";
import { heldSlugsOf } from "@/lib/consumeGrants";
import {
  consumeTagRequest,
  poisonItemRequest,
  poisonCharacterRequest,
} from "@/app/(app)/character/requestActions";

// Poison: lace a held meal/drink, dose someone helpless standing here, or
// drink it yourself — an ordinary Consume, no new server logic for that
// third one (docs/systemdocs/TAGS.md §5c, M4). Three chip rows, each
// appearing once the one above is answered — the same shape HealDialog and
// ConsumeDialog use. Reuses `consumableTags` off the same live self-roster
// ConsumeDialog reads, so the two never disagree on what a poison's own
// consumesInto grants.
export default function PoisonDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster } = useRoster(["self"], { seed: { self: { characterTags: pools.characterTags ?? [] } } });
  const { tagsBySlug } = useTags();
  const [tagId, setTagId] = useState(presets?.tagId ?? "");
  // "food" (lace a held meal/drink), "person" (dose someone helpless here) or
  // "self" (drink it — an ordinary Consume posted from this dialog).
  const [poisonUse, setPoisonUse] = useState("");
  const [targetId, setTargetId] = useState("");
  const { submit, busy, error } = useSubmit();

  const characterTags = roster?.self?.characterTags ?? [];
  const consumable = consumableTags(characterTags);
  // The poison-use dialog's own two narrowed views over `consumable` (M4):
  // held poisons (what the chip click and the grid button both offer), and
  // held food/drink a poison could lace — never another poison (you can't
  // lace the bottle itself), and only the two groups the plan names.
  const poisonable = consumable.filter((t) => t.poison);
  const foodTargets = consumable.filter(
    (t) => !t.poison && (t.group?.slug === "items-food" || t.group?.slug === "items-drink"),
  );
  const doseTargets = pools.doseTargets ?? [];

  const chosen = poisonable.find((t) => t.id === tagId) ?? null;
  const heldSlugs = heldSlugsOf(characterTags);
  const nameOf = (slug) => tagsBySlug.get(slug)?.name ?? slug;
  // Slug -> name for the self branch's "Becomes:" line. A consumesIntoOneOf
  // position isn't resolved via resolveConsumeGrants here (that rolls a real
  // pick); rendered as "A or B" off the raw sidecar instead, so the preview
  // stays honest — same rule ConsumeDialog's old monolith form used.
  const becomes = (chosen?.consumesInto ?? [])
    .map((slug, i) => {
      const blockers = chosen?.consumesIntoUnless?.[slug] ?? null;
      if (blockers?.some((b) => heldSlugs.has(b))) return null;
      const alternatives = chosen?.consumesIntoOneOf?.[i];
      return Array.isArray(alternatives) ? alternatives.map(nameOf).join(" or ") : nameOf(slug);
    })
    .filter(Boolean);

  // Chip note: "×3", "· smells wrong", or both — the same suffix shape the
  // old provider's <option> text used, just as ChipPicker's muted note.
  function stackNote(t) {
    const bits = [t.quantity > 1 ? `×${t.quantity}` : null, t.poisonMarker ? "smells wrong" : null].filter(Boolean);
    return bits.length ? bits.join(" · ") : null;
  }

  function pick(nextTagId) {
    setTagId(nextTagId);
    setPoisonUse("");
    setTargetId("");
  }

  const canSubmit = Boolean(chosen && poisonUse) && (poisonUse === "self" ? true : Boolean(targetId));

  function onSubmit() {
    if (!chosen || !poisonUse) return;
    if (poisonUse === "person") {
      const target = doseTargets.find((t) => t.id === targetId) ?? null;
      submit(
        () => poisonCharacterRequest({ poisonTagId: chosen.id, targetCharacterId: targetId }),
        (res) => onDone(res.line ?? `${target?.name ?? "They"} ${target ? "is" : "are"} dosed.`),
      );
      return;
    }
    if (poisonUse === "self") {
      submit(
        () => consumeTagRequest({ tagId: chosen.id }),
        (res) => onDone(res.line ?? `${chosen.name} used up.`),
      );
      return;
    }
    const target = foodTargets.find((t) => t.id === targetId) ?? null;
    submit(
      () => poisonItemRequest({ poisonTagId: chosen.id, targetTagId: targetId }),
      (res) => onDone(res.line ?? `${chosen.name} goes into ${target?.name ?? "it"}.`),
    );
  }

  return (
    <ActionDialog
      title="Poison"
      busy={busy}
      error={error}
      empty={poisonable.length === 0 ? "You aren't holding a poison." : null}
      canSubmit={canSubmit}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Which poison?"
        options={poisonable.map((t) => ({ id: t.id, label: t.name, note: stackNote(t) }))}
        value={tagId}
        onChange={pick}
      />
      {chosen && (
        <ChipPicker
          label="What are you doing with it?"
          options={[
            { id: "food", label: "Lace a meal or drink" },
            { id: "person", label: "Dose someone helpless here" },
            { id: "self", label: "Drink it yourself" },
          ]}
          value={poisonUse}
          onChange={(next) => {
            setPoisonUse(next);
            setTargetId("");
          }}
        />
      )}
      {chosen && poisonUse === "food" && (
        <>
          <ChipPicker
            label="Lace what?"
            options={foodTargets.map((t) => ({ id: t.id, label: t.name, note: stackNote(t) }))}
            value={targetId}
            onChange={setTargetId}
            emptyLabel="You aren't holding anything it could go in."
          />
        </>
      )}
      {chosen && poisonUse === "person" && (
        <>
          <ChipPicker
            label="Who do you want to dose?"
            options={doseTargets.map((t) => ({ id: t.id, label: `${t.name} — ${t.condition}` }))}
            value={targetId}
            onChange={setTargetId}
            emptyLabel="Nobody here is helpless enough to dose directly."
          />
          <p className="text-xs text-muted">
            {`They have to be helpless.`}
          </p>
        </>
      )}
      {chosen && poisonUse === "self" && (
        <p className="text-xs text-muted">
          {becomes.length ? `Becomes: ${becomes.join(", ")}.` : "Gets used up — it doesn't leave anything behind."}
        </p>
      )}
    </ActionDialog>
  );
}
