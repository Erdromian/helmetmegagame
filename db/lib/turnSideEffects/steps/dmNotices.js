const { sendDm } = require("../../dm");
const { plainDm } = require("../shared");

async function sendEarlyDmNotices({ prisma, p, eachDm }) {
  await eachDm("lesson", p.lessonDms, (dm) => plainDm(prisma, dm, "Lesson"));
  await eachDm("confession", p.confessionDms, (dm) => plainDm(prisma, dm, "Confession"));
  await eachDm("healGambit", p.healGambitDms, (dm) => plainDm(prisma, dm, "Heal"));
  await eachDm("trinket", p.trinketDms, (dm) => plainDm(prisma, dm, "Trinket"));
  await eachDm("tagExpiry", p.tagExpiryDms, (dm) => plainDm(prisma, dm, "Tag progression"));
  // The cult learning the Rite of Ascension is in the Grimoire now
  // (db/lib/ascensionReveal.js). Early rather than late: the stamp that sent it
  // has already changed the document they are being told to go and read.
  await eachDm("ascensionReveal", p.ascensionRevealDms, (dm) => plainDm(prisma, dm, "Ascension reveal"));
}

async function sendLateDmNotices({ prisma, p, eachDm }) {
  await eachDm("routine", p.routineNotices, (notice) =>
    sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
      console.error(`Passed-Routine DM to ${notice.discordUserId} failed:`, err),
    ),
  );

  await eachDm("gambit", p.gambitRollNotices, (notice) =>
    sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
      console.error(`Gambit roll DM to ${notice.discordUserId} failed:`, err),
    ),
  );
}

module.exports = { sendEarlyDmNotices, sendLateDmNotices };
