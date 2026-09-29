"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import IngredientSlots from "../IngredientSlots";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { trinketRequest } from "@/app/(app)/character/trinketActions";
import { CUSTOM_NAME_MAX, CUSTOM_DESCRIPTION_MAX } from "@/lib/customCraft";
// Safe from a client component: db/lib/constants.js is a leaf of bare strings
// and numbers with no requires at all.
import { TRINKET_RESOURCE_COST, TRINKET_INLAY_SLOTS } from "@lifeweb/db/lib/constants";

// Make a Trinket (TRINKETS.md): the forge's own Gambit, so this dialog never
// says what the Trinket will be worth. It takes the words and up to two stones,
// and the die decides the rest when the turn ends. Only a smith ever opens it;
// the stones are theirs, read in character/page.js (db/lib/trinket.js).
export default function TrinketDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const stones = (pools.trinketStones ?? []).map((s) => ({ slug: s.slug, name: s.name, held: s.quantity }));
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Make a Trinket"
      submitLabel="Start work"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => trinketRequest({ name, description, ingredientSlugs: picked }),
          (res) => onDone(res.line),
        )
      }
    >
      <p className="text-sm">
        {`You spend your whole Move at the forge. It costs ${TRINKET_RESOURCE_COST} ⬢, and any stones you set in are used up now. You find out how well it came out when the turn ends.`}
      </p>
      <div className="field">
        <span className="field-label">Stones (optional)</span>
        <IngredientSlots
          min={0}
          max={TRINKET_INLAY_SLOTS}
          options={stones}
          value={picked}
          onChange={setPicked}
          emptyLabel="You aren't carrying anything to set into it."
        />
      </div>
      <label className="field">
        <span className="field-label">Name it (optional)</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          maxLength={CUSTOM_NAME_MAX}
        />
      </label>
      <label className="field">
        <span className="field-label">Describe it (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={CUSTOM_DESCRIPTION_MAX}
        />
      </label>
      <p className="text-xs text-muted">Left unnamed, it&apos;s named for how well it came out.</p>
    </ActionDialog>
  );
}
