"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PageShell from "@/app/components/PageShell";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { setPriority, pickedNothing } from "@lifeweb/db/lib/playerPreferences";
import { PriorityControl } from "./Lobby";
import { saveMusterEntry, leaveMuster } from "../musterActions";

// A MUSTER late party (docs/systemdocs/LATE-PARTIES.md §4), shaped like the
// lobby: the party's fates down the left with Off / Low / Med / High, and on
// the right the card that puts your name down. The fates are drawn at the end
// of the turn (db/lib/latePartyRaffle.js); a winner comes back to the wizard
// with the fate fixed, and everybody else stays in for the next draw.

// Somebody who has not put their name down yet starts with every fate they
// may take at Med, so one click enters them for anything.
function defaultPriorities(fates) {
  const out = {};
  for (const fate of fates) if (!fate.whitelistBlocked) out[fate.slug] = "MEDIUM";
  return out;
}

export default function LatePartyMuster({ fates, entry, entered }) {
  const [priorities, setPriorities] = useState(entry?.priorities ?? defaultPriorities(fates));
  const [inDraw, setInDraw] = useState(Boolean(entry));
  const [openIntro, setOpenIntro] = useState(null);
  const { run, pending, error } = useActionRunner();
  const router = useRouter();

  // The count of names, and the chairs left, are the live things here.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(id);
  }, [router]);

  // Once the name is down, every change is saved as it is made; before that
  // the priorities are only a draft for the button.
  function changeLevel(slug, level) {
    const next = setPriority(priorities, slug, level);
    setPriorities(next);
    if (inDraw && !pickedNothing(next)) {
      run(saveMusterEntry, { priorities: next }, { onOk: (res) => setPriorities(res.priorities) });
    }
  }

  function toggle() {
    if (inDraw) {
      run(leaveMuster, undefined, { onOk: () => setInDraw(false) });
    } else {
      run(saveMusterEntry, { priorities }, {
        onOk: (res) => {
          setPriorities(res.priorities);
          setInDraw(true);
        },
      });
    }
  }

  return (
    <PageShell width="wide">
      <h2 className="section-title">Lateparty</h2>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="flex flex-col gap-4 md:sticky md:top-6 md:order-2">
          <div className="panel flex flex-col gap-3 p-4" data-ready={inDraw ? "true" : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="lobby-dot" aria-hidden="true" />
                <strong>{inDraw ? "In the draw" : "Not in the draw"}</strong>
              </span>
              <span className="chip mono">{entered} in</span>
            </div>
            <p className="text-sm text-muted">
              A lateparty is mustering. The fates are drawn at the end of the turn, and anyone may be drawn,
              buried or not. If you are not drawn, your name stays in for the next.
            </p>
            <div>
              <button type="button" className={inDraw ? "btn-secondary" : "btn"} onClick={toggle} disabled={pending}>
                {inDraw ? "Take my name out" : "Put my name down"}
              </button>
            </div>
            {pickedNothing(priorities) ? (
              <p className="text-sm text-accent">Every fate is Off: you can&apos;t be drawn.</p>
            ) : null}
            <FormError>{error}</FormError>
          </div>
        </aside>

        <section className="flex flex-col gap-1 md:order-1">
          <h2 className="text-xs uppercase tracking-wide text-muted">Fates</h2>
          <ul className="panel divide-y divide-[var(--border)]">
            {fates.map((fate) => (
              <li
                key={fate.id}
                className="lobby-role"
                data-whitelisted={fate.requiresWhitelist ? "true" : undefined}
                data-locked={fate.whitelistBlocked ? "true" : undefined}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <button
                      type="button"
                      className="lobby-role-name"
                      onClick={() => setOpenIntro(openIntro === fate.id ? null : fate.id)}
                      aria-expanded={openIntro === fate.id}
                    >
                      {fate.name}
                      {fate.requiresWhitelist ? <span title="Reserved seat"> ★</span> : null}
                    </button>
                    <span className="text-xs text-muted">{fate.startingZoneName}</span>
                    <span className="text-xs text-muted mono">
                      {fate.left === null ? "∞ left" : `${fate.left} left`}
                    </span>
                  </div>
                  {openIntro === fate.id && fate.intro ? <p className="mt-1 text-sm text-muted">{fate.intro}</p> : null}
                </div>
                {fate.whitelistBlocked ? (
                  <span className="text-xs text-muted">Whitelist</span>
                ) : (
                  <PriorityControl slug={fate.slug} level={priorities[fate.slug]} onChange={changeLevel} />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
