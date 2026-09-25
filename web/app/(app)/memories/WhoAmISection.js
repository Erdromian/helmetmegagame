"use client";

import Link from "next/link";
import EmptyState from "@/app/components/EmptyState";

// What a character knows about themselves (docs/systemdocs/MEMORIES.md §3):
// the four digits that open their account at an ATM, their seat and what it
// asks of them, and how old they are. The fate documents themselves stay on
// /documents, which already routes them by seat; this links there rather than
// printing a second copy.
export default function WhoAmISection({ self }) {
  if (!self) return <EmptyState>You need a living character to remember who you are.</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      <div className="memory-self-grid">
        <div className="field">
          <span className="field-label">Name</span>
          <p className="text-sm font-bold">{self.name}</p>
        </div>
        <div className="field">
          <span className="field-label">Role</span>
          <p className="text-sm">{self.roleTitle ?? "No role"}</p>
        </div>
        <div className="field">
          <span className="field-label">Age</span>
          <p className="text-sm">{self.age ?? "Not set"}</p>
        </div>
        <div className="field">
          <span className="field-label">ATM PIN</span>
          <p className="text-sm mono memory-pin">{self.pin ?? "None"}</p>
        </div>
      </div>

      {self.intro && <p className="text-sm">{self.intro}</p>}
      {self.charter.length > 0 && (
        <ul className="memory-charter text-sm">
          {self.charter.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        Your fate is written out in full on <Link href="/documents">Documents</Link>.
      </p>
    </div>
  );
}
