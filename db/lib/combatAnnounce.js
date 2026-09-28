// A fight's announcement (docs/systemdocs/ATTACK.md §1): "Ada attacks Bo and Cy!", told to everybody standing
// there in the names THEY know the fighters by. A stranger's face is what it looks like to somebody who has
// never met them, and a hood is its alias to everybody — the intercept.js#seenBy rule, for a line the whole
// place hears. So there is no one line to post:
//
//   - ON THE WEB the place gets ONE row. Its `content` has every bare face as its alias, for anything that
//     reads the row without a reader in mind, and it carries the fighters on `subjects`, which the feed lens
//     renders for each reader (db/lib/strangers.js#lensRow).
//   - ON DISCORD a channel post has one text for everybody, so nothing is posted there. The line is relayed
//     to each Discord player standing there as a DM, rendered for them. The fighters themselves are left
//     out: they already have their own, fuller DMs.
//
// Takes `prisma`, off the @lifeweb/db barrel (db/lib/dm.js convention). Best-effort: a fight has already
// started by the time this runs, and a missed announcement must never undo it.
const { sceneLineAt } = require("./scene");
const { renderPeopleLine, peopleIds, disguiseNames } = require("./peopleLine");
const { knownSubjects } = require("./strangers");
const { readDisguises, disguiseRead } = require("./disguises");
const { DM_KIND } = require("./dmKinds");

// `announce` is combat.js#startCombat's { locationId, subjects }; `skipIds` the fighters.
async function announceFight(prisma, announce, { skipIds = [] } = {}) {
  if (!announce?.locationId || !announce.subjects) return { archived: false, relayed: 0 };
  const { locationId, subjects } = announce;

  const archived = Boolean(
    await sceneLineAt(prisma, { locationId, text: renderPeopleLine(subjects), subjects }).catch((err) => {
      console.error("Fight announcement: archive row failed:", err.message ?? err);
      return null;
    }),
  );

  let relayed = 0;
  if (process.env.DISCORD_TOKEN) {
    const { sendDm } = require("./dm");
    const location = await prisma.location.findUnique({ where: { id: locationId }, select: { name: true } });
    const readers = await prisma.character.findMany({
      where: {
        locationId,
        status: "ALIVE",
        discordMirrored: true,
        id: { notIn: skipIds.filter(Boolean) },
      },
      select: { id: true, discordUserId: true },
    });
    const named = peopleIds(subjects);
    const worn = disguiseNames(subjects);
    for (const reader of readers.filter((r) => r.discordUserId)) {
      const known = await knownSubjects(prisma, reader.id, named).catch(() => null);
      const reads = worn.length > 0 ? await readDisguises(prisma, reader.id, worn).catch(() => null) : null;
      const text = renderPeopleLine(subjects, {
        viewerId: reader.id,
        knows: (id) => !known || known.has(id),
        knowsName: (name) => disguiseRead(reads, name).known,
      });
      const where = location?.name ? `\n-# ${location.name}` : "";
      await sendDm(prisma, reader.discordUserId, `${text}${where}`, { kind: DM_KIND.NOTICE, allowedMentions: { parse: [] } })
        .then(() => (relayed += 1))
        .catch((err) => console.error(`Fight announcement: DM to ${reader.discordUserId} failed:`, err.message ?? err));
    }
  }
  return { archived, relayed };
}

module.exports = { announceFight };
