"use server";

import { prisma } from "@lifeweb/db";
import { submitFeedback as submitFeedbackVerb } from "@lifeweb/db/lib/verbs/place";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { avatarUrlFor } from "@/lib/gmProfiles";

// The Feedback composer's one action (FeedbackButton.js). Open to anybody
// signed in and still in the guild — a spectator noticing a broken page is
// worth hearing from as much as a player is. The rule, the rate limit and the
// post are db/lib/verbs/place.js#submitFeedback, shared with Discord's
// /feedback; this looks up the name and avatar the note is signed with.
//
// It returns {error} rather than throwing, because every refusal here is a
// sentence the composer shows in its own error line, the rate limit included.
export async function submitFeedback(body) {
  const { session, inGuild } = await getGmSession();
  if (!session?.discordUserId || !inGuild) {
    return { error: "You aren't signed in" };
  }
  const discordUserId = session.discordUserId;

  const member = await listGuildMembers()
    .then((members) => members.find((m) => m.id === discordUserId) ?? null)
    .catch(() => null);
  const username = member?.nick || member?.globalName || member?.username || "Someone";
  const guildId = process.env.DISCORD_GUILD_ID;
  const avatarUrl = member && guildId ? avatarUrlFor(guildId, member) : null;

  const result = await submitFeedbackVerb(prisma, { discordUserId, username, avatarUrl, body });
  if (!result.ok) return { error: result.error };
  return { ok: true };
}
