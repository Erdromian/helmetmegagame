"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import RichText from "@/app/components/RichText";
import RequestDialog from "@/app/components/RequestDialog";
import DesireCatalog, { cooldownLabel } from "@/app/components/DesireCatalog";
import { claimDesire } from "@/app/(app)/character/requestActions";
import { desireCatalogView } from "./actions";

// The sheet's Desire slots, in the column. Same shape as
// web/app/components/DesirePanel.js and the same claim: a Desire is claimed
// retroactively, so a slot is never occupied — it is open, or cooling down
// from its last claim.
//
// The difference is the catalog. ~271 evaluated templates is a lot to send
// with a page whose Desire block is closed almost every time, so the page
// carries the slots only and the picker fetches the rest of the view the
// first time it is opened (./actions.js#desireCatalogView).
export default function DesiresBlock({ view }) {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  // The evaluated catalog, once somebody has asked for it.
  const [full, setFull] = useState(null);
  const [catalogSlot, setCatalogSlot] = useState(null);
  const [claiming, setClaiming] = useState(null);

  const {
    desireSlots = 2,
    slotStates = [],
    addiction = null,
  } = view ?? {};
  const bySlot = new Map(slotStates.map((s) => [s.slotIndex, s]));
  const bottomIndex = desireSlots - 1;

  function openPicker(slotIndex) {
    setError(null);
    if (full) {
      setCatalogSlot(slotIndex);
      return;
    }
    setLoading(true);
    desireCatalogView()
      .then((res) => {
        setLoading(false);
        if (!res?.ok) return setError(res?.error ?? "Could not load the Desires. ‡");
        setFull(res.view);
        setCatalogSlot(slotIndex);
      })
      .catch(() => {
        setLoading(false);
        setError("Could not reach the server. Nothing was changed. ‡");
      });
  }

  function submitClaim(reason) {
    setError(null);
    startTransition(async () => {
      const res = await claimDesire({ slotIndex: claiming.slotIndex, slug: claiming.entry.slug, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setClaiming(null);
      // The slots came down with the page and the catalog's cooldowns just
      // moved, so both are re-read rather than patched.
      setFull(null);
      router.refresh();
    });
  }

  return (
    <div className="hall-desires">
      <p className="hall-section-title">Desires</p>
      {Array.from({ length: desireSlots }, (_, slotIndex) => {
        const slot = bySlot.get(slotIndex) ?? { slotIndex, lockedUntilTurn: null, lastEnded: null };
        const bound = slotIndex === bottomIndex && addiction;
        return (
          <div key={slotIndex} className="hall-desire-slot">
            {slot.lastEnded && (
              <p className="hall-quiet-line">
                <strong>Last:</strong> <RichText text={slot.lastEnded.text} /> — {slot.lastEnded.points} Tag Point
                {slot.lastEnded.points === 1 ? "" : "s"}
                {cooldownLabel(slot.lastEnded.template) ? ` · ${cooldownLabel(slot.lastEnded.template)}` : ""} ‡
              </p>
            )}
            {slot.lockedUntilTurn != null ? (
              <EmptyState>{`Opens on turn ${slot.lockedUntilTurn}`}</EmptyState>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                disabled={loading || pending}
                onClick={() => openPicker(slotIndex)}
              >
                Claim
              </button>
            )}
            {bound && <p className="hall-quiet-line">Addiction: {addiction.name}</p>}
          </div>
        );
      })}

      <FormError>{error}</FormError>

      {/* Keyed per opening so search, tab and target slot start fresh each
          time — DesireCatalog asks for exactly that. */}
      {full && (
        <DesireCatalog
          key={catalogSlot ?? "closed"}
          open={catalogSlot != null}
          onClose={() => setCatalogSlot(null)}
          onChoose={(pick) => {
            setCatalogSlot(null);
            setClaiming(pick);
          }}
          slotIndex={catalogSlot ?? 0}
          desireSlots={desireSlots}
          slotStates={full.slotStates}
          catalog={full.catalog}
          families={full.families}
          familyGroups={full.familyGroups}
          lockNotes={full.lockNotes}
          addiction={full.addiction}
        />
      )}

      <RequestDialog
        open={Boolean(claiming)}
        title="Claim Desire"
        submitLabel="Claim"
        busy={pending}
        onCancel={() => !pending && setClaiming(null)}
        onConfirm={submitClaim}
      >
        <p className="text-sm">
          <RichText text={claiming?.entry?.name} /> — {claiming?.entry?.tier} Tag Point
          {claiming?.entry?.tier === 1 ? "" : "s"}, into slot {(claiming?.slotIndex ?? 0) + 1} ‡
        </p>
      </RequestDialog>
    </div>
  );
}
