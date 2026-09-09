#!/usr/bin/env node
// Everything about one character that decides whether they are hidden, and
// from what. Read-only, always — this answers a question, it does not repair
// anything.
//
//   npm run db:inspect-character -- "Semyun"
//
// It exists because the two switches on /character are the two a player is
// most likely to report as broken, and neither leaves a trace anywhere a GM
// can read. "Play from the web" is a column plus a burst of best-effort
// Discord calls, and concealment is not stored at all — it is derived at read
// time from the column AND what is equipped, so `concealed: true` on its own
// means nothing (PROXYING.md §5). Both answers are computed here by the same
// functions every send path asks, rather than restated.
//
// Matches on a case-insensitive fragment of the name, so a first name is
// enough, and prints every match rather than guessing which one was meant.
const { prisma } = require("../../index");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("../../lib/presentedIdentity");
const { findEquipProblem, handsUsed, WEAPON_HANDS } = require("../../lib/equipSlots");

// db/lib/webOnly.js keeps this as its own constant rather than a config
// column. Imported would be better, but it is not exported and this script
// has no business changing that module's surface — so it is read from the
// stamp instead, and a drift here only mis-states the clock.
const WEB_ONLY_COOLDOWN_SECONDS = 7200;

function stamp(date) {
  return date ? date.toISOString() : "never";
}

function cooldownLine(changedAt) {
  if (!changedAt) return "no cooldown running — it has never been flipped";
  const readyAt = new Date(changedAt.getTime() + WEB_ONLY_COOLDOWN_SECONDS * 1000);
  const left = readyAt.getTime() - Date.now();
  if (left <= 0) return `free to flip (last flip ${stamp(changedAt)})`;
  return `REFUSES a flip for another ${Math.ceil(left / 60000)} min, until ${stamp(readyAt)}`;
}

async function main() {
  const fragment = process.argv.slice(2).join(" ").trim();
  if (!fragment) {
    console.error('Usage: npm run db:inspect-character -- "<part of a name>"');
    process.exitCode = 1;
    return;
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { playPanelEnabled: true },
  });
  // Off, and "Play from the web" is neither drawn nor honoured for anybody who
  // is not already web-only — a hand-posted "on" is discarded server-side
  // (web/app/(app)/character/actions.js). That is the first thing to rule out.
  console.log(`GameConfig.playPanelEnabled: ${config?.playPanelEnabled !== false}`);

  const characters = await prisma.character.findMany({
    where: { name: { contains: fragment, mode: "insensitive" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      age: true,
      gender: true,
      updatedAt: true,
      discordUserId: true,
      discordRoleId: true,
      webOnly: true,
      webOnlyChangedAt: true,
      concealed: true,
      roomThreadRoomIds: true,
      location: { select: { name: true } },
      zone: { select: { name: true } },
      tags: {
        select: {
          equipped: true,
          quantity: true,
          expiresTurn: true,
          tag: {
            select: {
              slug: true,
              forcedName: true,
              equippable: true,
              equipSlot: true,
              twoHanded: true,
              ...CONCEALMENT_TAG_FIELDS,
            },
          },
        },
      },
    },
  });

  if (characters.length === 0) {
    console.log(`\nNo character's name contains "${fragment}".`);
    return;
  }

  for (const c of characters) {
    console.log(`\n=== ${c.name} — ${c.status} — ${c.id}`);
    console.log(`  discordUserId ${c.discordUserId ?? "none"} · role ${c.discordRoleId ?? "none"}`);
    console.log(`  ${c.zone?.name ?? "nowhere"} / ${c.location?.name ?? "nowhere"}`);

    console.log(`\n  Play from the web: ${c.webOnly}`);
    console.log(`    last flipped ${stamp(c.webOnlyChangedAt)}`);
    console.log(`    ${cooldownLine(c.webOnlyChangedAt)}`);
    if (c.webOnly && c.roomThreadRoomIds?.length) {
      // setWebOnly clears this column as it sheds the threads, so anything
      // left here is a flip whose Discord half did not finish. The channel
      // doctor's CHEAP pass — the one that runs on every bot start — does not
      // cover threads; only `npm run db:doctor -- --apply --full` does.
      console.log(`    STILL RECORDED IN ${c.roomThreadRoomIds.length} room thread(s): the flip's Discord half did not finish`);
    }

    const concealing = c.tags.filter((ct) => ct.tag.concealsIdentity || ct.tag.forcesConceal);
    const concealment = concealmentFrom(c.tags);
    const forcedName = forcedNameFrom(c.tags);
    const identity = presentedIdentity(c, { forcedName, concealment });

    console.log(`\n  Character.concealed (the wish): ${c.concealed}`);
    if (concealing.length === 0) {
      console.log("    holds nothing that conceals — so the wish cannot take effect, and");
      console.log("    /conceal and the switch on /character both refuse to set it");
    }
    for (const ct of concealing) {
      const flags = [
        ct.equipped ? "EQUIPPED" : "carried",
        ct.tag.forcesConceal ? "forces" : "optional",
        `layer ${ct.tag.equipLayer ?? "none"}`,
        ct.tag.concealSprite ? `sprite ${ct.tag.concealSprite}` : "NO SPRITE — conceals nobody",
      ];
      console.log(`    ${ct.tag.name} (${ct.tag.slug}) — ${flags.join(" · ")}`);
    }
    if (forcedName) {
      const row = c.tags.find((ct) => ct.tag.forcedName);
      console.log(`    forced name "${forcedName}" (${row?.tag.slug}), expires turn ${row?.expiresTurn ?? "never"}`);
      console.log("    a forced name beats a hood, and it is not concealment");
    }

    console.log(`\n  Resolved right now: ${identity.name}`);
    console.log(`    concealed ${identity.concealed} · forced ${identity.forced} · face ${identity.avatarPath}`);
    if (c.concealed && !identity.concealed) {
      console.log("    ^ THE WISH IS SET AND NOT IN EFFECT. This is what a player means by");
      console.log("      'my disguise does not work' — nothing concealing is equipped.");
    }

    const equipped = c.tags.filter((ct) => ct.equipped);
    const problem = findEquipProblem(equipped);
    console.log(`\n  Equipped: ${equipped.length} · ${handsUsed(equipped)}/${WEAPON_HANDS} hands`);
    if (problem) console.log(`    the slot rules would refuse this set: ${problem}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
