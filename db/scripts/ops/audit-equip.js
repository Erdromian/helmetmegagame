#!/usr/bin/env node
// Which living characters are wearing a set the new slot rules would refuse
// (docs/systemdocs/TAGS.md, "equipSlot / equipLayer / twoHanded"). Read-only,
// always: the rule is checked when somebody next equips, and nothing here or
// anywhere else takes a thing out of a player's hands for them. This is the
// list a GM reads to decide whether to.
//
//   npm run db:audit-equip
const { prisma } = require("../../index");
const { findEquipProblem, handsUsed, WEAPON_HANDS } = require("../../lib/equipSlots");

async function main() {
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      name: true,
      tags: {
        where: { equipped: true },
        // equippedQuantity rides along because findEquipProblem/handsUsed
        // expand a row into that many physical units — without it a stack
        // worn three-deep reads as one thing and the audit misses the very
        // overfull hands it exists to find.
        select: {
          equippedQuantity: true,
          tag: { select: { name: true, slug: true, equippable: true, equipSlot: true, equipLayer: true, twoHanded: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  let offenders = 0;
  let slotless = 0;
  for (const c of characters) {
    const problem = findEquipProblem(c.tags);
    const bare = c.tags.filter((ct) => ct.tag.equippable && !ct.tag.equipSlot);
    if (!problem && bare.length === 0) continue;
    if (problem) offenders += 1;
    slotless += bare.length;
    const units = c.tags.reduce((n, ct) => n + (ct.equippedQuantity ?? 1), 0);
    console.log(`\n${c.name} — ${units} equipped, ${handsUsed(c.tags)}/${WEAPON_HANDS} hands`);
    if (problem) console.log(`  refused: ${problem}`);
    for (const ct of bare) console.log(`  no slot (custom tag?): ${ct.tag.name} (${ct.tag.slug})`);
  }
  console.log(`\n${characters.length} living characters, ${offenders} wearing a set the rules refuse, ${slotless} slotless equipped tags.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
