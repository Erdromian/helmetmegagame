"use client";

import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { TableScroll } from "@/app/components/DataTable";
import { previewAssignment, setDraftRow } from "@/app/(app)/gm/dev/gameActions";

// The previewed roll (docs/systemdocs/LOBBY.md §3): player -> seat, with the
// pass that seated them and a hand-set dropdown per row. Re-roll asks for a
// fresh seed; Start (on GameControls) commits exactly this table.

const SOURCE_LABEL = { HIGH: "High", MEDIUM: "Medium", LOW: "Low", FALLBACK: "Fallback", GM: "Hand-set" };

export default function AssignmentPreview({ draft, rows, roles }) {
  const { run, pending, error } = useActionRunner();

  if (!draft) {
    return (
      <div className="flex flex-col gap-2">
        <p className="ops-lede">No preview yet. Roll one to see who would get what before you start. ‡</p>
        <div className="ops-actions">
          <button type="button" className="btn" onClick={() => run(previewAssignment)} disabled={pending}>
            {pending ? "Rolling…" : "Preview assignment"}
          </button>
        </div>
        <FormError>{error}</FormError>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="mono">seed {draft.seed}</span>
        <span>{rows.length} players</span>
        <span>player count {draft.playerCount}</span>
        <span>rolled {new Date(draft.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      </div>
      {draft.warnings?.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {draft.warnings.map((w) => (
            <li key={w} className="text-accent">⚠ {w}</li>
          ))}
        </ul>
      ) : null}
      <TableScroll minWidth="720px">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Role</th>
            <th scope="col">Source</th>
            <th scope="col">Hand-set</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.discordUserId}>
              <td className="mono">{r.handle}</td>
              <td>{r.roleName ?? <span className="text-muted">— (lobby)</span>}</td>
              <td className="text-xs text-muted">{SOURCE_LABEL[r.source] ?? r.source ?? "—"}</td>
              <td>
                <Select
                  value={r.roleSlug ?? ""}
                  onChange={(e) => run(setDraftRow, { discordUserId: r.discordUserId, roleSlug: e.target.value })}
                  disabled={pending}
                  aria-label={`Seat for ${r.handle}`}
                >
                  <option value="">Return to lobby</option>
                  {roles.map((role) => (
                    <option key={role.slug} value={role.slug}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <div className="ops-actions">
        <button type="button" className="btn-secondary" onClick={() => run(previewAssignment)} disabled={pending}>
          {pending ? "Rolling…" : "Re-roll"}
        </button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
