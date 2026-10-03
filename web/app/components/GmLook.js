import { lookText, lookWord, sameLook } from "@lifeweb/db/lib/gmLookText";

// WHAT THE ROOM SEES, beside the real name on a GM surface: hooded, disguised, a public name, a masked
// body (db/lib/gmPresentation.js shapes the looks; docs/systemdocs/STRANGERS.md §10 "What a GM sees").
// Renders nothing for a bare face, so it can sit after every name without a guard.
//
// `then` is the look frozen when they acted (a Move, a fight, a Caving 1), `now` today's. With `frozen`
// the frozen one leads and "now: …" follows only when it changed; a row with no frozen look (a bare face
// at the time, or filed before the stamp) shows today's as "now: …". Without `frozen` (an inspector, a
// roster: no moment to freeze) it is simply today's look.
//
// `compact` is the one-word form for a crowded row (a queue row, a member strip), the whole sentence in
// its tooltip. GM-only data: never mount this on a player's surface.
export default function GmLook({ then = null, now = null, frozen = false, compact = false }) {
  const lead = frozen ? (then ?? now) : now;
  if (!lead?.kind) return null;
  const isThen = frozen && Boolean(then?.kind);
  const changed = isThen && !sameLook(then, now);
  const prefix = frozen && !isThen ? "now: " : "";
  const full = `${prefix}${lookText(lead)}${changed ? ` · now: ${lookText(now)}` : ""}`;

  if (compact) {
    return (
      <span className="gm-look gm-look-compact" data-look={lead.kind} title={full}>
        {prefix}
        {lookWord(lead)}
      </span>
    );
  }

  return (
    <span className="gm-look" data-look={lead.kind} title={full}>
      {prefix}
      <LookWords look={lead} />
      {changed ? <span className="gm-look-now">now: {lookText(now)}</span> : null}
    </span>
  );
}

function Job({ job }) {
  if (!job?.name) return null;
  return (
    <>
      {" "}
      <span className="gm-look-job" data-role-group={job.group ?? undefined}>
        ({job.name})
      </span>
    </>
  );
}

// The sentence lookText writes, with the name and the job marked up: the name the room reads is the
// thing a GM scans for, and a claimed job wears its estate's colour, as the room sees it.
function LookWords({ look }) {
  const item = look.item ? `, under ${/^[aeiou]/i.test(look.item) ? "an" : "a"} ${look.item}` : "";
  switch (look.kind) {
    case "disguise":
      return (
        <span>
          disguised as <b className="gm-look-name">{look.shownAs}</b>
          <Job job={look.job} />
        </span>
      );
    case "forced":
      return (
        <span>
          goes by <b className="gm-look-name">{look.shownAs}</b>
        </span>
      );
    case "deathmask":
      return (
        <span>
          masked in death: <b className="gm-look-name">{look.shownAs}</b>
          {item}
        </span>
      );
    case "hood":
      return (
        <span>
          hooded: <b className="gm-look-name">{look.shownAs}</b>
          {item}
          {look.under ? (
            <>
              ; disguised as <b className="gm-look-name">{look.under}</b>
              <Job job={look.underJob} /> beneath it
            </>
          ) : null}
        </span>
      );
    default:
      return null;
  }
}
