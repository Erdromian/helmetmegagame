import { redirect } from "next/navigation";

// /gm/dev/threats is not a page — the threat surfaces are two SECTIONS of the
// Dev Panel (Assignments and Antagonists, THREATS.md §1), reached as
// /gm/dev?s=assignments. The folder beside this one holds their tables, which
// the panel imports; it never held a page.js, so every link written to the
// obvious-looking /gm/dev/threats 404'd instead of landing anywhere.
//
// A redirect rather than a fourth copy of the panel: there is one Threats
// surface and it is on the panel, so this points at it.
export default function ThreatsRedirect() {
  redirect("/gm/dev?s=assignments");
}
