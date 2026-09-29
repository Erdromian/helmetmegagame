"use client";

import { Children } from "react";
import ActionButton from "./ActionButton";
import { useRequestActions } from "./RequestActionsProvider";
import { ACTION_SECTIONS, labelFor, helpFor, reasonFor, sectionLabelFor, stripGroups } from "./actionRegistry";

// Everything a player can do to a sheet, as captioned rows of buttons. The
// list itself lives in actionRegistry.js; this only lays it out, and
// ActionButton.js draws each one.
//
// Rows, not a fixed grid. The old four-across grid left one icon stranded
// on its own row whenever the count wasn't a multiple of four, and the
// count is about to keep growing. Each section is a `flex-wrap` row under a
// small caption, so any number of icons fills left to right and wraps
// wherever the width says; a section with nothing to show (no bird, no
// literacy) is left out entirely.
//
// `variant` picks the frame, not the contents. "rack" is a captioned row of
// framed glyphs, capped narrow, which is what /character's column fits.
// "columns" is /ledger's: one column per section with a rule between them,
// each holding the glyph AND its name as a full-width row — /ledger has a
// whole screen, and a labelled verb is one fewer thing to hover to understand.
// `children` rides at the end of the strip: the Trumpet, which commits on the
// spot rather than opening a dialog, and so is not in the registry.
export default function ActionGrid({ variant = "rack", children = null }) {
  const actions = useRequestActions();
  if (!actions) return null;
  const { open, pools, busy } = actions;
  const columns = variant === "columns";

  const sections = ACTION_SECTIONS.map((section) => ({
    ...section,
    visible: section.actions.filter((a) => (a.show ? pools[a.show] : true)),
  })).filter((s) => s.visible.length > 0);

  // One builder for all three frames: only the frame differs, and every one of
  // them carries the same tooltip (label, what the verb does, why it is greyed).
  const frame = variant === "strip" ? "strip" : columns ? "tile" : "icon";

  const button = (a) => (
    <ActionButton
      key={a.mode}
      variant={frame}
      icon={a.icon}
      label={labelFor(a, pools)}
      help={helpFor(a, pools)}
      reason={reasonFor(a, pools)}
      disabled={a.gate ? !pools[a.gate] : false}
      busy={busy === a.mode}
      onClick={() => open(a.mode)}
    />
  );

  if (variant === "strip") {
    // CAPTIONED GROUPS, by what a verb is for (actionRegistry.js#
    // STRIP_GROUPS): Things, Paper, Work, People, Captives, The dead… Each
    // group is a small box with its name over its buttons, and the groups
    // flow in a wrapping row.
    //
    // It was one run of roughly thirty same-weight buttons with a single
    // hairline between "You" and "Others", which is what the player feedback
    // meant by knowing a feature exists and not finding its button. The run
    // was chosen to stop a section moving to the next line WHOLE and leaving
    // an orphan; with a caption on each group, a group moving whole is the
    // point — it keeps its name with its buttons.
    //
    // Within a group, what you can do right now comes first and the greyed
    // (dashed) verbs follow. The groups are small, so nothing moves far.
    const groups = stripGroups()
      .map((group) => {
        const shown = group.actions.filter((a) => (a.show ? pools[a.show] : true));
        const gated = (a) => (a.gate && !pools[a.gate] ? 1 : 0);
        return { ...group, shown: shown.sort((a, b) => gated(a) - gated(b)) };
      })
      .filter((group) => group.shown.length > 0);
    // LedgerBand always passes the Trumpet, the Horn and Call Reinforcements
    // as `held && <Button />`, so a player holding none of them still hands
    // over [false, false, false] — truthy, and it drew an empty, captionless
    // box at the end of the row that took a slot in the wrap. toArray drops
    // the falses.
    const extras = Children.toArray(children);
    return (
      <div className="action-strip">
        {groups.map((group) => (
          <div key={group.key} className="action-strip-group" role="group" aria-label={sectionLabelFor(group, pools)}>
            <span className="action-strip-caption" aria-hidden="true">
              {sectionLabelFor(group, pools)}
            </span>
            <div className="action-strip-buttons">{group.shown.map(button)}</div>
          </div>
        ))}
        {/* The Trumpet: not a registry verb, so no caption of its own. */}
        {extras.length > 0 && (
          <div className="action-strip-group">
            <span className="action-strip-caption" aria-hidden="true">
              &nbsp;
            </span>
            <div className="action-strip-buttons">{extras}</div>
          </div>
        )}
      </div>
    );
  }

  if (columns) {
    return (
      <div className="action-columns">
        {sections.map((section) => (
          <div key={section.key} className="action-column">
            <p className="field-label mb-2">{sectionLabelFor(section, pools)}</p>
            <div className="flex flex-col gap-1">{section.visible.map(button)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section) => (
        <div key={section.key}>
          <p className="field-label mb-1">{sectionLabelFor(section, pools)}</p>
          <div className="flex flex-wrap gap-1" style={{ maxWidth: "12rem" }}>
            {section.visible.map(button)}
          </div>
        </div>
      ))}
    </div>
  );
}
