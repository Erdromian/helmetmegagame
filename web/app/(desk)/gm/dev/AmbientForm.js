"use client";

// A line the world says, typed here instead of by hand in Discord.
//
// The preview is the reason this exists. `-#` subtext is per LINE, so a
// two-line scene typed by hand comes out half subtext and half shouting, and
// ambientLine no longer signs anything itself — so the only honest way to see
// what players will read is to render exactly what the server will post.
import { useMemo, useState, useTransition } from "react";

import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { sendAmbientLine } from "@/app/(app)/gm/dev/actions";

const KINDS = [
  { key: "zone", label: "Zone summary" },
  { key: "location", label: "Location" },
  { key: "room", label: "Room" },
];

export default function AmbientForm({ zones, locations, rooms }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const [kind, setKind] = useState("location");
  const [targetId, setTargetId] = useState("");
  const [text, setText] = useState("");

  const options = kind === "zone" ? zones : kind === "location" ? locations : rooms;
  const targetName = options.find((o) => o.id === targetId)?.label ?? "";

  // Mirrors db/lib/ambientLine.js exactly. Kept as its own line here rather
  // than round-tripped to the server on every keystroke — it is one prefix per
  // line, and a preview that lags the typing is worse than no preview.
  const preview = useMemo(
    () =>
      text
        .split("\n")
        .map((l) => `-# ${l}`)
        .join("\n"),
    [text],
  );

  function send() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const ok = await confirm({
        title: `Say this in ${targetName}?`,
        message: "Everyone standing there reads it the moment it lands. ‡",
        confirmLabel: "Say it",
        cancelLabel: "Not yet",
      });
      if (!ok) return;
      const res = await sendAmbientLine({ kind, targetId, text });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setNote(`Said in ${res.said}.`);
      setText("");
    });
  }

  return (
    <div className="desk-card grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="segmented">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => {
                setKind(k.key);
                setTargetId("");
                setError(null);
                setNote(null);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field-label">Where</span>
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="field">
          <span className="field-label">The line</span>
          <textarea
            rows={6}
            value={text}
            placeholder="Something drips, far back in the dark. ‡"
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn"
            disabled={pending || !targetId || !text.trim()}
            onClick={send}
          >
            {pending ? "Saying…" : "Say it"}
          </button>
          {note ? <span className="text-sm text-muted">{note}</span> : null}
          <FormError>{error}</FormError>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="field-label">What Discord shows</span>
        <pre className="desk-move-text whitespace-pre-wrap">{preview || "—"}</pre>
        <p className="text-xs text-muted">
          Subtext, one prefix per line. It sits under the conversation rather than in it, which
          is what keeps scenery from reading as an interruption. ‡
        </p>
      </div>
    </div>
  );
}
