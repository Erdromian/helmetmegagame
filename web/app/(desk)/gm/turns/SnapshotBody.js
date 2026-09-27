"use client";

import { useState } from "react";
import StatusPill from "@/app/components/StatusPill";
import CombatTile from "@/app/components/CombatReadout";

// What somebody was when a snapshot was taken: on guard or not, their fighting band, what they had on and
// their wounds. Shared by the Caving desk (the caver at their newest 1) and the Combat desk (everybody at
// the moment they came into the fight). `snap` is { combatMode, atLabel, tags, locationName? }, its tags
// already composed against the live catalog server-side.
export default function SnapshotBody({ snap }) {
  const [combatOpen, setCombatOpen] = useState(false);
  const worn = snap.tags.filter((t) => t.equipped && t.tag.equippable).map((t) => t.tag.name);
  const health = snap.tags.filter((t) => t.tag.category === "Health").map((t) => t.tag.name);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill tone={snap.combatMode ? "bad" : "neutral"}>{snap.combatMode ? "Combat mode on" : "Combat mode off"}</StatusPill>
        <span className="text-xs text-muted">
          {snap.locationName ? <>{snap.locationName} · </> : null}
          <span className="mono">{snap.atLabel}</span>
        </span>
      </p>
      <div className="flex">
        <CombatTile tags={snap.tags} showArmorPieces open={combatOpen} onOpen={setCombatOpen} />
      </div>
      <p className="text-xs">
        <span className="text-muted">Wearing: </span>
        {worn.length ? worn.join(", ") : "nothing"}
      </p>
      {health.length > 0 && (
        <p className="text-xs">
          <span className="text-muted">Health: </span>
          {health.join(", ")}
        </p>
      )}
    </div>
  );
}
