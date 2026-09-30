// The Economist role's player lookup — funds, hunger and economic tags only.
// The (econ) layout has already checked isGm/isEconomist/isSuperadmin
// (web/app/(econ)/layout.js), so there's no gate here.
//
// Deliberately NOT the GM roster desk (/gm/players): this is a read-only
// lookup, not a desk — no GM notes, no conversation rail, no DM box, no edit
// actions. It also is NOT zone-scoped: the ask was to limit which FIELDS the
// Economist sees on a character, not which characters, so every ALIVE
// character is listed.
//
// Fields shown: obols and resources on hand, the bank claim, hunger, and
// every held tag isEconomicTag() (web/lib/economicTags.js) allows through —
// Items, Assets, and the Crafting/Brewing/Medical/Work skill groups. Health,
// Status, General, Meta, Demoness, anything catalog:secret or behind a secret
// gate, and every written sheet or photograph never reach this page at all;
// the rows are cut here on the server, so the browser is never sent them.

import { prisma } from "@lifeweb/db";
import { isEconomicTag, ECONOMIC_TAG_RULE_SELECT } from "@/lib/economicTags";
import EconRosterTable from "./EconRosterTable";

export const metadata = {
  title: "Players",
  description: "Player funds and economic tags, for the Economist role",
  robots: { index: false, follow: false },
};

// The two money tags are broken out as Funds columns of their own — showing
// them again in the tag list would repeat the exact double-count ECONOMY.md
// §1 warns against reading as (even though nothing is summed twice here).
const MONEY_SLUGS = new Set(["resources", "obol"]);

export default async function EconPlayersPage() {
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      hungerValue: true,
      location: { select: { name: true, zone: { select: { name: true } } } },
      bankAccount: { select: { balanceObols: true, class: true } },
      tags: {
        select: {
          quantity: true,
          equipped: true,
          tag: {
            select: {
              slug: true,
              name: true,
              sprite: true,
              mastery: true,
              ...ECONOMIC_TAG_RULE_SELECT,
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows = characters.map((c) => {
    const resources = c.tags.find((ct) => ct.tag.slug === "resources")?.quantity ?? 0;
    const obols = c.tags.find((ct) => ct.tag.slug === "obol")?.quantity ?? 0;
    // The Baron's CROWN account is the Vault, not money of their own; showing
    // the pile here would count the whole treasury as one person's funds.
    const banked = c.bankAccount?.class === "CROWN" ? 0 : (c.bankAccount?.balanceObols ?? 0);
    // Only the chip's own fields cross to the browser: the gate columns the
    // rule read stay on the server.
    const tags = c.tags
      .filter((ct) => !MONEY_SLUGS.has(ct.tag.slug) && isEconomicTag(ct.tag))
      .map(({ quantity, tag }) => ({
        quantity,
        tag: {
          slug: tag.slug,
          name: tag.name,
          category: tag.category,
          sprite: tag.sprite,
          mastery: tag.mastery,
          group: tag.group ? { slug: tag.group.slug, name: tag.group.name } : null,
        },
      }));
    return {
      id: c.id,
      name: c.name,
      zone: c.location?.zone?.name ?? null,
      location: c.location?.name ?? null,
      hunger: c.hungerValue,
      resources,
      obols,
      banked,
      totalObols: obols + banked,
      tags,
    };
  });

  return (
    <div className="desk-shell">
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "1rem" }}>
        <h1 className="text-lg font-semibold mb-3">Players</h1>
        <EconRosterTable rows={rows} />
      </div>
    </div>
  );
}
