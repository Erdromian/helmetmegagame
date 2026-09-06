"use client";

import { useMemo, useState } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import { EmptyRow } from "@/app/components/EmptyState";
import TagChip from "@/app/components/TagChip";
import TagDetailSheet from "@/app/components/TagDetailSheet";
import { needsWorkshop } from "@/lib/tagRequests";
import { byDiscipline, recipeRows, workLabel } from "@/lib/recipeCatalog";

// The recipe book, beside the Tag Catalog on /documents and built out of the
// same rows it is — every craftable tag the reader may see, with its
// `requirement:` block laid out (CRAFTING.md §2). Same table machinery as
// TagCatalogTab, one difference: the rows are grouped under their discipline
// rather than paged, because "what can a smith make" is the question this tab
// exists to answer, and 100-odd recipes fit in one scroll frame.
//
// Which recipes reach the browser at all is decided server-side by
// catalogTags() and redactWithheldRecipes() — see web/lib/recipeCatalog.js for
// why a recipe with a secret ingredient goes missing rather than going vague.

const FILTER_DEFS = [
  { key: "discipline", label: "Discipline", value: (r) => r.discipline, minWidth: "11rem" },
  { key: "kind", label: "Kind", value: (r) => r.kind, minWidth: "10rem" },
  { key: "band", label: "Work", value: (r) => r.band, minWidth: "9rem" },
];

const SEARCH_FIELDS = [
  (r) => r.name,
  (r) => r.slug,
  (r) => r.skillLabel,
  (r) => r.ingredientText,
  (r) => r.tag.description,
];

const COLUMNS = 5;

export default function RecipesTab({ tags }) {
  const [viewing, setViewing] = useState(null); // null | {…tag} — the detail sheet
  const rows = useMemo(() => recipeRows(tags), [tags]);

  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  // `visible`, not `pageRows`: every surviving recipe renders under its
  // discipline heading. Paging would cut a section in half, and a hundred-odd
  // rows already sit inside one scroll frame.

  const sections = byDiscipline(table.visible);

  return (
    <section className="flex flex-col gap-3">
      <div className="panel flex flex-col gap-3 p-3">
        {/* Bascinet's words, and the frame the whole tab is read through: this
            is what the trades commonly know, not an index of everything the
            world can make. Verbatim, so no ‡. */}
        <p className="text-sm">
          These recipes represent the crafts commonly known throughout the world, but they are
          not everything that can be made. Rare recipes and special crafting opportunities can
          be found across Ravenheart. Unusual items and materials may have hidden uses only
          revealed to highly skilled specialists.
        </p>
        <FilterBar
          filterDefs={FILTER_DEFS}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search recipes"
          searchPlaceholder="Name, skill, or ingredient…"
        />
        <p className="text-xs text-muted">
          A recipe is listed whether or not you could make it today: the skills are what you
          would have to hold, and the ⬢ is paid the moment the work starts. ‡
        </p>
      </div>

      <TableScroll minWidth="760px">
        <thead>
          <tr>
            <SortHeader label="Recipe" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Skill</th>
            <SortHeader label="Work" sortKey="turns" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Cost" sortKey="resources" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Ingredients</th>
          </tr>
        </thead>
        <tbody>
          {sections.length === 0 && (
            <EmptyRow cols={COLUMNS}>No recipe matches that. ‡</EmptyRow>
          )}
          {sections.map(({ discipline, rows: sectionRows }) => (
            <RecipeSection
              key={discipline}
              discipline={discipline}
              rows={sectionRows}
              onView={setViewing}
            />
          ))}
        </tbody>
      </TableScroll>

      <p className="text-sm text-muted">
        {table.total} of {rows.length} recipes ‡
      </p>

      {viewing && (
        <TagDetailSheet
          tag={viewing}
          tags={tags}
          onOpen={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

function RecipeSection({ discipline, rows, onView }) {
  return (
    <>
      <tr className="row-group">
        <th scope="colgroup" colSpan={COLUMNS}>
          {discipline} <span className="text-muted">({rows.length})</span>
        </th>
      </tr>
      {rows.map((row) => (
        <RecipeRow key={row.id} row={row} onView={onView} />
      ))}
    </>
  );
}

function RecipeRow({ row, onView }) {
  return (
    <tr>
      <td>
        {/* Same pairing the Tag Catalog uses: the real chip carries its hover
            card, and because HoverCard's trigger is itself clickable the chip
            can't double as the sheet opener. */}
        <div className="flex items-center gap-2">
          <TagChip tag={row.tag} />
          <button type="button" className="btn-quiet text-xs" onClick={() => onView(row.tag)}>
            Details
          </button>
        </div>
      </td>
      <td className="text-sm">
        {row.skillLabel || <span className="text-muted">—</span>}
        {/* Smith's and builder's work needs a set of tools in reach before any
            of the rest of the recipe matters — same predicate the Craft dialog
            and the server share (SMITHING.md §2a). */}
        {needsWorkshop(row.tag) && (
          <span className="block text-xs text-muted">Needs Workshop Equipment ‡</span>
        )}
      </td>
      <td className="text-sm">
        {workLabel(row.turns)}
        {row.ration != null && (
          <span className="block text-xs text-muted">
            {row.rationShared
              ? `Dead Simple: ${row.ration} a turn across all of it ‡`
              : `Up to ${row.ration} a turn ‡`}
          </span>
        )}
      </td>
      <td className="mono text-sm">{row.resources > 0 ? `${row.resources} ⬢` : "—"}</td>
      <td className="text-sm">
        {row.ingredients.length > 0 ? (
          row.ingredients.join(", ")
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}
