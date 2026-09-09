const { PermissionFlagsBits } = require("discord.js");

// Can this player speak as their character in THIS channel right now?
//
// Derived, never hardcoded: the answer is whatever Discord says about the
// member's permissions, which reuses the narrowcast overwrites directly rather
// than keeping a second copy of the access rules.
//
// A CHANNEL needs SendMessages; a THREAD needs SendMessagesInThreads — a
// different bit, and conflating them is a bug. A standing character holds
// SendMessagesInThreads and deliberately NOT SendMessages on the Location
// channel they are in (db/lib/zoneChannelSpec.js#LOCATION_MEMBER_ALLOW),
// because the street is scenery and talk belongs in its Room threads.
//
// This file used to also ENUMERATE every place a player could speak, for the
// 🔊 Speak button's destination picker. That picker could never list a Room
// thread or a Conversation — it reached threads only through their parent
// Location channel, which stopped being a designated tupper channel when Send
// came off the street (bot/src/lib/channels.js#isDesignatedTupperChannel), so
// the branch that collected them was unreachable and the THREADS group was
// always empty. Rather than repair a list nobody could use, the button is gone
// and /message is the whole feature: run it in the room you want to speak in
// and it opens the modal there, so there is nothing to enumerate.

function canSpeakInChannel(channel, member) {
  const perms = channel.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
}

function canSpeakInThread(thread, member) {
  const perms = thread.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessagesInThreads);
}

// The one predicate every caller uses — it picks the right permission by what
// it was handed, so nothing can apply the channel rule to a thread. Both
// /message (before opening the modal) and the modal's own submit handler go
// through it, the second time because a server action is a public endpoint and
// the first check was only a courtesy.
function canSpeakInTarget(target, member) {
  if (!target || !member) return false;
  return target.isThread() ? canSpeakInThread(target, member) : canSpeakInChannel(target, member);
}

module.exports = { canSpeakInTarget };
