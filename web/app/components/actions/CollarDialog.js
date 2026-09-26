"use client";

import { useEffect, useState } from "react";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { glyphIndexOf, isLooseCollarSlug } from "@lifeweb/db/lib/collarGlyphs";
import {
  applyCollarRequest,
  unlockCollarRequest,
  detonateCollarRequest,
  readRemoteRequest,
} from "@/app/(app)/character/requestActions";

// The bomb collar's three verbs (docs/systemdocs/COLLAR.md), one dialog.
//
// Apply and Unlock have no `fit`. That is the whole design and not an
// omission: both list everybody standing here, whether or not they are wearing
// a collar, because a picker that showed only the collared would publish who
// is collared to anybody holding a key. The server refuses an uncollared
// target by name; you spend a click to learn one person's answer instead of
// reading the room's.
//
// Detonate is a different dialog (RemoteDialog below): the Exactor's remote,
// which lists collars by glyph and answers to nobody else.
//
// `pool` picks the roster: Apply may target yourself, Unlock may not
// (web/lib/peoplePools.js).
export const COLLAR_VERBS = {
  applycollar: {
    title: "Apply Collar",
    question: "Who are you collaring?",
    empty: "There's nobody here to collar.",
    pool: "collarTargets",
    note: "Anybody who could refuse is asked first. Somebody helpless, or yourself, is collared on the spot.",
    confirm: (name) => ({ title: `Put a collar on ${name}?`, confirmLabel: "Put it on them" }),
    run: (id, collarSlug) => applyCollarRequest({ targetCharacterId: id, collarSlug }),
  },
  unlockcollar: {
    title: "Unlock Collar",
    question: "Whose collar are you unlocking?",
    empty: "There's nobody here.",
    pool: "collarOthers",
    note: "The collar comes off in one piece, glyph and all, and is yours to keep.",
    confirm: (name) => ({ title: `Unlock ${name}'s collar?`, confirmLabel: "Turn the key" }),
    run: (id) => unlockCollarRequest({ targetCharacterId: id }),
  },
};

// The loose collars in your own pockets, blank ones first — the same order
// db/lib/collar.js#looseCollarsHeld reaches for them in.
function collarsInHand(characterTags = []) {
  return characterTags
    .filter((ct) => isLooseCollarSlug(ct.tag?.slug) && (ct.quantity ?? 1) > 0)
    .sort((a, b) => (glyphIndexOf(a.tag.slug) ?? -1) - (glyphIndexOf(b.tag.slug) ?? -1))
    .map((ct) => ({
      id: ct.tag.slug,
      label: (ct.quantity ?? 1) > 1 ? `${ct.tag.name} ×${ct.quantity}` : ct.tag.name,
    }));
}

export default function CollarDialog(props) {
  if (props.mode === "detonatecollar") return <RemoteDialog {...props} />;
  return <PeopleCollarDialog {...props} />;
}

function PeopleCollarDialog({ mode, presets, onDone, onClose }) {
  const verb = COLLAR_VERBS[mode];
  const pools = useActionPools();
  const applying = mode === "applycollar";
  // Apply also reads your own pockets, so it can ask WHICH collar when you
  // hold more than one. A marked one keeps its glyph onto the new neck.
  const { roster, loading } = useRoster(applying ? ["people", "self"] : ["people"], {
    seed: { people: { [verb.pool]: pools[verb.pool] ?? [] } },
  });
  const [targetId, setTargetId] = useState(presets?.targetId ?? "");
  const [collarChoice, setCollarChoice] = useState("");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const people = roster?.people?.[verb.pool] ?? [];
  const target = people.find((t) => t.id === targetId) ?? null;
  const collars = applying ? collarsInHand(roster?.self?.characterTags) : [];
  const collarSlug = collars.some((c) => c.id === collarChoice) ? collarChoice : (collars[0]?.id ?? null);

  async function onSubmit() {
    if (!target) return;
    if (!(await confirm(verb.confirm(target.name)))) return;
    submit(
      () => verb.run(target.id, collarSlug),
      (res) => onDone(noticeLine(mode, res, { name: target.name })),
    );
  }

  return (
    <ActionDialog
      title={verb.title}
      busy={busy}
      error={error}
      loading={loading && people.length === 0}
      empty={!loading && people.length === 0 ? verb.empty : null}
      canSubmit={Boolean(target)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label={verb.question}
        options={people.map((t) => ({ id: t.id, label: t.name }))}
        value={targetId}
        onChange={setTargetId}
      />
      {collars.length > 1 && (
        <ChipPicker label="Which collar?" options={collars} value={collarSlug} onChange={setCollarChoice} />
      )}
      {verb.note && <p className="text-xs text-muted">{verb.note}</p>}
    </ActionDialog>
  );
}

// The Remote Detonator. Read when the dialog opens, not when the page
// rendered, the way useRoster reads a room: the list is every collar round a
// living neck in the game, in any zone, and it moves whenever somebody dies or
// turns a key.
//
// A collar is a glyph here. A name goes beside it only for somebody standing
// in front of you, where you can read the clasp yourself — anywhere else, the
// remote cannot tell you whose neck it is on.
function useRemoteReading() {
  const [state, setState] = useState({ collars: [], loading: true, error: null });
  useEffect(() => {
    let live = true;
    readRemoteRequest()
      .then((res) => {
        if (!live) return;
        if (!res?.ok) setState({ collars: [], loading: false, error: res?.error ?? "The remote is dead." });
        else setState({ collars: res.collars ?? [], loading: false, error: null });
      })
      .catch(() => {
        if (live) setState({ collars: [], loading: false, error: "The remote is dead." });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function RemoteDialog({ mode, onDone, onClose }) {
  const { collars, loading, error: readError } = useRemoteReading();
  const [slug, setSlug] = useState("");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const picked = collars.find((c) => c.slug === slug) ?? null;

  async function onSubmit() {
    if (!picked) return;
    const ok = await confirm({
      title: `Set off collar ${picked.glyph}?`,
      message: picked.wornBy
        ? `It's round ${picked.wornBy}'s neck.`
        : "Whoever is wearing it is somewhere else.",
      confirmLabel: "Detonate",
    });
    if (!ok) return;
    submit(
      () => detonateCollarRequest({ collarSlug: picked.slug }),
      (res) => onDone(noticeLine(mode, res)),
    );
  }

  return (
    <ActionDialog
      title="Detonate"
      busy={busy}
      error={error ?? readError}
      loading={loading}
      empty={!loading && !readError && collars.length === 0 ? "No collar answers." : null}
      canSubmit={Boolean(picked)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Which collar?"
        options={collars.map((c) => ({ id: c.slug, label: c.wornBy ? `${c.glyph} · ${c.wornBy}` : c.glyph }))}
        value={slug}
        onChange={setSlug}
      />
      <p className="text-xs text-muted">
        The remote reaches every collar, wherever it is. It can&apos;t tell you whose neck one is on unless
        they&apos;re standing in front of you.
      </p>
    </ActionDialog>
  );
}
