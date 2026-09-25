"use client";

import { useMemo, useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTableState, FilterBar } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { EditIcon, TrashIcon } from "@/app/components/icons";
import FriendComposer from "./FriendComposer";
import { deleteFriend } from "./friendActions";

// The estates, in the order the creation picker shows them, then everybody
// whose seat the player does not know (or wrote in their own words). Labels
// here rather than imported from db/lib/roleGroups.js, which is CommonJS the
// browser bundle would have to drag in for seven strings; the slugs are the
// contract, and page.js only ever sends one of these or null.
const GROUPS = [
  { slug: "court", name: "Court" },
  { slug: "clergy", name: "Clergy" },
  { slug: "cerberon", name: "Cerberon" },
  { slug: "saviors", name: "Saviors" },
  { slug: "business", name: "Business" },
  { slug: "soil", name: "Soil" },
  { slug: "outsiders", name: "Outsiders" },
];
const UNKNOWN = "Unknown";
const groupName = (slug) => GROUPS.find((g) => g.slug === slug)?.name ?? UNKNOWN;
const ORDER = [...GROUPS.map((g) => g.name), UNKNOWN];

// The six estates that wear a colour, the same attribute the feed paints a
// name with. Outsiders wears none, like everywhere else.
const COLOURED = new Set(["court", "clergy", "cerberon", "saviors", "business", "soil"]);

const SEARCH_FIELDS = [(f) => f.name, (f) => f.roleText ?? "", (f) => f.notes ?? ""];
const FILTER_DEFS = [{ key: "estate", label: "Estate", value: (f) => groupName(f.group) }];

function FriendCard({ friend, onEdit, onDelete }) {
  return (
    <div className="memory-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <CharacterAvatar
            characterId={friend.faceId}
            name={friend.name}
            unknown={!friend.faceId}
            size={24}
            zoomable={Boolean(friend.faceId)}
          />
          <div className="flex flex-col" style={{ minWidth: 0 }}>
            <span className="font-bold">{friend.name}</span>
            {friend.roleText ? (
              <span
                className="text-xs memory-role"
                data-role-group={COLOURED.has(friend.group) ? friend.group : undefined}
              >
                {friend.roleText}
              </span>
            ) : (
              <span className="text-xs text-muted">Role unknown</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Nothing to edit in a memory you cannot make out — saving over
              the nonsense would write the nonsense in (friendActions.js
              refuses it too). Forgetting it is still allowed. */}
          {!friend.scrambled && <IconButton icon={EditIcon} label="Edit memory" onClick={() => onEdit(friend)} />}
          <IconButton icon={TrashIcon} label="Forget" onClick={() => onDelete(friend)} />
        </div>
      </div>
      {friend.notes && (
        <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>
          {friend.notes}
        </p>
      )}
    </div>
  );
}

export default function FriendsSection({ friends, hasCharacter }) {
  const confirm = useConfirm();
  const [removed, setRemoved] = useState(new Set());
  const [editing, setEditing] = useState(null); // null closed, {} new, {...} editing
  const [, startTransition] = useTransition();

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const rows = useMemo(() => friends.filter((f) => !removed.has(f.id)), [friends, removed]);

  // No paging: a Friends list is a few dozen people at most, and splitting the
  // estates across pages would put half the Court on page two.
  const { query, setQuery, filters, setFilters, options, visible } = useTableState({
    rows,
    filterDefs,
    searchFields,
    initialSort: { key: "name", dir: "asc" },
    pageSize: 10000,
  });

  const grouped = useMemo(() => {
    const byGroup = new Map();
    for (const friend of visible) {
      const name = groupName(friend.group);
      if (!byGroup.has(name)) byGroup.set(name, []);
      byGroup.get(name).push(friend);
    }
    return ORDER.filter((name) => byGroup.has(name)).map((name) => ({ name, friends: byGroup.get(name) }));
  }, [visible]);

  async function handleDelete(friend) {
    if (
      !(await confirm({
        title: `Forget ${friend.name}?`,
        message: "The memory is gone for good. You will only know them again if you hear their name.",
        confirmLabel: "Forget",
      }))
    )
      return;
    setRemoved((prev) => new Set(prev).add(friend.id));
    startTransition(() => {
      deleteFriend(friend.id);
    });
  }

  if (!hasCharacter) {
    return <EmptyState>You need a living character to remember anybody.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div style={{ flex: "1 1 18rem" }}>
          <FilterBar
            filterDefs={filterDefs}
            filters={filters}
            setFilters={setFilters}
            options={options}
            query={query}
            setQuery={setQuery}
            searchLabel="Search friends"
          />
        </div>
        <button type="button" className="btn" onClick={() => setEditing({})}>
          + Add someone
        </button>
      </div>

      {grouped.map((group) => (
        <div key={group.name} className="flex flex-col gap-2">
          <p className="group-label">
            {group.name} · {group.friends.length}
          </p>
          {group.friends.map((friend) => (
            <FriendCard key={friend.id} friend={friend} onEdit={setEditing} onDelete={handleDelete} />
          ))}
        </div>
      ))}
      {grouped.length === 0 && (
        <EmptyState>
          {rows.length === 0
            ? "You don't know anybody here yet. Names you hear spoken will be remembered."
            : "Nobody you know matches that."}
        </EmptyState>
      )}

      <FriendComposer open={editing !== null} friend={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
