// Outbound DirectMessage sources that are bot/system-generated, canned text
// about something that happened — not a GM typing to a player. Kept separate
// from web/lib/dmThread.js so DmThread.js (a client component) can import
// this list without dragging @lifeweb/db's Prisma import into the bundle.
//
// staged_push is deliberately excluded: it's GM-authored turn-result prose,
// just delivered in bulk rather than typed live — see DmThread.js's comment
// on why it never collapses.
export const AUTOMATED_EFFECT_SOURCES = ["bot_auto", "player_event", "gm_dev", "move_unlock"];

// A mention relay — "You were mentioned in X" (bot/src/lib/mentions.js,
// bot/src/lib/feedOutbox.js#relayWebMentions). Its own source rather than
// system_notice because the two chairs disagree about it: the GM desk hides
// it (it is not conversation), the player's Chat pane shows it (a ping is
// about you, and on Discord the DM is right there). The row's meta carries
// { placeKey, where } so the pane can open the place it happened in.
export const MENTION_SOURCE = "mention";
