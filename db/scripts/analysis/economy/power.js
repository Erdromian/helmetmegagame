// Starting power, by role — three separate, honestly-labelled measures rather than one number
// pretending to be precise. Built entirely from what db/scripts/analysis/economy/starting.js already
// worked out (docs/roles.yaml, docs/zones.yaml), so there is nothing new to read from disk here.
//
//   TAG VALUE      What the free starting kit would have cost at character creation, point for
//                  point — a role's own starting_tags priced the same way the point-buy store prices
//                  everyone else's purchases (Tag.pointCost). Obols and Resources carry no pointCost,
//                  so a fat purse does not inflate this; it is a skills-and-gear number, in points.
//
//   WEALTH         What a role could turn into spendable ¢ on day one, on its own: bank plus coin in
//                  hand plus ⬢ on the person, the ⬢ valued at the Depot's sell-back (the guaranteed
//                  floor — nobody can be paid less for it) so this is a liquidation value, not a
//                  replacement cost. ⬢ is never folded into ¢ silently anywhere else in this report
//                  and is not here either — the rate used is named beside every figure.
//
//   REACH          What a role's OWN keys open beyond its own pocket: the ⬢ and ¢ sitting in locked
//                  rooms its starting tags admit it to (starting.js's keyedResources/keyedCoin),
//                  valued the same way as WEALTH. Several roles can share one key, so this is what a
//                  role COULD reach, same honest limit starting.js's own header states.
//
//   SOFT POWER     The vague one, on purpose — the user asked for it anyway, because "how much of a
//                  big deal is this seat" is a real question a GM asks even though nothing in the
//                  catalog prices it. Built from signals that ARE in the data, not from reading each
//                  role's prose for the word "leader": whether it is a unique named seat
//                  (`multiple: false` — Baron, Bishop, Sheriff, one to a game, docs/roles.yaml's own
//                  header calls this out as the leadership tell), whether it is whitelisted (vetted
//                  players only), how autonomous its bank account is (an OFFSHORE account answers to
//                  nobody's Vault), how many keys and licences it starts with, how many locked rooms
//                  those open, how much lore it starts already knowing (`doc_elements`), its own bonus
//                  points at creation, and how rare the seat itself is. Every weight is a small,
//                  round, shown number — see SOFT_POWER_WEIGHTS below — so a reader can add the
//                  columns up by hand and see exactly why a role scored what it did. Change the
//                  weights on a re-read; nothing else here depends on their exact values.
//
// COMPOSITE folds the three measures into one sortable column the only defensible way to combine
// numbers in three different units: each role's PERCENTILE RANK on each measure (0 to 100, among
// seated roles only), averaged. It is a ranking aid, not a fourth measure — the three above are what
// actually says something.

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

const SOFT_POWER_WEIGHTS = {
  uniqueSeat: 20, // multiple: false — Baron, Bishop, Sheriff, one to a game
  whitelisted: 15, // vetted players only (LEADER-WHITELIST-role gated at creation)
  bankAccount: { treasury: 5, offshore: 8, none: 0 }, // answering to nobody's Vault is its own kind of power
  perKeyOrLicence: 3, // capped below
  maxKeys: 7,
  perLockedRoom: 2, // capped below
  maxRooms: 10,
  perDocElement: 2, // insider lore access, capped below
  maxDocElements: 5,
  perExtraPoint: 1, // the Baron's +5, the Courtier's +7
  maxExtraPoints: 10,
  scarcity: 10, // a common role (many seats) earns none; a scarce one (few seats) earns up to this
  scarcitySeatFloor: 10, // seats at or above this count as "common", earning no scarcity bonus
};

