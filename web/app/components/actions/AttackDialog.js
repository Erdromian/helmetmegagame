"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import ChipPicker from "../ChipPicker";
import FightPanel from "../FightPanel";
import { useConfirm } from "../ConfirmProvider";
import useSubmit from "./useSubmit";
import { loadAttacks, attackCharacterRequest, interveneRequest } from "@/app/(app)/character/attackActions";

// Attacking (docs/systemdocs/ATTACK.md, from Bascinet's Combat Overhaul.docx). Three faces, one dialog:
//
//   - You are in a fight: the fight itself (FightPanel) — who is in it, your invitation, what you do,
//     Call off. The Write your attack button in a DM opens this same dialog.
//   - A fight is going on here and you are not in it: join either side of it, or start one of your own
//     with people who are not fighting.
//   - Otherwise: pick your targets, and anybody you want at your side. Everyone picked is held here.
//
// The picker lists everybody here, including the people who are already fighting, greyed with why: that
// is a thing the room can see. A hood is listed by its token, never its id (db/lib/targetKey.js).
export default function AttackDialog({ onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({ people: [], fights: [], blocked: null, view: null });
  const [targets, setTargets] = useState([]);
  const [helpers, setHelpers] = useState([]);
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  useEffect(() => {
    let live = true;
    loadAttacks()
      .then((res) => {
        if (live && res?.ok) setState({ people: res.people ?? [], fights: res.fights ?? [], blocked: res.blocked ?? null, view: res.view ?? null });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const { people, fights, blocked, view } = state;
  const nameOf = (key) => people.find((p) => p.key === key)?.name ?? "somebody";
  const toggle = (list, setList, other) => (key) => {
    if (!key || other.includes(key)) return;
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  };

  // In a fight: the fight is the whole dialog, closed with Close.
  if (view) {
    return (
      <ActionDialog
        title="Your fight"
        onClose={onClose}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn-quiet" onClick={() => onClose?.()}>
              Close
            </button>
          </div>
        }
      >
        <FightPanel view={view} onChanged={(line) => onDone(line)} />
      </ActionDialog>
    );
  }

  async function onSubmit() {
    if (targets.length === 0) return;
    const who = targets.map(nameOf).join(", ");
    const ok = await confirm({
      title: `Attack ${who}?`,
      message: helpers.length
        ? `You'll ask ${helpers.map(nameOf).join(", ")} to join you. Everyone in the fight is held here until it's over.`
        : "Everyone in the fight is held here until it's over.",
      confirmLabel: "Attack",
    });
    if (!ok) return;
    submit(
      () => attackCharacterRequest({ targetKeys: targets, collaboratorKeys: helpers }),
      (res) => onDone(res.line),
    );
  }

  async function join(fight, side) {
    const ok = await confirm({
      title: side === "ATTACKER" ? "Join the attackers?" : "Join the defenders?",
      message: "You'll be held here until the fight is over. The further you came to get here, the worse your chances.",
      confirmLabel: "Join",
    });
    if (!ok) return;
    submit(
      () => interveneRequest({ combatId: fight.combatId, side }),
      (res) => onDone(res.line),
    );
  }

  const options = (picked, other) =>
    people.map((p) => ({
      id: p.key,
      label: p.name,
      active: picked.includes(p.key),
      disabled: p.fighting || other.includes(p.key),
      reason: p.fighting ? "In a fight." : other.includes(p.key) ? "Already picked." : undefined,
    }));

  return (
    <ActionDialog
      title="Attack"
      busy={busy}
      error={error}
      loading={loading}
      empty={!loading && people.length === 0 && fights.length === 0 ? "There’s nobody here to attack." : null}
      canSubmit={targets.length > 0 && !blocked}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      {blocked ? <p className="text-xs text-muted">{blocked}</p> : null}

      {fights.map((fight) => (
        <div key={fight.combatId} className="field">
          <span className="field-label">A fight is going on here</span>
          <p className="text-sm">
            {fight.attackers.join(", ")} against {fight.defenders.join(", ")}.
          </p>
          <div className="chat-buttons">
            <button type="button" className="btn-quiet" disabled={busy || Boolean(blocked)} onClick={() => join(fight, "ATTACKER")}>
              Join the attackers
            </button>
            <button type="button" className="btn-quiet" disabled={busy || Boolean(blocked)} onClick={() => join(fight, "DEFENDER")}>
              Join the defenders
            </button>
          </div>
        </div>
      ))}

      {people.length > 0 ? (
        <>
          {fights.length > 0 ? <p className="text-xs text-muted">Or start a separate attack:</p> : null}
          <ChipPicker multi label="Who are you attacking?" options={options(targets, helpers)} value="" onChange={toggle(targets, setTargets, helpers)} />
          <ChipPicker
            multi
            label="Who do you want with you? (optional)"
            options={options(helpers, targets)}
            value=""
            onChange={toggle(helpers, setHelpers, targets)}
          />
          <p className="text-xs text-muted">Anyone you ask gets to choose whether to join. Nobody picked can leave until the fight is over.</p>
        </>
      ) : null}
    </ActionDialog>
  );
}
