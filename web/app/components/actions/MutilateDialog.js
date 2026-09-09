"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import Select from "../Select";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { corpseIdOf, corpseLabel } from "./corpseRows";
import { mutilateRequest } from "@/app/(app)/character/requestActions";
// Prisma-free on purpose, so importing it here does not drag the @lifeweb/db
// barrel into the browser bundle. See the note at the top of db/lib/mutilate.js.
import { MUTILATE_PARTS } from "@lifeweb/db/lib/mutilate";

// Mutilate: somebody tied up here or a body you can reach, and which part is
// coming off. The part list is DELIBERATELY UNFILTERED: narrowing it to what a
// subject has left would answer "what are they already missing?" to anybody
// who opened the dialog — the metagaming rule in actionRegistry.js. You find
// out by trying, and the server refuses. No yield preview either, by ruling.
function keyFor(kind, id) {
  return `${kind}:${id}`;
}

export default function MutilateDialog({ mode, onDone, onClose }) {
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people", "corpses"], {
    seed: { people: { bindTargets: pools.bindTargets ?? [] }, corpses: pools.corpses ?? [] },
  });
  const [subjectKey, setSubjectKey] = useState("");
  const [part, setPart] = useState(MUTILATE_PARTS[0].key);
  const { submit, busy, error } = useSubmit();

  const people = (roster?.people?.bindTargets ?? []).filter((t) => t.bound);
  const bodies = (roster?.corpses ?? []).filter((c) => c.human);
  const options = [
    ...people.map((t) => ({ id: keyFor("person", t.id), label: t.name, note: "here" })),
    ...bodies.map((c) => ({ id: keyFor("corpse", corpseIdOf(c)), label: corpseLabel(c), note: "body" })),
  ];
  const none = options.length === 0;

  function onSubmit() {
    const cut = subjectKey.indexOf(":");
    const kind = subjectKey.slice(0, cut);
    const rest = subjectKey.slice(cut + 1);
    const name =
      kind === "corpse"
        ? bodies.find((c) => corpseIdOf(c) === rest)?.tagName
        : people.find((t) => t.id === rest)?.name;
    const input =
      kind === "corpse"
        ? (() => {
            const corpse = bodies.find((c) => corpseIdOf(c) === rest);
            return { tagId: corpse?.tagId, sourceKey: corpse?.sourceKey, part };
          })()
        : { targetCharacterId: rest, part };
    submit(
      () => mutilateRequest(input),
      (res) => onDone(noticeLine(mode, res, { name })),
    );
  }

  return (
    <ActionDialog
      title="Mutilate"
      busy={busy}
      error={error}
      loading={loading && none}
      empty={!loading && none ? "There’s nobody here you could do that to." : null}
      canSubmit={Boolean(subjectKey && part)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker label="Who?" options={options} value={subjectKey} onChange={setSubjectKey} />
      <label className="field">
        <span className="field-label">What?</span>
        <Select value={part} onChange={(e) => setPart(e.target.value)} required>
          {MUTILATE_PARTS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>
    </ActionDialog>
  );
}
