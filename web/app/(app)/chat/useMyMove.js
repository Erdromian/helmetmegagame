"use client";

import { useCallback, useState } from "react";
import { myMove } from "./actions";
import useVisiblePoll from "./useVisiblePoll";

// The turn card's state and its minute poll, shared by the Chat's YOU column
// and the sheet's band so the two can never say different things about the
// Move you filed. Seeded from the server's first paint; re-read every minute
// so a Move filed in Discord lands here without a reload.
export default function useMyMove(initial) {
  const [state, setState] = useState(initial);

  const refresh = useCallback(() => {
    myMove()
      .then((res) => {
        if (res?.ok) setState({ turn: res.turn, move: res.move });
      })
      .catch(() => {
        // The card is a reminder, not the record. A failed refresh loses
        // nothing a reload does not bring back.
      });
  }, []);

  // Through useVisiblePoll, so a tab left in the background stops asking and
  // catches up the moment it is looked at again.
  useVisiblePoll(refresh, 60_000);

  return { ...state, refresh };
}
