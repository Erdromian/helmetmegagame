"use server";

import { acting, guarded } from "@/lib/actionResult";
import {
  craftRequestImpl,
  continueCraftImpl,
  cancelCraftImpl,
} from "./actions/crafting.js";
import {
  joinBuildSiteImpl,
  cancelBuildSiteImpl,
} from "./actions/structures.js";
import {
  learnRequestImpl,
  teachRequestImpl,
  confessRequestImpl,
  kissRequestImpl,
  searchRequestImpl,
} from "./actions/offers.js";
import { transferRequestImpl } from "./actions/transfer.js";
import { stealRequestImpl } from "./actions/steal.js";
import { pickpocketRequestImpl, pickpocketTakeImpl } from "./actions/pickpocket.js";
import {
  poisonItemRequestImpl,
  poisonCharacterRequestImpl,
} from "./actions/poison.js";
import { healCharacterRequestImpl, performMiracleRequestImpl } from "./actions/medical.js";
import {
  buryCharacterRequestImpl,
  butcherCorpseRequestImpl,
  mutilateRequestImpl,
  engraveHeadstoneRequestImpl,
} from "./actions/corpse.js";
import {
  destroyTagRequestImpl,
  consumeTagRequestImpl,
  claimDesireImpl,
  changeNameRequestImpl,
  lootCharacterRequestImpl,
  bindCharacterRequestImpl,
  freeCharacterRequestImpl,
  breakRestraintsRequestImpl,
  crucifyCharacterRequestImpl,
  shackleCharacterRequestImpl,
  tortureCharacterRequestImpl,
  applyCollarRequestImpl,
  unlockCollarRequestImpl,
  detonateCollarRequestImpl,
  disguiseSelfRequestImpl,
  harmCharacterRequestImpl,
  brandCharacterRequestImpl,
  extractGodfleshRequestImpl,
  packageItemsRequestImpl,
} from "./actions/misc.js";
import { farmRequestImpl } from "./actions/soilery.js";
import { breakInArelitzRequestImpl } from "./actions/arelitz.js";
import { refineRequestImpl } from "./actions/refine.js";
import { mineRequestImpl } from "./actions/mine.js";
import {
  birdMessageRequestImpl,
  birdReplyRequestImpl,
  stepstoneRequestImpl,
  readPointerDeviceImpl,
} from "./actions/misc.js";

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js.
//
// acting() is guarded() plus the session gate: between sittings a player may
// talk and nothing else (SESSIONS.md §5). Every verb here is acting(); the one
// pure read at the bottom stays on guarded(), because reading is never an act.

export async function craftRequest(input) {
  return acting(() => craftRequestImpl(input));
}

export async function continueCraft(input) {
  return acting(() => continueCraftImpl(input));
}

export async function cancelCraft(input) {
  return acting(() => cancelCraftImpl(input));
}

// Opening a site has no export of its own: craftRequest() branches into it,
// because to a player raising a palisade is the same act as making a sword.
export async function joinBuildSite(input) {
  return acting(() => joinBuildSiteImpl(input));
}

export async function cancelBuildSite(input) {
  return acting(() => cancelBuildSiteImpl(input));
}

export async function destroyTagRequest(input) {
  return acting(() => destroyTagRequestImpl(input));
}

export async function learnRequest(input) {
  return acting(() => learnRequestImpl(input));
}

export async function teachRequest(input) {
  return acting(() => teachRequestImpl(input));
}

export async function confessRequest(input) {
  return acting(() => confessRequestImpl(input));
}

export async function kissRequest(input) {
  return acting(() => kissRequestImpl(input));
}

export async function searchRequest(input) {
  return acting(() => searchRequestImpl(input));
}

export async function transferRequest(input) {
  return acting(() => transferRequestImpl(input));
}

