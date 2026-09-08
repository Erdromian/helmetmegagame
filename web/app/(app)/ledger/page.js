import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import { FreshCharacter } from "../character/page";
import LedgerView from "./LedgerView";
import Loading from "./loading";

// The second character sheet (web/app/components/CharacterLedger.js), drawing
// the signed-in player's own character in a different frame. Superadmin-only
// while the layout is being worked on — same guard /gm/dev uses, and the same
// destination for anyone else, so a player who guesses the URL just lands on
// their real sheet.
//
// The data is not loaded here: FreshCharacter is character/page.js's own
// body, imported whole. One load, two layouts.
export default async function LedgerPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  return (
    <SnapshotPage scope="ledger" userId={session.discordUserId} render={LedgerView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshCharacter userId={session.discordUserId} searchParams={searchParams} scope="ledger" />
      </Suspense>
    </SnapshotPage>
  );
}
