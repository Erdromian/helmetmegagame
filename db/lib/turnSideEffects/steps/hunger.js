const { sendDm } = require("../../dm");
const { hungerDm, DYING_DM } = require("../../hunger");

// One DM per character per close: becoming Hungry or Starving, and eating
// Foodstuffs to stay out of Starving, ride in the same message.
async function sendHungerNotices({ prisma, p, eachDm }) {
  await eachDm("hunger", p.hungerNotices, async (notice) => {
    const text = hungerDm(notice);
    if (text) {
      await sendDm(prisma, notice.discordUserId, text).catch((err) =>
        console.error(`Hunger DM to ${notice.discordUserId} failed:`, err),
      );
    }
    if (notice.justDied) {
      await sendDm(prisma, notice.discordUserId, DYING_DM).catch((err) =>
        console.error(`Dying DM to ${notice.discordUserId} failed:`, err),
      );
    }
  });
}

module.exports = { sendHungerNotices };
