// The routing tables for player actions: which verbs run on the click with
// no dialog, and (as the dialogs migrate here) which component draws each
// mode. RequestActionsProvider.js reads both.

import { recallComrades, recoverEquipment } from "@/app/(app)/character/thanatiActions";
import { readPointer, armNuke, disarmNuke } from "@/app/(app)/character/nukeActions";
import { extractGodfleshRequest } from "@/app/(app)/character/requestActions";

// Instant verbs. Each is `{ run, confirm }`: `run()` is the server action,
// `confirm(pools)` is the one-line question to ask first, or null for none.
// The rule for which get a question: anything that spends the Move or is
// destructive asks; a free read (Recall, the pointer) or an undo (Disarm)
// does not. The result comes back as a notice (NoticeProvider.js), never a
// dialog — these used to open an empty RequestDialog whose only field was
// the Confirm button.
const RECOVER_NAMES = { "black-robes": "the robes", "thanati-mask": "the mask" };

export const INSTANT = {
  recall: { run: () => recallComrades(), confirm: () => null },
  recover: {
    run: () => recoverEquipment(),
    confirm: (pools) => {
      const missing = (pools?.recoverMissing ?? []).map((s) => RECOVER_NAMES[s]).filter(Boolean);
      return {
        title: "Recover your things?",
        message: `${missing.length ? `You get ${missing.join(" and ")} back.` : "You get them back."} It takes your Move for the turn. ‡`,
        confirmLabel: "Recover",
      };
    },
  },
  pointer: { run: () => readPointer(), confirm: () => null },
  arm: {
    run: () => armNuke(),
    confirm: () => ({
      title: "Arm the device?",
      message:
        "The card goes in and the count begins. It detonates at the close of the turn after next, and everyone who is not underground when it does will die — you included, unless you are. You can still take the card out before then.",
      confirmLabel: "Arm it",
    }),
  },
  disarm: { run: () => disarmNuke(), confirm: () => null },
  extract: {
    run: () => extractGodfleshRequest(),
    confirm: () => ({
      title: "Cut Godflesh?",
      message:
        "You wade out and cut. A day of it — this is your Move for the turn. It rolls 1d6: a 6 pays extra, and a 1 means it grabbed hold of you first. ‡",
      confirmLabel: "Cut",
    }),
  },
};

// Mode → dialog component. Filled in as the dialogs move out of the provider;
// a mode not listed here is still drawn by the provider's own inline block.
export const DIALOGS = {};
