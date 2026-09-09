"use client";

import Switch from "./Switch";
import { useState, useTransition } from "react";
import PortraitMaker from "./PortraitMaker";
import HoverCard from "./HoverCard";
import InfoIcon from "./InfoIcon";
import { useConfirm } from "./ConfirmProvider";
import { resetAvatarToDefault } from "../(app)/character/actions";

// An InfoIcon sits INSIDE the Switch's <label>, so a click on the "?" — which
// HoverCard uses to pin the panel open — would also flip the switch. The
// preventDefault is what stops the label activating its control; HoverCard's
// own onClick still runs, so the tooltip still pins.
function SwitchInfo({ text }) {
  return (
    <span onClick={(e) => e.preventDefault()}>
      <InfoIcon text={text} />
    </span>
  );
}

export default function AvatarField({
  defaultTurnPingOptIn,
  defaultWebOnly = false,
  // GameConfig.playPanelEnabled. Off, the "Play from the web" switch is drawn
  // only for a player who is already web-only — a character taken out of
  // Discord with no Chat to play in would be out of the game, but one already
  // out must be able to come back. The server action holds the same line.
  playPanelEnabled = true,
  defaultConcealed,
  uploadsEnabled = false,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection,
  hasCustomAvatar = false,
  // Character.gender, so the portrait maker's Randomize draws from the hair
  // and beard styles that suit it (web/lib/portrait/catalog.js). "NEUTRAL" is
  // the widest pool, so a missing prop rolls exactly as it did before.
  gender = "NEUTRAL",
  // While set, the face and the name are the tag's, not the player's: every
  // picture control gives way to one line, and the conceal switch is off and
  // locked. The server actions re-check it (character/actions.js).
  forcedIdentity = null,
  // The equipped thing covering this face, highest layer first, as
  // { tagName, forced } — or null for a bare face, which is what shuts the
  // conceal switch. Passed down from /character's page through BioForm.
  concealGear = null,
}) {
  const [fileName, setFileName] = useState("");
  const [makerOpen, setMakerOpen] = useState(false);
  const [resetting, startReset] = useTransition();
  const confirm = useConfirm();

  const reset = async () => {
    const ok = await confirm({
      title: "Reset to default?",
      message: "Your picture goes back to the letter plaque for your first name.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    startReset(() => {
      resetAvatarToDefault();
    });
  };

  return (
    <div className="field">
      <span className="field-label">Profile picture</span>
      <div className="flex flex-wrap items-center gap-3">
        {forcedIdentity && (
          <span className="text-sm text-muted">
            Your face is fixed while you hold {forcedIdentity.tagName}. Everyone sees {forcedIdentity.name}.
          </span>
        )}
        {!forcedIdentity && portraitMakerEnabled && (
          <button type="button" className="btn-secondary" onClick={() => setMakerOpen(true)}>
            Customize Appearance
          </button>
        )}
        {forcedIdentity ? null : uploadsEnabled ? (
          // The GM approval this promises is a conversation, not a queue: the
          // picture lands immediately and a GM can reset it. Saying so on the
          // button is the whole enforcement, deliberately.
          <HoverCard
            panel="Requires GM approval, run your art by the GM."
            // .tag-hover forces --font-mono, which is data-only per
            // DESIGN-SYSTEM.md §1 and wrong on a button label. Every other
            // HoverCard wraps a chip or a glyph, where mono is correct; this
            // is the one that wraps a control.
            style={{ fontFamily: "inherit" }}
          >
            <label className="btn" style={{ cursor: "pointer" }}>
              Browse
              <input
                type="file"
                name="avatar"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </label>
          </HoverCard>
        ) : (
          // Uploads are off (GameConfig.avatarUploadsEnabled) — no `avatar`
          // field is posted at all. With the portrait maker off too, everyone
          // shows their letter plaque.
          !portraitMakerEnabled && <span className="text-sm text-muted">Using your letter plaque</span>
        )}
        {!forcedIdentity && hasCustomAvatar && (
          // Clears a built portrait and an uploaded picture alike; the plaque
          // is derived at read time, so there is nothing to restore.
          <button type="button" className="btn-quiet" onClick={reset} disabled={resetting}>
            {resetting ? "Resetting…" : "Reset to Default"}
          </button>
        )}
        {/* The ping is a role mention inside #turns, and Play from the web
            closes #turns along with every other channel (CHAT.md §6). So the
            box still records the preference — it is what comes back when they
            switch back — but the line under it says plainly that nothing will
            arrive meanwhile, rather than letting them tick a notification that
            silently cannot be delivered. */}
        <Switch name="turnPingOptIn" defaultChecked={defaultTurnPingOptIn}>
          Ping me when the turn advances
        </Switch>
        {defaultWebOnly && (
          <p className="text-sm text-muted">
            Playing from the web, so this ping has nowhere to arrive — it lives in a Discord
            channel you are no longer in. Your answer is kept, and the ping comes back if you
            turn Play from the web off. ‡
          </p>
        )}
        {/* The anonymity switch (docs/systemdocs/CHAT.md §6). On, this player's
            Discord account is taken out of every game channel, so a member
            sidebar can no longer say which account is standing in the room.
            The cooldown is enforced server-side in db/lib/webOnly.js — this is
            the hint, not the lock. */}
        {(playPanelEnabled || defaultWebOnly) && (
          <Switch name="webOnly" defaultChecked={defaultWebOnly}>
            <span className="inline-flex items-center gap-1.5">
              Play from the web
              <SwitchInfo text="Removes you from the Discord channels, preserving your character's anonymity. Recommended." />
            </span>
          </Switch>
        )}
        {/* While this is on every message you send posts under your alias and
            the concealing item's own face, and Who's here? lists the alias too.
            Three ways it can be locked — a forced name, a bare face, or
            something you don't get to take off. The label used to name which
            one; it says the rule once in its tooltip instead now, so the
            greying is the only signal left that one of the three applies. The
            server re-checks all three regardless — this is the hint, not the
            lock. */}
        <Switch
          name="concealed"
          defaultChecked={
            forcedIdentity ? false : concealGear?.forced ? true : Boolean(concealGear) && defaultConcealed
          }
          disabled={Boolean(forcedIdentity) || !concealGear || concealGear.forced}
        >
          <span className="inline-flex items-center gap-1.5">
            Conceal
            <SwitchInfo text="Concealment is based on headgear. Some headgear allows you to optionally conceal yourself, while some is forced." />
          </span>
        </Switch>
        {fileName ? (
          <span className="text-sm text-muted">
            {fileName}
          </span>
        ) : null}
      </div>

      {/* Mounted only while open, so cancelling and reopening starts from what
          is stored rather than from the abandoned edits. */}
      {makerOpen && (
        <PortraitMaker
          onClose={() => setMakerOpen(false)}
          initialSelection={portraitSelection}
          allowFantasy={portraitFantasyPartsEnabled}
          gender={gender}
        />
      )}
    </div>
  );
}