// Steal and Pickpocket (docs/systemdocs/THEFT.md). Note that `input` is handed
// straight through, which is why transferRequestImpl takes its announce switch
// as a SECOND argument rather than a field on this object.
export async function stealRequest(input) {
  return acting(() => stealRequestImpl(input));
}

export async function pickpocketRequest(input) {
  return acting(() => pickpocketRequestImpl(input));
}

export async function pickpocketTakeRequest(input) {
  return acting(() => pickpocketTakeImpl(input));
}

export async function consumeTagRequest(input) {
  return acting(() => consumeTagRequestImpl(input));
}

export async function poisonItemRequest(input) {
  return acting(() => poisonItemRequestImpl(input));
}

export async function poisonCharacterRequest(input) {
  return acting(() => poisonCharacterRequestImpl(input));
}

export async function healCharacterRequest(input) {
  return acting(() => healCharacterRequestImpl(input));
}
export async function performMiracleRequest(input) {
  return acting(() => performMiracleRequestImpl(input));
}
export async function claimDesire(input) {
  return acting(() => claimDesireImpl(input));
}

export async function changeNameRequest(input) {
  return acting(() => changeNameRequestImpl(input));
}

export async function lootCharacterRequest(input) {
  return acting(() => lootCharacterRequestImpl(input));
}

export async function bindCharacterRequest(input) {
  return acting(() => bindCharacterRequestImpl(input));
}
export async function freeCharacterRequest(input) {
  return acting(() => freeCharacterRequestImpl(input));
}
export async function breakRestraintsRequest() {
  return acting(() => breakRestraintsRequestImpl());
}
export async function crucifyCharacterRequest(input) {
  return acting(() => crucifyCharacterRequestImpl(input));
}
export async function shackleCharacterRequest(input) {
  return acting(() => shackleCharacterRequestImpl(input));
}
export async function tortureCharacterRequest(input) {
  return acting(() => tortureCharacterRequestImpl(input));
}
export async function applyCollarRequest(input) {
  return acting(() => applyCollarRequestImpl(input));
}
export async function unlockCollarRequest(input) {
  return acting(() => unlockCollarRequestImpl(input));
}
export async function detonateCollarRequest(input) {
  return acting(() => detonateCollarRequestImpl(input));
}
export async function disguiseSelfRequest(input) {
  return acting(() => disguiseSelfRequestImpl(input));
}
export async function harmCharacterRequest(input) {
  return acting(() => harmCharacterRequestImpl(input));
}

export async function brandCharacterRequest(input) {
  return acting(() => brandCharacterRequestImpl(input));
}

export async function buryCharacterRequest(input) {
  return acting(() => buryCharacterRequestImpl(input));
}

export async function butcherCorpseRequest(input) {
  return acting(() => butcherCorpseRequestImpl(input));
}

export async function mutilateRequest(input) {
  return acting(() => mutilateRequestImpl(input));
}

export async function engraveHeadstoneRequest(input) {
  return acting(() => engraveHeadstoneRequestImpl(input));
}

export async function extractGodfleshRequest(input) {
  return acting(() => extractGodfleshRequestImpl(input));
}

export async function farmRequest(input) {
  return acting(() => farmRequestImpl(input));
}

export async function breakInArelitzRequest(input) {
  return acting(() => breakInArelitzRequestImpl(input));
}

export async function refineRequest() {
  return acting(() => refineRequestImpl());
}

export async function mineRequest() {
  return acting(() => mineRequestImpl());
}

export async function packageItemsRequest(input) {
  return acting(() => packageItemsRequestImpl(input));
}

export async function birdMessageRequest(input) {
  return acting(() => birdMessageRequestImpl(input));
}


export async function birdReplyRequest(input) {
  return acting(() => birdReplyRequestImpl(input));
}

export async function stepstoneRequest(input) {
  return acting(() => stepstoneRequestImpl(input));
}

export async function readPointerDevice() {
  return guarded(() => readPointerDeviceImpl());
}
