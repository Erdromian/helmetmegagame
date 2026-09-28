"use client";

// The one button a Skinless respawn needs (db/lib/skinless.js): no wizard, no
// form, just a confirm. Shared by the wizard's Lateparty section and the
// muster page. The confirm is awaited OUTSIDE the transition, for the reason
// LatePartyPanel.js gives: a dialog opened inside an action never paints.
import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { actionThrowMessage } from "@/app/components/actionThrow";
import { respawnAsSkinless } from "./skinlessActions";

export const SKINLESS_RESPAWN_LABEL = "Respawn as a Skinless";

export default function SkinlessRespawn({ className = "btn" }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  async function onClick() {
    setError(null);
    const ok = await confirm({
      title: "Respawn as a Skinless?",
      message: "You don't choose a name, a face or your tags. Your body is made for you, and you emerge immediately.",
      confirmLabel: "Respawn",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        // A successful respawn redirects, so anything returned is a refusal.
        const result = await respawnAsSkinless();
        if (result?.error) setError(result.error);
      } catch (err) {
        if (err?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
        setError(actionThrowMessage(err));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" className={className} onClick={onClick} disabled={pending}>
          {pending ? "Waking…" : SKINLESS_RESPAWN_LABEL}
        </button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
