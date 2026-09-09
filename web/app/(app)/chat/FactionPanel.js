"use client";

import Link from "next/link";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";

// The Faction panel: the centre column when the places column's ⚑ row is the
// open one.
//
// It is a PANEL, not a feed. A faction has no channel of its own — the silo is
// a Room and the talking happens where the members are standing — so there is
// nothing to subscribe to and nothing to say into. What it answers is the one
// question the places column could not: who else is in this with me, and (for
// the Leader and the Treasurer) what are they carrying.
//
// Everything here is decided on the server (web/lib/selfPools.js#loadFactionView
// over the same loaders /faction runs). `resources` is absent from a plain
// member's rows rather than hidden by CSS, so the numbers are not sitting in
// the page source waiting to be read out of it (FACTIONS.md §6).

function marks(member) {
  const out = [];
  if (member.isLeader) out.push("Leader");
  if (member.isTreasurer) out.push("Treasurer");
  if (member.roleTitle) out.push(member.roleTitle);
  return out;
}

export default function FactionPanel({ faction, siloOpen = false, onSelect = null }) {
  if (!faction) return null;
  const roster = faction.roster ?? [];

  return (
    <div className="chat-main">
      <div className="chat-head">
        <h1 className="section-title">{faction.name}</h1>
        <Link className="btn btn-quiet" href="/faction">
          Faction page ›
        </Link>
      </div>
      <div className="chat-feed">
        <p className="chat-quiet-line">{faction.roleLine}</p>

        {/* The silo, when its door is open to this character. A shut door
            keeps the room out of the viewer's own place list entirely, and a
            button that selects a place they cannot read would only ever be a
            dead end — so it draws as a line instead. */}
        {faction.silo && (
          <div className="chat-buttons">
            {siloOpen && onSelect ? (
              <button type="button" className="btn" onClick={() => onSelect(faction.silo.placeKey)}>
                {faction.silo.name} ›
              </button>
            ) : (
              <p className="chat-quiet-line">The silo is {faction.silo.name}.</p>
            )}
          </div>
        )}

        <p className="chat-section-title">Members · {roster.length}</p>
        {roster.length === 0 ? (
          <EmptyState>Nobody living is in it. ‡</EmptyState>
        ) : (
          roster.map((member) => (
            <div key={member.characterId} className="chat-person-row">
              <span className="chat-person">
                <CharacterAvatar
                  characterId={member.characterId}
                  name={member.name}
                  version={member.avatarVersion}
                  catatonic={member.catatonic}
                  zoomable
                />
                <span className="chat-person-name">
                  {member.name}
                  {marks(member).length > 0 && (
                    <span className="text-muted"> · {marks(member).join(" · ")}</span>
                  )}
                </span>
              </span>
              {/* Only ever present for this faction's own Leader or
                  Treasurer — the loader leaves the key off everyone else's
                  rows (FACTIONS.md §6). */}
              {"resources" in member && <span className="chip chip-mono">{member.resources} ⬢</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
