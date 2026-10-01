// WHAT A GM'S PREVIEW OF A FIXTURE SHOWS. A GM in /chat can open every
// fixture a place has (db/lib/placeAffordances.js#gmAffordancesAt) to see the
// dialog a player gets, and nothing they do in it is sent anywhere
// (web/app/(app)/chat/GmFixturePreview.js). This is the one read behind that
// dialog: what a player standing there would see, read once when it opens.
//
// READS ONLY, all the way down. Every lens below is a GM sibling of the
// player's view that takes no actor and calls nothing that writes — no hold
// taken on the vending machine, no receiver lifted, no keypad try counted, and
// no machine or phone number created because none was there yet.
//
// Names are real names: nobody is a stranger to the host, which is the GM
// column's posture everywhere else.

import { boardFor, boardText } from "@lifeweb/db/lib/noticeboard";
import { paperViewGm } from "@lifeweb/db/lib/paper";
import { machineGmView } from "@lifeweb/db/lib/vending";
import { blackMarketGmView } from "@lifeweb/db/lib/blackMarket";
import { terminalGmView } from "@lifeweb/db/lib/merchantTerminal";
import { meisterBooks } from "@lifeweb/db/lib/meisterTerminal";
import { processGmView, documentsGmView } from "@lifeweb/db/lib/gatehouse";
import { phoneGmView } from "@lifeweb/db/lib/phone";
import { nukeGmView } from "@lifeweb/db/lib/nuke";
import { ARM_WORD, DISARM_WORD, gatehouseTurretArmed } from "@lifeweb/db/lib/gatehouseTurret";
import { GATEHOUSE_TEXT, BRIDGE_SLUG } from "@lifeweb/db/lib/gatehouseText";

const word = (armed) => ({ ok: true, armed, word: armed ? DISARM_WORD : ARM_WORD });

/**
 * The snapshot for one fixture, already checked to be at `location` by the
 * caller. `entry` is the affordance as gmAffordancesAt built it, never what
 * the client sent.
 */
export async function fixtureSnapshot(prisma, location, entry) {
  switch (entry.id) {
    case "noticeboard": {
      const ctx = await boardFor(prisma, location.id);
      if (ctx.error) return { ok: false, error: ctx.error };
      // Every notice's text comes with the board, so Read opens it in the
      // browser instead of asking again. A GM reads past wax, as on the GM
      // tab's own board (paperViewGm).
      return {
        ok: true,
        heading: boardText(ctx.location.name, ctx.posts, ctx.openTurn?.number ?? 0),
        notices: ctx.posts.map((p) => {
          const paper = paperViewGm(p.tag);
          return { id: p.id, name: p.tag.name, reading: { ok: true, name: p.tag.name, text: paper.text, plain: paper.plain, paper } };
        }),
        holding: [],
      };
    }
    case "converse": {
      // Every room with a thread to open a corner in. A player sees only the
      // ones their keys let them into; a GM is shown them all.
      const rooms = await prisma.room.findMany({
        where: { locationId: location.id, discordThreadId: { not: null } },
        select: { id: true, name: true, kind: true },
        orderBy: { sortOrder: "asc" },
      });
      return { ok: true, rooms: rooms.map((r) => ({ id: r.id, name: r.name, private: r.kind === "PRIVATE" })) };
    }
    case "requestPassage": {
      // Asked from the Bridge it is a way in; from the Square, a way out
      // (db/lib/gatehouse.js#directionFor). A GM carries nothing to offer.
      const inward = location.slug === BRIDGE_SLUG;
      return {
        ok: true,
        direction: inward ? "IN" : "OUT",
        intro: inward ? GATEHOUSE_TEXT.requestIntroIn : GATEHOUSE_TEXT.requestIntroOut,
        things: [],
        pending: null,
      };
    }
    case "processRequests":
      return processGmView(prisma);
    case "createDocuments":
      return documentsGmView(prisma);
    case "blackMarket":
      return blackMarketGmView(prisma);
    case "merchantTerminal":
      return terminalGmView(prisma);
    case "meisterTerminal":
      // No ring on a GM's finger to connect, and no seat to set.
      return { ok: true, ...(await meisterBooks(prisma)), rings: [], seats: [] };
    case "vending":
      return machineGmView(prisma, entry.roomId);
    case "turret":
      return word(await gatehouseTurretArmed(prisma));
    case "depotTurret": {
      const depot = await prisma.depot.findUnique({ where: { id: 1 }, select: { turretArmed: true } });
      return word(depot?.turretArmed === true);
    }
    case "phone":
      return phoneGmView(prisma, entry.roomId);
    case "nuke":
      return nukeGmView(prisma, entry.roomId);
    default:
      return { ok: true };
  }
}
