import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  loadDepot,
  depotPowered,
  fuelTurnsLeft,
  creditAvailableObols,
  canOpenCrate,
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  presentedIdentity,
  forcedNameFrom,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import DepotConsole from "@/app/components/DepotConsole";
import PageShell, { PageHeader } from "@/app/components/PageShell";

// The Merchant's station. See docs/systemdocs/DEPOT.md.
//
// Three ways in, and they are deliberately different. The Merchant's Licence
// runs the place — the licence and not the ROLE, because the licence is
// tradeable and handing it over really does hand over the Depot. A Depot
// Keycard works it: a Docker can crack his crates, call the shuttle down,
// load it and send it back up, and keep the generator fed and running. What a
// keycard cannot do is spend: no ordering, no ATM, no credit line, no ⬢
// counter, and never the turret. A superadmin reads it. Everyone else is
// bounced.
//
// The reason the keycard grew teeth is the turn length. One turn is one real
// day, so "the Merchant will do it when he wakes up" is a day of nothing
// moving, and every step above is either free or costs the person doing it.
const TAG_SELECT = { include: { group: { select: { name: true } } } };

// How many ledger rows to hand the client. Enough to be a book, few enough
// that a month-old game does not ship a megabyte of JSON to a browser.
const LEDGER_LIMIT = 200;

// The ledger is built from the audit log now that player actions file no
// Request. The `details` blob IS the old `effect` — every depot action wrote
// `details: effect` — so the row prose below is unchanged; only the key it
// switches on moved from Request.type to AuditLog.actionType.
const DEPOT_LEDGER_KINDS = {
  request_depot_order: { key: "DEPOT_ORDER", label: "Order" },
  request_depot_shuttle_call: { key: "DEPOT_SHIP", label: "Shuttle" },
  request_depot_shuttle_send: { key: "DEPOT_SHIP", label: "Shuttle" },
  request_depot_atm: { key: "DEPOT_ATM", label: "Cash" },
  request_depot_exchange: { key: "DEPOT_EXCHANGE", label: "Exchange" },
  request_depot_credit: { key: "DEPOT_CREDIT", label: "Credit line" },
  request_depot_crate_open: { key: "DEPOT_CRATE_OPEN", label: "Crate" },
  request_depot_refuel: { key: "DEPOT_REFUEL", label: "Refuel" },
};

// One line of prose per ledger row, and the obols it moved. Derived from the
// `effect` snapshot rather than live state, the same rule Undo follows — a row
// has to keep reading correctly after the catalog moves under it.
function ledgerRow(entry, who) {
  const e = entry.details ?? {};
  switch (DEPOT_LEDGER_KINDS[entry.actionType]?.key) {
    case "DEPOT_ORDER":
      return { detail: (e.lines ?? []).map((l) => `${l.name} ×${l.quantity}`).join(", "), delta: -(e.total ?? 0) };
    case "DEPOT_SHIP":
      return e.direction === "UP"
        ? { detail: `Sent up ${(e.soldTags ?? []).length} lot(s)${e.resourcesSpent ? ` and ${e.resourcesSpent} ⬢` : ""}`, delta: e.payout ?? 0 }
        : { detail: `Shipment ${e.shipment ?? ""} — ${e.crates ?? 0} crate(s)`, delta: 0 };
    case "DEPOT_ATM":
      return { detail: e.direction === "WITHDRAW" ? "Withdrawn as coin" : "Deposited", delta: e.direction === "WITHDRAW" ? -(e.amount ?? 0) : (e.amount ?? 0) };
    case "DEPOT_CREDIT":
      return { detail: e.direction === "DRAW" ? "Drawn on the line" : "Repaid the line", delta: e.direction === "DRAW" ? (e.amount ?? 0) : -(e.amount ?? 0) };
    case "DEPOT_EXCHANGE":
      return {
        detail: e.direction === "BUY_RESOURCES" ? `Bought ${e.resources ?? 0} ⬢` : `Sold ${e.resources ?? 0} ⬢`,
        delta: e.direction === "BUY_RESOURCES" ? -(e.obols ?? 0) : (e.obols ?? 0),
      };
    case "DEPOT_CRATE_OPEN":
      return { detail: `${e.crateName ?? "A crate"} — ${(e.granted ?? []).map((g) => `${g.name} ×${g.quantity}`).join(", ") || "empty"}`, delta: 0 };
    case "DEPOT_REFUEL":
      return { detail: `${e.tagName ?? "Fuel"} ×${e.quantity ?? 0} into the generator`, delta: 0 };
    default:
      return { detail: e.tagName ? `${e.tagName} ×${e.quantity ?? 1}` : "", delta: 0 };
  }
}

