"use client";

import { useState } from "react";
import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { seedRoomStash } from "../../actions";

// The stash: what's stamped in room/RoomTag rows already, plus the seed
// form. There is deliberately no "adjust quantity" writer here — a stash
// quantity is play state (players carry it off), and the one thing this
// panel is allowed to do to it is add MORE, once, from a fresh authoring
// list. Everyday quantity moves stay in Transfer/Storage on the player side.
//
// Two counts a row: on the floor, and under it (RoomTag.hiddenQuantity —
// SEARCH.md §9). The Hidden box seeds the second the way the first box seeds
// the first, through the same once-per-slug guard.
export default function StashPanel({
  roomId,
  resources,
  hiddenResources = 0,
  stash,
  seededStashSlugs,
  stashSeed,
  destroysContents = false,
  canSuper,
}) {
  const { run, pending, error } = useActionRunner();
  const [result, setResult] = useState(null);

  function onSeed(e) {
    e.preventDefault();
    setResult(null);
    const form = new FormData(e.currentTarget);
    const text = form.get("lines");
    const hidden = form.get("hidden");
    // An arrow rather than `call`, because this is the one here that wants
    // onOk — seedRoomStash reports how many slugs it actually took.
    run(() => seedRoomStash(roomId, text, hidden), undefined, {
      onOk: (res) => setResult(`Seeded ${res.seeded} slug${res.seeded === 1 ? "" : "s"}.`),
    });
  }

  // What the master says this room STARTS with, which stays readable after
  // players have carried half of it off. Same shape parse.js normalises a
  // `stash:` block into; resources are a tag like any other.
  const authored = [
    ...(stashSeed?.resources > 0 ? [`resources: ${stashSeed.resources}`] : []),
    ...(stashSeed?.items ?? []).map(([slug, quantity]) => `${slug}: ${quantity}`),
  ];
  const authoredHidden = (stashSeed?.hidden ?? []).map(([slug, quantity]) => `${slug}: ${quantity}`);

  return (
    <Panel title="Stash">
      <p>
        <span className="chip">{resources} ⬢</span>
        {hiddenResources > 0 && (
          <>
            {" "}
            <span className="chip">{hiddenResources} ⬢ hidden</span>
          </>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="mono-table w-full">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Slug</th>
              <th scope="col">Quantity</th>
              <th scope="col">Hidden</th>
            </tr>
          </thead>
          <tbody>
            {stash.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.slug}</td>
                <td className="mono">{s.quantity}</td>
                <td className="mono">{s.hiddenQuantity || ""}</td>
              </tr>
            ))}
            {stash.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted">
                  Nothing stashed here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {authored.length > 0 && (
        <p className="text-muted text-sm">
          <strong>Authored</strong> (docs/zones.yaml, poured in once by Start Game):{" "}
          <span className="mono">{authored.join(", ")}</span>
        </p>
      )}
      {authoredHidden.length > 0 && (
        <p className="text-muted text-sm">
          <strong>Authored, hidden</strong> (under the floor until a Search turns it up):{" "}
          <span className="mono">{authoredHidden.join(", ")}</span>
        </p>
      )}
      {canSuper && (
        <>
          <FormError>{error}</FormError>
          {result && <p className="text-sm">{result}</p>}
          <form className="flex flex-col gap-2" onSubmit={onSeed}>
            <label className="field">
              <span className="field-label">Seed these items now — one &ldquo;slug: count&rdquo; per line</span>
              <textarea name="lines" className="control mono" rows={4} placeholder={"longbow: 1\ntorch: 3"} />
            </label>
            <label className="field">
              <span className="field-label">
                Hidden — the same, but under the floor until somebody searches
                {destroysContents ? " (this room eats what goes in, so it may hold nothing hidden)" : ""}
              </span>
              <textarea
                name="hidden"
                className="control mono"
                rows={3}
                placeholder={"black-powder: 1"}
                disabled={destroysContents}
              />
            </label>
            <p className="text-muted text-sm">
              A slug already in this room&rsquo;s seed history ({seededStashSlugs.length ? seededStashSlugs.join(", ") : "none yet"}) is
              skipped — an emptied stash never refills itself.
            </p>
            <button type="submit" className="btn" disabled={pending}>
              Seed
            </button>
          </form>
        </>
      )}
    </Panel>
  );
}
