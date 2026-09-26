"use client";

import useActionRunner from "@/app/components/useActionRunner";
import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { updateRoom } from "../../actions";

export default function RoomForm({ room }) {
  const { call, pending, error } = useActionRunner();
  const confirm = useConfirm();

  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get("name");
    if (name !== room.name) {
      if (!(await confirm({
        title: "Rename this room?",
        message: "This also renames its Discord thread on the next mirror pass.",
        confirmLabel: "Rename",
      }))) return;
    }
    call(updateRoom, room.id, room.updatedAt, {
      name,
      kind: form.get("kind"),
      sortOrder: form.get("sortOrder"),
      description: form.get("description"),
      soundproof: form.get("soundproof") === "on",
      destroysContents: form.get("destroysContents") === "on",
      phone: form.get("phone"),
      payphone: form.get("payphone") === "on",
      vendingMachine: form.get("vendingMachine") === "on",
      accessTagSlugs: form.get("accessTagSlugs"),
    });
  }

  return (
    <Panel title="Room">
      <FormError>{error}</FormError>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="field">
          <span className="field-label">Slug (permanent)</span>
          <input value={room.slug} readOnly disabled className="control" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={room.name} required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue={room.kind}>
            <option value="PUBLIC">PUBLIC</option>
            <option value="PRIVATE">PRIVATE</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Access tag slugs (PRIVATE only, comma-separated)</span>
          <input name="accessTagSlugs" defaultValue={room.accessTagSlugs} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Sort order</span>
          <input name="sortOrder" type="number" defaultValue={room.sortOrder} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea name="description" defaultValue={room.description} className="control" />
        </label>
        <label className="check-row">
          <input type="checkbox" name="soundproof" defaultChecked={room.soundproof} />
          <span>Soundproof</span>
        </label>
        <label className="check-row">
          <input type="checkbox" name="destroysContents" defaultChecked={room.destroysContents} />
          <span>Destroys contents (spillway)</span>
        </label>
        <label className="field">
          <span className="field-label">Phone name (blank for no phone)</span>
          <input name="phone" defaultValue={room.phone ?? ""} className="control" />
        </label>
        <label className="check-row">
          <input type="checkbox" name="payphone" defaultChecked={room.payphone} />
          <span>Payphone (takes an obol to dial or answer)</span>
        </label>
        {/* Read-only: rolled at Start Game, never authored (PHONES.md §2), so a
            GM can answer "whose is 7252?" without anybody being able to set one. */}
        {room.phone ? (
          <p className="text-sm text-muted">
            Number this game: <span className="mono">{room.phoneNumber ?? "given the first time it is picked up"}</span>
          </p>
        ) : null}
        <label className="check-row">
          <input type="checkbox" name="vendingMachine" defaultChecked={room.vendingMachine} />
          <span>Vending machine (the Merchant stocks it and sets the prices)</span>
        </label>
        <button type="submit" className="btn" disabled={pending}>
          Save
        </button>
      </form>
    </Panel>
  );
}
