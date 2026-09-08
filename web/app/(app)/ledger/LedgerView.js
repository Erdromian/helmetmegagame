"use client";

import Link from "next/link";
import CharacterLedger from "@/app/components/CharacterLedger";
import EmptyState from "@/app/components/EmptyState";

// The /ledger half of what character/CharacterView.js draws. Only the sheet
// has a second layout: the lobby, the creation wizard and a closed door are
// one-route affairs, so this points at /character for those rather than
// carrying a second copy of the wizard that would then drift from the first.
//
// No PageShell: the layout above owns the header, and the sheet fills the
// shell's body (layout.js).
export default function LedgerView({ kind, sheet }) {
  if (kind === "sheet") return <CharacterLedger {...sheet} />;
  return (
    <div className="sheet-body p-4">
      <EmptyState>
        This account has no living character to draw yet. Make one on{" "}
        <Link href="/character">the character page</Link>. ‡
      </EmptyState>
    </div>
  );
}
