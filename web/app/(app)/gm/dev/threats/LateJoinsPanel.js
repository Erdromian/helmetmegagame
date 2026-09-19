"use client";

// The Late joins table (/gm/dev?s=latejoins): which of the candidate roles are
// open, how many chairs each has, and how many are already sat in.
//
// One row per candidate in db/lib/lateJoin.js, always — a seat nobody has
// touched draws as off with zero chairs rather than as a missing row, so the
// table reads as a catalog rather than as a log of what a GM happened to click.
// Everything arrives flat from the page, so this file imports nothing from
// db/lib.
import { useState } from "react";
import FormError from "@/app/components/FormError";
import SubmitButton from "@/app/components/SubmitButton";
import { updateLateJoinRole } from "@/app/(app)/gm/dev/lateJoinActions";

function LateJoinRow({ row }) {
  const [error, setError] = useState(null);

  async function onSubmit(formData) {
    setError(null);
    const result = await updateLateJoinRole(formData);
    if (result?.error) setError(result.error);
  }

  const missing = !row.roleName;
  return (
    <tr>
      <td>
        <strong>{row.roleName ?? row.roleSlug}</strong>
        {missing ? (
          // Said out loud rather than hidden: "the seat is missing" is exactly
          // the answer a GM needs, and the fix is one sync away.
          <span className="text-danger"> · no Role row — run db:sync-roles</span>
        ) : null}
        {row.startingZoneName ? <span className="text-muted"> · {row.startingZoneName}</span> : null}
      </td>
      <td className="mono">
        {row.taken} / {row.slots}
      </td>
      <td>
        <form action={onSubmit} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="roleSlug" value={row.roleSlug} />
          <label className="field flex items-center gap-2">
            <input type="checkbox" name="enabled" defaultChecked={row.enabled} />
            <span>Open</span>
          </label>
          <label className="field">
            <span className="sr-only">Slots</span>
            <input
              type="number"
              name="slots"
              min="0"
              max="999"
              defaultValue={row.slots}
              className="w-20"
            />
          </label>
          <SubmitButton>Save</SubmitButton>
        </form>
        <FormError>{error}</FormError>
      </td>
    </tr>
  );
}

export default function LateJoinsPanel({ rows }) {
  return (
    <div className="desk-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Taken</th>
            <th>Slots</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <LateJoinRow key={row.roleSlug} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
