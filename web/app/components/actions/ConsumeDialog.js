"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import ConsumeChoiceDialog from "./ConsumeChoiceDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { consumableTags } from "@/lib/tagRequests";
import { consumeTagRequest } from "@/app/(app)/character/requestActions";
import { fitsInRemaining } from "@/lib/craftBudget";

// Consume: one of the things in your pockets that can be used up, as chips.
// Nothing about what it leaves behind — that is the tag's own business, and
// the tag chip on the sheet is the one-click way in anyway.
export default function ConsumeDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster } = useRoster(["self"], { seed: { self: { characterTags: pools.characterTags ?? [] } } });
  const [tagId, setTagId] = useState(presets?.tagId ?? "");
  const [targetId, setTargetId] = useState(presets?.targetId ?? "");
  const [quantity, setQuantity] = useState(1);
  const { submit, busy, error } = useSubmit();

  const consumable = consumableTags(roster?.self?.characterTags ?? []);
  const chosen = consumable.find((t) => t.id === tagId) ?? null;
  // Only for a cure/administerable item — targeting someone else with an
  // ordinary meal would only ever be refused server-side, so the picker
  // stays hidden rather than offering a choice that can't work.
  const administerable = Boolean(chosen && (chosen.cures?.length > 0 || chosen.administerable));
  // The slider's top end (the Soilery Rework doc): what you hold, or how many
  // you can eat before you are full, whichever is lower. Worked out on the
  // server (web/lib/eatLimits.js); 0 means you are too full for this food.
  const eatMax = roster?.self?.eatMax ?? pools.eatMax ?? {};
  const max = chosen ? (eatMax[chosen.id] ?? (chosen.stackable ? chosen.quantity : 1)) : 0;
  const tooFull = Boolean(chosen) && max === 0;
  const count = Math.min(Math.max(1, quantity), Math.max(1, max));
  const slider = Boolean(chosen) && chosen.stackable && max > 1 && !administerable && !chosen.administerSkill;
  const consumeTargets = pools.consumeTargets ?? [];
  const craftBudget = pools.craftBudget ?? null;
  const hasMoved = Boolean(pools.hasMoved);

  // The Instrument Kit asks its own question (consumeChoice), so picking it hands over
  // to that dialog rather than spending it blind.
  if (chosen?.consumeChoice?.length) {
    return <ConsumeChoiceDialog tag={chosen} mode={mode} onDone={onDone} onClose={onClose} />;
  }

  return (
    <ActionDialog
      title="Consume"
      busy={busy}
      error={error}
      empty={consumable.length === 0 ? "Nothing you're carrying can be used up." : null}
      canSubmit={Boolean(chosen) && !tooFull}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () =>
            // Only sent for a cure/administerable item — matches the
            // picker's own visibility rule below, so a stale target left
            // over from a previous pick can never ride along on a plain meal.
            consumeTagRequest({
              tagId: chosen.id,
              targetCharacterId: administerable && targetId ? targetId : undefined,
              quantity: slider ? count : 1,
            }),
          (res) => onDone(noticeLine(mode, res, { name: chosen.name })),
        )
      }
    >
      <ChipPicker
        label="What are you using up?"
        options={consumable.map((t) => ({
          id: t.id,
          label: t.name,
          note: t.quantity > 1 ? `×${t.quantity}` : null,
        }))}
        value={tagId}
        onChange={(id) => {
          setTagId(id);
          setTargetId("");
          setQuantity(1);
        }}
      />
      {tooFull && <p className="text-xs text-accent">You&apos;re too full to eat that.</p>}
      {slider && (
        <label className="field">
          <span className="field-label">
            How many? <span className="mono">{count}</span>
          </span>
          <input
            type="range"
            min={1}
            max={max}
            step={1}
            value={count}
            onChange={(e) => setQuantity(Number(e.target.value) || 1)}
          />
        </label>
      )}
      {chosen && chosen.quantity > 1 && !slider && !tooFull && (
        <p className="text-xs text-muted">Takes one of your {chosen.quantity}.</p>
      )}
      {administerable && consumeTargets.length > 0 && (
        <ChipPicker
          label="Give it to"
          options={[{ id: "", label: "Yourself" }, ...consumeTargets.map((t) => ({ id: t.id, label: t.name }))]}
          value={targetId}
          onChange={setTargetId}
        />
      )}
      {/* administerSkill's Move fee (M2, CRAFTING.md §2a / TAGS.md §5c) —
          fitting is surgery, even on your own leg. Same spent-Move warning
          shape as the Heal dialog's below: a fixed 1/2 of the
          medical family, checked against whatever Move is already filed
          — including an ordinary declared Move, a Gambit or a build turn,
          which files an Action but no craftBudget ledger at all. */}
      {chosen?.administerSkill && (
        <>
          <p className="text-xs text-muted">This costs half your Move.</p>
          {craftBudget ? (
            !fitsInRemaining(
              { num: 1, den: 2 },
              { num: craftBudget.remainingNum, den: craftBudget.remainingDen },
            ) ? (
              <p className="text-xs text-accent">Your Move is spent for this turn.</p>
            ) : null
          ) : hasMoved ? (
            <p className="text-xs text-accent">{`You've already used your Move this turn.`}</p>
          ) : null}
        </>
      )}
    </ActionDialog>
  );
}
