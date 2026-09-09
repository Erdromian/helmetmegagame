import { redirect } from "next/navigation";

// The sheet this route used to draw is /character now — it won, and the old
// one was deleted (docs/systemdocs/SHEET.md). All that is left here is the
// forward, so a bookmark or a link somebody pasted in Discord still lands.
export default function LedgerPage() {
  redirect("/character");
}
