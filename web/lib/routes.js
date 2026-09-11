// Route patterns for revalidatePath, where a literal URL is not enough.
//
// revalidatePath needs the ROUTE, not a path that happens to match it, once a
// route has a dynamic segment. The adjudication desk carries its selection in
// the URL (/gm/turns/move/<id>), so `revalidatePath("/gm/turns")` invalidates
// only the bare URL — a GM with a Move open would never receive it. Passing
// the pattern plus "page" covers every selection.

export const TURNS_PATH = "/gm/turns/[[...selection]]";

// The adjudication desk's selection URL. It is a SEARCH PARAM, not a path
// segment, and page.js explains at length why — a path param changing under
// router.refresh() remounts the whole desk. Everything that links to a Move or
// a Caving roll builds its href here, so there is one spelling.
export function turnsSelectionHref(sel) {
  return sel ? `/gm/turns?sel=${sel.type}/${sel.id}` : "/gm/turns";
}
