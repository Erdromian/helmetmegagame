"use client";

import { useState } from "react";
import StackPicker, { pickedLines } from "../StackRow";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { packableTags } from "@/lib/tagRequests";
import { packageItemsRequest } from "@/app/(app)/character/requestActions";
// Safe from a client component: db/lib/constants.js is a leaf of bare strings
// and numbers with no requires at all.
import { PACKAGE_MAX_LBS, PACKAGE_LABEL_MAX } from "@lifeweb/db/lib/constants";

// Package (docs/systemdocs/FACTORY.md): what goes in the crate, as rows with
// a count, and the line printed on its side. The lb readout is what stops
// somebody filling a form they can't submit; the server recomputes it.
export default function PackageDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const { roster } = useRoster(["self"], { seed: { self: { characterTags: pools.characterTags ?? [] } } });
  const packable = packableTags(roster?.self?.characterTags ?? []);
  const [picks, setPicks] = useState({});
  const [label, setLabel] = useState("");
  const { submit, busy, error } = useSubmit();

  const rows = packable.map((t) => ({
    id: t.id,
    name: t.name,
    held: t.quantity,
    max: t.stackable ? t.quantity : 1,
    note: `${t.weightLbs ?? 0} lb`,
  }));
  const lines = pickedLines(picks);
  const packedLbs = lines.reduce((sum, l) => sum + (packable.find((t) => t.id === l.tagId)?.weightLbs ?? 0) * l.quantity, 0);
  const crateLbs = Math.max(1, Math.ceil(packedLbs / 2));

  return (
    <ActionDialog
      title="Package"
      submitLabel="Pack it"
      width="wide"
      busy={busy}
      error={error}
      empty={rows.length === 0 ? "You aren't carrying anything that could go in a crate." : null}
      canSubmit={lines.length > 0 && label.trim().length > 0 && packedLbs <= PACKAGE_MAX_LBS}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => packageItemsRequest({ lines: lines.map((l) => ({ tagId: l.tagId, quantity: String(l.quantity) })), label }),
          () => onDone(`Packed into a ${crateLbs} lb crate, marked "${label.trim()}". ‡`),
        )
      }
    >
      <span className="field-label">What goes in?</span>
      <StackPicker rows={rows} picks={picks} onChange={setPicks} />
      <label className="field">
        <span className="field-label">What does the crate say?</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Squeeze, 7 cubes"
          autoComplete="off"
          maxLength={PACKAGE_LABEL_MAX}
          required
        />
      </label>
      <p className={packedLbs > PACKAGE_MAX_LBS ? "text-sm text-accent" : "text-xs text-muted"}>
        {`${packedLbs} / ${PACKAGE_MAX_LBS} lb packed. The crate will weigh ${crateLbs} lb. `}
        {packedLbs > PACKAGE_MAX_LBS
          ? "That won't go in one crate."
          : "Nobody checks the line on the side against what's actually in there."}
      </p>
    </ActionDialog>
  );
}
