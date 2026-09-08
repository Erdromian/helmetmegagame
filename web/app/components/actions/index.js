// The routing tables for player actions: which verbs run on the click with
// no dialog, and (as the dialogs migrate here) which component draws each
// mode. RequestActionsProvider.js reads both.

import { recallComrades, recoverEquipment } from "@/app/(app)/character/thanatiActions";
import { readPointer, armNuke, disarmNuke } from "@/app/(app)/character/nukeActions";
import { extractGodfleshRequest, healCharacterRequest } from "@/app/(app)/character/requestActions";
import BindDialog, { BIND_VERBS } from "./BindDialog";
import HarmDialog from "./HarmDialog";
import MutilateDialog from "./MutilateDialog";
import BodyDialog from "./BodyDialog";
import EngraveDialog from "./EngraveDialog";
import DisguiseDialog from "./DisguiseDialog";
import ConsumeDialog from "./ConsumeDialog";
import HideoutDialog from "./HideoutDialog";
import MoveThingsDialog from "./MoveThingsDialog";
import DestroyDialog from "./DestroyDialog";
import PackageDialog from "./PackageDialog";
import PurchaseDialog from "./PurchaseDialog";

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
export const DIALOGS = {
  bind: BindDialog,
  free: BindDialog,
  crucify: BindDialog,
  torture: BindDialog,
  harm: HarmDialog,
  mutilate: MutilateDialog,
  bury: BodyDialog,
  butcher: BodyDialog,
  engrave: EngraveDialog,
  disguise: DisguiseDialog,
  consume: ConsumeDialog,
  hideout: HideoutDialog,
  transfer: MoveThingsDialog,
  loot: MoveThingsDialog,
  destroy: DestroyDialog,
  package: PackageDialog,
  purchase: PurchaseDialog,
};

// The shortcut past the picker. When a dialog is opened with the one thing it
// would have asked for already decided — Bind from Ada's own row in the HERE
// list — there is nothing left to pick, so the one question is asked straight
// away and the verb runs. Each returns `{ ask, run, ctx }` or null to fall
// through to the dialog. The name comes off the page's own roster; a preset
// for someone not on it (a stale page) falls through rather than guessing.
function bindShortcut(mode) {
  return (seed, bag) => {
    if (!seed?.targetId) return null;
    const target = (bag?.bindTargets ?? []).find((t) => t.id === seed.targetId);
    if (!target || !BIND_VERBS[mode].fit(target)) return null;
    const verb = BIND_VERBS[mode];
    return { ask: verb.confirm(target.name), run: () => verb.run(target.id), ctx: { name: target.name } };
  };
}

export const FAST_PATHS = {
  bind: bindShortcut("bind"),
  free: bindShortcut("free"),
  torture: bindShortcut("torture"),
  crucify: bindShortcut("crucify"),
  // Heal, when the patient has exactly one thing wrong and you are paying:
  // the dialog would have had one chip lit and one payer, which is no dialog.
  heal: (seed, bag) => {
    if (!seed?.patientId || !bag?.selfId) return null;
    const patient = (bag.healTargets ?? []).find((t) => t.id === seed.patientId);
    if (!patient || (patient.healable ?? []).length !== 1) return null;
    const affliction = patient.healable[0];
    const self = patient.id === bag.selfId;
    return {
      ask: {
        title: self ? `Treat your ${affliction.tagName}?` : `Treat ${patient.name}'s ${affliction.tagName}?`,
        message: `Costs ${affliction.cost ?? 0} ⬢, paid by you.${
          affliction.gambit
            ? " This is beyond routine, so it counts as a Gambit: it uses your Move, a die is rolled, and a poor result can leave them worse off."
            : affliction.counts
              ? ` One of the ${bag.healsLeft ?? "few"} cases you can work this turn.`
              : " First aid doesn't cost a Move."
        } ‡`,
        confirmLabel: "Treat",
      },
      run: () =>
        healCharacterRequest({
          targetCharacterId: patient.id,
          tagId: affliction.tagId,
          payerKey: `character:${bag.selfId}`,
        }),
      ctx: { name: self ? "You" : patient.name, self },
    };
  },
};
