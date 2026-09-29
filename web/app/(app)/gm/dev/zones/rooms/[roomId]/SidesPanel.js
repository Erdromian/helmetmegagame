"use client";

import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { addRoomSide, updateRoomSide, removeRoomSide } from "../../actions";

// The other Locations this room opens onto — a window, a counter
// (docs/systemdocs/MAP.md §2d). The Room form above is the HOME side, gated by
// its own Kind and Access. Each row here is one more Location, gated on its own:
// an empty access list is a public side, any slug makes it private. People on
// different sides share the room's talk and its stash, never a Location, so
// nothing done to a person reaches across.
export default function SidesPanel({ roomId, homeName, sides, locations }) {
  const { call, pending, error } = useActionRunner();
  const confirm = useConfirm();
  const taken = new Set(sides.map((s) => s.locationId));
  const open = locations.filter((l) => !taken.has(l.id));

  function onAdd(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    call(addRoomSide, roomId, {
      locationId: form.get("locationId"),
      accessTagSlugs: form.get("accessTagSlugs"),
      sortOrder: form.get("sortOrder"),
    });
    e.currentTarget.reset();
  }

  function onSave(e, side) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    call(updateRoomSide, side.id, side.updatedAt, {
      accessTagSlugs: form.get("accessTagSlugs"),
      sortOrder: form.get("sortOrder"),
    });
  }

  async function onRemove(side) {
    if (
      !(await confirm({
        title: `Close it off from ${side.locationName}?`,
        message:
          "People standing there stop being in this room, anyone let in on that side loses the pass, and its Discord thread there is deleted.",
        confirmLabel: "Close it off",
      }))
    )
      return;
    call(removeRoomSide, side.id);
  }

  return (
    <Panel title="Also opens onto">
      <p className="text-muted text-sm">
        Home: {homeName}. Everyone in the room from any side can talk and pass things by leaving them here, and sees
        the others under Who&apos;s here, but can only act on people standing where they stand.
      </p>
      <FormError>{error}</FormError>
      <div className="overflow-x-auto">
        <table className="mono-table w-full">
          <thead>
            <tr>
              <th scope="col">Location</th>
              <th scope="col">Access tag slugs (blank for public)</th>
              <th scope="col">Sort</th>
              <th scope="col">Discord</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sides.map((side) => (
              <tr key={side.id}>
                <td>{side.locationName}</td>
                {/* One row, one form: the inputs sit in their own cells and join it by `form`. */}
                <td>
                  <input
                    form={`side-${side.id}`}
                    name="accessTagSlugs"
                    defaultValue={side.accessTagSlugs}
                    className="control"
                    aria-label={`Access tag slugs from ${side.locationName}`}
                  />
                </td>
                <td>
                  <input
                    form={`side-${side.id}`}
                    name="sortOrder"
                    type="number"
                    defaultValue={side.sortOrder}
                    className="control"
                    aria-label={`Sort order at ${side.locationName}`}
                  />
                </td>
                <td className="text-muted">{side.hasThread ? "thread" : "not yet"}</td>
                <td>
                  <form id={`side-${side.id}`} className="flex gap-2" onSubmit={(e) => onSave(e, side)}>
                    <button type="submit" className="btn-quiet" disabled={pending}>
                      Save
                    </button>
                    <button type="button" className="btn-quiet" disabled={pending} onClick={() => onRemove(side)}>
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {sides.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  Only {homeName}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="flex flex-col gap-2" onSubmit={onAdd}>
        <label className="field">
          <span className="field-label">Open onto</span>
          <select name="locationId" required defaultValue="">
            <option value="" disabled>
              Pick a Location
            </option>
            {open.map((l) => (
              <option key={l.id} value={l.id}>
                {l.zoneName} · {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Access tag slugs from there (comma-separated; blank for public)</span>
          <input name="accessTagSlugs" className="control" />
        </label>
        <label className="field">
          <span className="field-label">Sort order there</span>
          <input name="sortOrder" type="number" defaultValue={0} className="control" />
        </label>
        <button type="submit" className="btn" disabled={pending}>
          Add
        </button>
      </form>
    </Panel>
  );
}
