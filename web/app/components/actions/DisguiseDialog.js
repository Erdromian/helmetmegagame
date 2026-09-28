"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import Select from "../Select";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { NAME_LIMITS } from "@/lib/characterName";
import { disguiseSelfRequest, loadDisguise } from "@/app/(app)/character/requestActions";

// Disguise: a false name, typed, and a job to claim. No people-picker — impersonating
// somebody real is a thing you do by typing their name. Whether it works is decided per
// reader (docs/systemdocs/STRANGERS.md §10): the full name of somebody real fools everyone
// who knows them. A title is any the game has, offered in the form the wearer's own gender
// takes, since a disguise changes the name and never who is under it. A job is any job
// title, typed: the game's own seats are suggested, and one of those shows as its estate's
// colour; a made-up one is worn as typed, with no colour.
export default function DisguiseDialog({ mode, onDone, onClose }) {
  const [honorific, setHonorific] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [job, setJob] = useState("");
  const [choices, setChoices] = useState({ titles: [], jobs: [] });
  const { submit, busy, error } = useSubmit();
  const typed = [honorific, firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

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
        <Select value={honorific} onChange={(e) => setHonorific(e.target.value)}>
          <option value="">(none)</option>
          {choices.titles.map((word) => (
            <option key={word} value={word}>
              {word}
            </option>
          ))}
        </Select>
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
        For 3 turns nobody sees your name or your face&mdash;you go by this instead. People who know the person
        you name will take you for them. Everyone else sees a stranger until they hear the name. Any job will do,
        and people learn it when they hear it. One of Ravenheart&apos;s own shows in its estate&apos;s colour. Your age and whether you pass as a man or a
        woman stay your own. You cannot conceal yourself on top of a disguise, and it wears off on its own. The
        kit is not used up.
      </p>
    </ActionDialog>
  );
}