function softPowerFor(role, w = SOFT_POWER_WEIGHTS) {
  const parts = {
    uniqueSeat: role.multiple === false ? w.uniqueSeat : 0,
    whitelisted: role.whitelist ? w.whitelisted : 0,
    bankAccount: w.bankAccount[role.account ?? "none"] ?? 0,
    keys: Math.min(w.maxKeys, role.keys.length) * w.perKeyOrLicence,
    rooms: Math.min(w.maxRooms, role.rooms.length) * w.perLockedRoom,
    docElements: Math.min(w.maxDocElements, role.docElements.length) * w.perDocElement,
    extraPoints: Math.min(w.maxExtraPoints, role.extraPoints) * w.perExtraPoint,
    // A unique seat's scarcity is already counted by uniqueSeat above; an unlimited one (Migrant,
    // the Bastard's rank and file) has no ceiling to be scarce against. Only an ordinary multi-seat
    // role (Cerberus, Courtier, Serpent…) is scored here, on how few of it the town holds: full
    // marks at 0 seats, none at scarcitySeatFloor or more, a straight line between.
    scarcity: role.multiple === false || role.unlimited
      ? 0
      : Math.max(0, w.scarcity * (1 - (role.seats ?? 0) / w.scarcitySeatFloor)),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total: Math.round(total), parts };
}

// 0..100: what fraction of the OTHER seated roles this role beats or ties on `get(role)`. Used to put
// three different units (points, ¢, a house-rules score) on one comparable scale for COMPOSITE only.
function percentileRank(roles, get) {
  const values = roles.map(get).filter((v) => Number.isFinite(v));
  const at = new Map();
  for (const role of roles) {
    const v = get(role);
    if (!Number.isFinite(v)) {
      at.set(role.slug, null);
      continue;
    }
    const below = values.filter((x) => x <= v).length;
    at.set(role.slug, Math.round((below / values.length) * 100));
  }
  return at;
}

function buildPower({ starting, rv }) {
  const seated = starting.roles.filter((r) => (r.seats ?? 0) > 0 || r.unlimited);
  const rows = seated.map((role) => {
    const wealthCoin = role.bank + role.coinHand + (role.resources + role.cracked) * rv.sell;
    const reachCoin = role.keyedCoin + role.keyedResources * rv.sell;
    const soft = softPowerFor(role);
    return {
      slug: role.slug,
      name: role.name,
      group: role.groupName,
      seats: role.unlimited ? "no cap" : role.seats,
      multiple: role.multiple,
      whitelist: role.whitelist,
      account: role.account,
      tagValue: role.tagPointValue,
      bank: role.bank,
      coinHand: role.coinHand,
      resources: role.resources + role.cracked,
      wealthCoin: round1(wealthCoin),
      keyedCoin: role.keyedCoin,
      keyedResources: role.keyedResources,
      reachCoin: round1(reachCoin),
      keys: role.keys,
      rooms: role.rooms.length,
      docElements: role.docElements,
      extraPoints: role.extraPoints,
      softPower: soft.total,
      softParts: soft.parts,
      composite: null, // filled below, once every row exists to rank against
    };
  });

  // Percentiles are worked out over every SEATED role (unlimited roles included — a Migrant is a real
  // seat even though the town holds any number of them), then averaged for one sortable column.
  const tagPct = percentileRank(rows, (r) => r.tagValue);
  const wealthPct = percentileRank(rows, (r) => r.wealthCoin);
  const softPct = percentileRank(rows, (r) => r.softPower);
  for (const r of rows) {
    const pcts = [tagPct.get(r.slug), wealthPct.get(r.slug), softPct.get(r.slug)].filter((v) => v != null);
    r.tagPercentile = tagPct.get(r.slug);
    r.wealthPercentile = wealthPct.get(r.slug);
    r.softPercentile = softPct.get(r.slug);
    r.composite = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  }
  rows.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));

  const byGroup = new Map();
  for (const r of rows) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  const groups = [...byGroup.entries()].map(([group, groupRows]) => ({
    group,
    roles: groupRows.length,
    avgComposite: round1(groupRows.reduce((n, r) => n + (r.composite ?? 0), 0) / groupRows.length),
    topRole: [...groupRows].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))[0]?.name ?? null,
  })).sort((a, b) => b.avgComposite - a.avgComposite);

  return {
    rows,
    groups,
    weights: SOFT_POWER_WEIGHTS,
    rvSell: rv.sell,
    topTagValue: [...rows].sort((a, b) => b.tagValue - a.tagValue)[0],
    topWealth: [...rows].sort((a, b) => b.wealthCoin - a.wealthCoin)[0],
    topSoft: [...rows].sort((a, b) => b.softPower - a.softPower)[0],
    topComposite: rows[0],
  };
}

module.exports = { buildPower, softPowerFor, SOFT_POWER_WEIGHTS };
