"use client";

import { useMemo, useState, useTransition } from "react";
import { useTableState, FilterBar } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import Tooltip from "@/app/components/Tooltip";
import { useNotice } from "@/app/components/NoticeProvider";
import { starMemory } from "./dayActions";

// "Memories of the day" (docs/systemdocs/MEMORIES.md §4): every line said in a
// room while this character stood in it, today, and nothing from before they
// walked in or after they left. A line here can be starred into Highlights
// but not looked at — there is no eye, because the person who said it is not
// in front of you any more. It wipes when the in-game day turns.
const SEARCH_FIELDS = [(l) => l.content, (l) => l.name ?? "", (l) => l.place ?? ""];
const FILTER_DEFS = [{ key: "place", label: "Place", value: (l) => l.place ?? "" }];
const SORT_OPTIONS = [
  { key: "sentAtMs", dir: "asc", label: "Oldest first" },
  { key: "sentAtMs", dir: "desc", label: "Newest first" },
];

function time(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DaySection({ lines, hasCharacter }) {
  const notice = useNotice();
  const [starred, setStarred] = useState(new Set());
  const [pending, startTransition] = useTransition();

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, setSort, options, pageRows, page, setPage, total, totalPages } =
    useTableState({ rows: lines, filterDefs, searchFields, initialSort: { key: "sentAtMs", dir: "asc" } });

  function star(line) {
    startTransition(async () => {
      const res = await starMemory(line.seq);
      if (res?.ok) setStarred((prev) => new Set(prev).add(line.seq));
      notice({ text: res?.ok ? res.line : (res?.error ?? "Something went wrong."), tone: res?.ok ? "info" : "bad" });
    });
  }

  if (!hasCharacter) return <EmptyState>You need a living character to remember a day.</EmptyState>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">Everything said where you stood today. It fades when the day turns.</p>
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search today"
        sortOptions={SORT_OPTIONS}
        sort={sort}
        setSort={setSort}
      />
      <div className="list-scroll flex flex-col">
        {pageRows.map((line) => (
          <div key={line.seq} className="memory-line" data-narrated={line.narrated ? "true" : undefined}>
            {!line.narrated && (
              <CharacterAvatar
                characterId={line.characterId}
                name={line.name ?? ""}
                src={line.avatarPath ?? undefined}
                version={line.avatarVersion ?? undefined}
                unknown={line.unknownFace}
                size={20}
              />
            )}
            <div className="memory-line-body">
              <div className="text-xs text-muted">
                {!line.narrated && (
                  <span className="font-bold memory-line-name" data-role-group={line.roleGroup ?? undefined}>
                    {line.name}
                  </span>
                )}
                {!line.narrated && " · "}
                {line.place ?? "Somewhere"} · <span className="mono">{time(line.sentAt)}</span>
              </div>
              <div className="text-sm">
                <ChatMarkdown content={line.content} />
              </div>
            </div>
            {!line.scrambled && (
              <Tooltip text={starred.has(line.seq) ? "In your Highlights" : "Save to Highlights"}>
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => star(line)}
                  disabled={pending || starred.has(line.seq)}
                  aria-label="Save this line to your Highlights"
                >
                  {starred.has(line.seq) ? "★" : "☆"}
                </button>
              </Tooltip>
            )}
          </div>
        ))}
        {pageRows.length === 0 && (
          <EmptyState>{lines.length === 0 ? "Nothing has been said around you today." : "No lines match these filters."}</EmptyState>
        )}
      </div>
      <Pager page={page} totalPages={totalPages} total={total} unit="lines" onPage={setPage} />
    </div>
  );
}
