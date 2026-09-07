// The channel every DirectMessage insert announces itself on.
//
// Unlike bascinet_feed (feedNotify.js) nothing in code sends this one: a
// Postgres trigger does (db/prisma/migrations/20260913060000_dm_notify), so
// no writer — the three sendDm twins, the bot's inbound logger, the Hall's own
// composer, or the next one somebody adds — can forget to. The payload is
// `{ id, discordUserId }` and nothing else; the listener re-reads the row and
// applies the desk's own noise filter before it tells anybody
// (web/lib/feedHub.js, docs/systemdocs/HALL.md §2b).
const DM_CHANNEL = "bascinet_dm";

module.exports = { DM_CHANNEL };
