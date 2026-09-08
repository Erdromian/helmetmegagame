import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import { FreshCharacter } from "../character/page";
import LedgerView from "./LedgerView";
import Loading from "./loading";

// The second character sheet (web/app/components/CharacterLedger.js), drawing
// the signed-in player's own character in a different frame. Open to every
// player for now, so the layout gets looked at by the people it is for; it
// comes back behind a gate, or replaces /character, once it has been judged.
//
// The data is not loaded here: FreshCharacter is character/page.js's own
// body, imported whole. One load, two layouts.
export default async function LedgerPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  return (
    <SnapshotPage scope="ledger" userId={session.discordUserId} render={LedgerView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshCharacter userId={session.discordUserId} searchParams={searchParams} scope="ledger" />
      </Suspense>
    </SnapshotPage>
  );
}