export default async function DepotPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      resources: true,
      location: { select: { slug: true } },
      tags: {
        select: {
          quantity: true,
          tagId: true,
          equipped: true,
          tag: { select: { slug: true, forcedName: true, name: true, ...CONCEALMENT_TAG_FIELDS } },
        },
      },
    },
  });

  const heldSlugs = new Set((character?.tags ?? []).map((ct) => ct.tag.slug));
  const licensed = heldSlugs.has(MERCHANT_LICENSE_SLUG);
  const keycard = heldSlugs.has(DEPOT_KEYCARD_SLUG);
  const superadmin = isSuperadmin(session.discordUserId);

  if (!licensed && !keycard && !superadmin) redirect("/character");

  // The terminal is a thing in a room, not a website. Standing at the Depot is
  // now required to open the page at all, not merely to use it — every write
  // path already refuses from anywhere else (requireLicensedMerchant in
  // ./actions.js), so this is the page catching up to the server actions rather
  // than a new rule. A superadmin still reads it from anywhere.
  if (!superadmin && character?.location?.slug !== DEPOT_LOCATION_SLUG) redirect("/character");

  const depot = await loadDepot(prisma);
  const openTurn = await getOpenTurn();

  const [wareTags, pricedTags, pad, obolTag, ledgerRows] = await Promise.all([
    prisma.tag.findMany({ where: { depotPrice: { not: null } }, ...TAG_SELECT }),
    // The reference book: anything with a price in either direction. CATALOG
    // rows only — a minted runtime row (a player's custom painting keeps its
    // base's sellablePrice) must never become a public line in the price
    // book with the player's words on it. Selling one still works: the sell
    // path reads the held row, not this list.
    prisma.tag.findMany({
      where: {
        ephemeral: false,
        OR: [{ depotPrice: { not: null } }, { sellable: true, sellablePrice: { not: null } }],
      },
      ...TAG_SELECT,
    }),
    prisma.room.findUnique({
      where: { slug: LANDING_PAD_SLUG },
      include: { tags: { include: { tag: TAG_SELECT } } },
    }),
    prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } }),
    prisma.auditLog.findMany({
      where: { actionType: { in: Object.keys(DEPOT_LEDGER_KINDS) } },
      orderBy: { createdAt: "desc" },
      take: LEDGER_LIMIT,
      select: {
        id: true,
        actionType: true,
        details: true,
        createdAt: true,
        turnId: true,
        targetCharacter: { select: { name: true } },
      },
    }),
  ]);

  // AuditLog carries a turnId but no relation to Turn, so the numbers come
  // back in one extra round trip rather than a join.
  const ledgerTurnIds = [...new Set(ledgerRows.map((r) => r.turnId).filter(Boolean))];
  const ledgerTurnNumbers = new Map(
    ledgerTurnIds.length
      ? (
          await prisma.turn.findMany({
            where: { id: { in: ledgerTurnIds } },
            select: { id: true, number: true },
          })
        ).map((t) => [t.id, t.number])
      : [],
  );

  const heldByTagId = new Map((character?.tags ?? []).map((ct) => [ct.tagId, ct.quantity]));

  const shape = (tag) => ({
    id: tag.id,
    name: tag.name,
    description: tag.description ?? "",
    groupName: tag.group?.name ?? "",
    price: tag.depotPrice,
    sellPrice: tag.sellablePrice,
    // What the station makes on the round trip, from his side of the counter.
    margin: tag.depotPrice != null && tag.sellablePrice != null ? tag.sellablePrice - tag.depotPrice : null,
    held: heldByTagId.get(tag.id) ?? 0,
    stackable: tag.stackable,
    sealed: Boolean(tag.sealedShipping),
    tag,
  });

  const wares = wareTags.map(shape);
  const priceList = pricedTags.map((tag) => ({
    ...shape(tag),
    side: tag.depotPrice != null && tag.sellablePrice != null ? "Both" : tag.depotPrice != null ? "Sells to you" : "Buys from you",
  }));

  // Crates the reader is carrying, with their manifest already printed on the
  // description. `canOpen` is advisory — the action re-checks the keycard.
  const crates = (character?.tags ?? []).length
    ? (
        await prisma.tag.findMany({
          where: {
            custom: true,
            crateContents: { not: null },
            id: { in: [...heldByTagId.keys()] },
          },
        })
      ).map((tag) => ({
        id: tag.id,
        name: tag.name,
        description: tag.description ?? "",
        sealed: tag.sealedShipping,
        canOpen: canOpenCrate(tag, heldSlugs),
      }))
    : [];

  const fuelSources = [
    { slug: COAL_SLUG, name: "Coal", perUnit: depot.coalFuel },
    { slug: SALTPETER_SLUG, name: "Saltpeter", perUnit: depot.saltpeterFuel },
  ];
  const bySlug = new Map((character?.tags ?? []).map((ct) => [ct.tag.slug, ct.quantity]));

  const greeting = character
    ? presentedIdentity(character, {
        forcedName: forcedNameFrom(character.tags),
        concealment: concealmentFrom(character.tags),
      }).name
    : null;

  const atDepot = character?.location?.slug === DEPOT_LOCATION_SLUG;
  const powered = depotPowered(depot);
  // Read-only unless you hold the licence. Everything below is a hint anyway —
  // the actions re-check all of it.
  const readOnly = !licensed;
  // A "hand" is anyone who may work the machinery: the licence, or a keycard.
  // Superadmins are deliberately NOT hands — /gm/dev is the GM's door and this
  // page is a thing in a room.
  const hand = licensed || keycard;

  return (
    <PageShell width="wide">
      <PageHeader
        title="The Depot"
        subtitle="A hangar door in the roof of the caves and an automated shuttle that comes through it. Everything imported into Ravenheart lands here, and leaves here as somebody's problem. ‡"
      />
      <DepotConsole
        depot={{
          accountObols: depot.accountObols,
          debtObols: depot.debtObols,
          creditCapObols: depot.creditCapObols,
          generatorOn: depot.generatorOn,
          generatorFuel: depot.generatorFuel,
          fuelMax: depot.fuelMax,
          fuelBurnPerTurn: depot.fuelBurnPerTurn,
          turretArmed: depot.turretArmed,
          merchantFace: depot.merchantFace,
          shuttleState: depot.shuttleState,
          shuttleTurn: depot.shuttleTurn,
          shuttleMaxTurns: depot.shuttleMaxTurns,
        }}
        greetingName={greeting}
        turnNumber={openTurn?.number ?? null}
        fuelTurnsLeft={fuelTurnsLeft(depot)}
        readOnly={readOnly}
        hand={hand}
        atDepot={Boolean(atDepot)}
        powered={powered}
        // Four flags, because there are two levels of authority and two of
        // them have to survive the lights going out.
        //
        //   disabled            the money and the gun — licence only
        //   handDisabled        the machinery — licence or keycard
        //   handPoweredDisabled the machinery that works in the dark, which
        //                       is the fuel hatch and the starter. Without
        //                       this one a dead generator was unrecoverable
        //                       from the UI: the Feed button was greyed out
        //                       by the very outage it existed to fix.
        //   poweredDisabled     shutting it down — licence only, in the dark
        disabled={readOnly || !atDepot || !powered}
        handDisabled={!hand || !atDepot || !powered}
        handPoweredDisabled={!hand || !atDepot}
        poweredDisabled={readOnly || !atDepot}
        wares={wares}
        priceList={priceList}
        manifest={Array.isArray(depot.manifest) ? depot.manifest : []}
        pad={{
          resources: pad?.resources ?? 0,
          rows: (pad?.tags ?? []).map((rt) => ({
            id: rt.id,
            quantity: rt.quantity,
            sellPrice: rt.tag.sellablePrice,
            tag: rt.tag,
          })),
        }}
        crates={crates}
        heldObols={obolTag ? (heldByTagId.get(obolTag.id) ?? 0) : 0}
        resources={character?.resources ?? 0}
        creditAvailable={creditAvailableObols(depot)}
        fuel={{
          turnsLeft: fuelTurnsLeft(depot),
          sources: fuelSources.map((s) => ({ ...s, held: bySlug.get(s.slug) ?? 0 })),
        }}
        ledger={ledgerRows.map((r) => {
          const who = r.targetCharacter?.name ?? "—";
          const { detail, delta } = ledgerRow(r, who);
          return {
            id: r.id,
            label: DEPOT_LEDGER_KINDS[r.actionType]?.label ?? r.actionType,
            detail,
            who,
            delta,
            turn: ledgerTurnNumbers.get(r.turnId) ?? null,
            at: r.createdAt.getTime(),
          };
        })}
      />
    </PageShell>
  );
}
