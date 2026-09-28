"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { NAME_LIMITS } from "@/lib/characterName";
import { disguiseSelfRequest, loadDisguise } from "@/app/(app)/character/requestActions";

// Disguise: a false name, typed, and a job to claim. No people-picker — impersonating
// somebody real is a thing you do by typing their name. Whether it works is decided per
// reader (docs/systemdocs/STRANGERS.md §10): the full name of somebody real fools everyone
// who knows them, whatever title either carries. A title is any text; the game's own are
// suggested in the form the wearer's own gender takes, since a disguise changes the name and
// never who is under it. A job is any job title, typed: the game's own seats are suggested,
// and one of those shows as its estate's colour; a made-up one is worn as typed, with no colour.
export default function DisguiseDialog({ mode, onDone, onClose }) {
  const [honorific, setHonorific] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [job, setJob] = useState("");
  const [choices, setChoices] = useState({ titles: [], jobs: [] });
  const { submit, busy, error } = useSubmit();
  const typed = [honorific.trim(), firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

  useEffect(() => {
    let live = true;
    loadDisguise()
      .then((res) => {
        if (live && res?.ok) setChoices({ titles: res.titles ?? [], jobs: res.jobs ?? [] });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <ActionDialog
      title="Disguise"
      busy={busy}
      error={error}
      canSubmit={Boolean(firstName.trim())}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => disguiseSelfRequest({ honorific, firstName, lastName, job }),
          (res) => onDone(noticeLine(mode, res, { name: res.name ?? typed })),
        )
      }
    >
      <label className="field">
        <span className="field-label">Title</span>
        <input
          type="text"
          value={honorific}
          onChange={(e) => setHonorific(e.target.value)}
          placeholder="Any title, or none"
          autoComplete="off"
          maxLength={24 /* db/lib/disguiseMint.js#DISGUISE_TITLE_MAX */}
          list="disguise-titles"
        />
        <datalist id="disguise-titles">
          {choices.titles.map((word) => (
            <option key={word} value={word} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span className="field-label">First name</span>
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="A name"
          autoComplete="off"
          maxLength={NAME_LIMITS.firstName}
          required
          data-autofocus
        />
      </label>
      <label className="field">
        <span className="field-label">Last name</span>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="off"
          maxLength={NAME_LIMITS.lastName}
        />
      </label>
      <label className="field">
        <span className="field-label">Job</span>
        <input
          type="text"
          value={job}
          onChange={(e) => setJob(e.target.value)}
          placeholder="Any job, real or made up"
          autoComplete="off"
          maxLength={60 /* db/lib/disguiseMint.js#DISGUISE_JOB_MAX */}
          list="disguise-jobs"
        />
        <datalist id="disguise-jobs">
          {choices.jobs.flatMap((group) =>
            group.roles.map((role) => <option key={role.slug} value={role.name} label={group.name} />),
          )}
        </datalist>
      </label>
      <p className="text-xs text-muted">
        For 3 turns nobody sees your name or your face&mdash;you go by this instead. People might not recognize
        you if you disguise yourself as someone they have never met.
      </p>
    </ActionDialog>
  );
}
