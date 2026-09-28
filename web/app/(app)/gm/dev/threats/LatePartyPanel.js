"use client";

// The Late party panel (/gm/dev?s=lateparty, superadmin): the live party and
// its chairs, or the last one and how it ended, and -- when none is live --
// the form that starts one.
//
// Everything arrives flat from the page, so this file imports nothing from
// db/lib. See db/lib/lateParty.js for what a party does.
import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { actionThrowMessage } from "@/app/components/actionThrow";
import DiscordTime from "@/app/components/DiscordTime";
import { startLatePartyAction, endLatePartyAction } from "@/app/(app)/gm/dev/latePartyActions";

const slotsLabel = (slots) => (slots === null ? "∞" : slots);

// Ask first, then run the action. The confirm is awaited OUTSIDE the
// transition: a dialog opened from inside a form action never paints, because
// React holds every state update in an action until the action finishes.
function useConfirmedAction() {
  const confirm = useConfirm();
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  async function run(question, action) {
    setError(null);
    if (!(await confirm(question))) return;
    startTransition(async () => {
      try {
        const result = await action();
        if (result?.error) setError(result.error);
      } catch (err) {
        setError(actionThrowMessage(err));
      }
    });
  }
  return { run, error, pending };
}

// The two marks a fate may carry, on the start form and the party table alike.
function FateMarks({ hidden, whitelist }) {
  return (
    <>
      {hidden ? <span className="chip chip-quiet">hidden</span> : null}
      {whitelist ? <span className="chip chip-quiet">whitelist</span> : null}
    </>
  );
}

const epochOf = (iso) => Math.floor(Date.parse(iso) / 1000);

// The live party with its End button, or -- with none live -- the last one
// and how it ended. `seated` is what fills a party; `held` is wizard holds,
// which grey a card for everybody else but hand their chair back if abandoned.
function PartyTable({ party }) {
  const { run, error, pending } = useConfirmedAction();

  function onEnd() {
    run(
      {
        title: "End the late party?",
        message: "Character creation goes back to normal, and the curse applies again.",
        confirmLabel: "End it",
      },
      () => endLatePartyAction(),
    );
  }

  return (
    <div className="desk-card flex flex-col gap-3">
      <p className="text-sm">
        {party.live ? (
          <>
            <strong>Live</strong> since <DiscordTime epoch={epochOf(party.startedAt)} format="f" />.{" "}
            {party.mode === "MUSTER" ? (
              <>
                A muster: players put their names down, and the fates are drawn at the end of the turn.{" "}
                <span className="chip mono">{party.entered} in the draw</span>
              </>
            ) : (
              <>Creation offers only these fates, and anyone without a living character may take one, buried or not.</>
            )}
          </>
        ) : (
          <>
            <strong>{party.filled ? "Filled" : "Ended"}</strong> at{" "}
            <DiscordTime epoch={epochOf(party.endedAt)} format="f" />. The last late party; creation is back to
            normal.
          </>
        )}
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Fate</th>
            <th>Seated</th>
            <th>Held</th>
            <th>Slots</th>
          </tr>
        </thead>
        <tbody>
          {party.fates.map((fate) => (
            <tr key={fate.roleSlug}>
              <td>
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{fate.roleName ?? fate.roleSlug}</strong>
                  {fate.roleName ? null : <span className="text-danger">no Role row — run db:sync-roles</span>}
                  <FateMarks hidden={fate.hidden} whitelist={fate.whitelist} />
                </span>
              </td>
              <td className="mono">{fate.seated}</td>
              <td className="mono">{party.live ? fate.held : "—"}</td>
              <td className="mono">{slotsLabel(fate.slots)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {party.skinlessSpawnName ? (
        <p className="text-sm text-muted">Every Skinless this party makes arrives at {party.skinlessSpawnName}.</p>
      ) : null}
      {party.live ? (
        <div>
          <button type="button" className="btn btn-danger" onClick={onEnd} disabled={pending}>
            {pending ? "Working…" : "End late party"}
          </button>
        </div>
      ) : null}
      <FormError>{error}</FormError>
    </div>
  );
}

function StartForm({ groups }) {
  const { run, error, pending } = useConfirmedAction();

  function onStart(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const picked = formData.getAll("include").length;
    const fates = `the ${picked} fate${picked === 1 ? "" : "s"} you picked`;
    const muster = formData.get("mode") === "MUSTER";
    run(
      {
        title: muster ? "Start a muster?" : "Start a late party?",
        message: muster
          ? `Creation will offer nothing but a draw for ${fates}, made at the end of each turn, and everyone without a living character is sent a DM telling them to put their name down.`
          : `Creation will offer only ${fates}, and everyone without a living character is sent a DM saying they can come back now.`,
        confirmLabel: "Start it",
      },
      () => startLatePartyAction(formData),
    );
  }

  return (
    <form onSubmit={onStart} className="desk-card flex flex-col gap-3">
      <p className="text-sm text-muted">
        Tick the fates the party opens, or type their slots. Leave Slots blank for unlimited: a party with
        any unlimited fate runs until you end it, otherwise it ends when every slot is filled. Hidden fates
        are the ones the picker never shows; a whitelist fate only a vouched player can take, so its empty
        chair keeps a party running.
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="field-label">How players join</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="mode" value="OPEN" defaultChecked />
          <span>
            <strong>Open</strong> — anyone without a living character picks a fate and spawns at once
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="mode" value="MUSTER" />
          <span>
            <strong>Muster</strong> — players put their names down, and the fates are drawn at the end of
            each turn, like the lobby
          </span>
        </label>
      </fieldset>
      {groups.map((group) => (
        <table key={group.slug} className="data-table table-fixed">
          <thead>
            <tr>
              <th>{group.name}</th>
              <th className="w-32">Slots</th>
            </tr>
          </thead>
          <tbody>
            {group.roles.map((role) => (
              <tr key={role.slug}>
                <td>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="include" value={role.slug} />
                    <span>{role.name}</span>
                    <FateMarks hidden={role.hidden} whitelist={role.whitelist} />
                  </label>
                </td>
                <td>
                  <label className="field">
                    <span className="sr-only">Slots for {role.name}</span>
                    {role.alwaysUnlimited ? (
                      <input type="text" value="∞" disabled title="Always unlimited" className="w-20" readOnly />
                    ) : (
                      <input type="number" name={`slots:${role.slug}`} min="1" max="999" placeholder="∞" className="w-20" />
                    )}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <div>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Working…" : "Start late party"}
        </button>
      </div>
      <FormError>{error}</FormError>
    </form>
  );
}

export default function LatePartyPanel({ party, groups }) {
  return (
    <div className="flex flex-col gap-4">
      {party ? <PartyTable party={party} /> : null}
      {party?.live ? null : <StartForm groups={groups} />}
    </div>
  );
}
