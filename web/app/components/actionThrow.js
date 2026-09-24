"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";

// What to tell a player when a server action THROWS rather than answering { ok: false }.
//
// Every catch on the player side used to say "Could not reach the server. Nothing was changed."
// whatever had happened, and it was usually wrong twice over. Most throws are not the network:
//
// - A tab left open across a deploy calls action ids the new build does not have. Next throws
//   UnrecognizedActionError, and every action on the page fails until a reload. `deploymentId`
//   in next.config.mjs only reloads on a navigation, never on an action. The desks answer the same
//   error in useDeskVersion.js#mutationErrorMessage.
// - A bug in the action throws on the server, and the action may already have written. A Move
//   used to be filed and confirmed, then throw on its way out, and the player was told nothing
//   had changed.
//
// So only a fetch that never got an answer says "could not reach", and only the two cases where
// nothing ran say "nothing was changed".
export function actionThrowMessage(err) {
  if (unstable_isUnrecognizedActionError(err)) {
    return "The game was updated while this page was open. Reload the page and try again. Nothing was changed.";
  }
  // fetch() rejects with a TypeError when the request never got a response.
  if (err instanceof TypeError) return "Could not reach the server. Nothing was changed.";
  return "Something went wrong on the server. Check whether it went through before trying again.";
}
