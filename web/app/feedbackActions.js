"use server";

import { prisma } from "@lifeweb/db";
import {
  FEEDBACK_COOLDOWN_MESSAGE,
  FEEDBACK_COOLDOWN_MS,
  MAX_FEEDBACK_LENGTH,
} from "@lifeweb/db/lib/feedbackLimits";
import { postFeedbackToDiscord } from "@lifeweb/db/lib/feedback";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { avatarUrlFor } from "@/lib/gmProfiles";

// The Feedback composer's one action (FeedbackButton.js). Open to anybody
// signed in and still in the guild — a spectator noticing a broken page is
// worth hearing from as much as a player is.
//
// It returns {error} rather than throwing, because every refusal here is a
// sentence the composer shows in its own error line, the cooldown included.
export async function submitFeedback(body) {
  const { session, inGuild } = await getGmSession();
  if (!session?.discordUserId || !inGuild) {
    return { error: "You are not signed in." };
  }
  const discordUserId = session.discordUserId;

  // A server action is a public endpoint, so everything the dialog already
  // checked is checked again here.
  const text = String(body ?? "").trim();
  if (!text) return { error: "Write something first." };
  if (text.length > MAX_FEEDBACK_LENGTH) {
    return { error: `Keep it under ${MAX_FEEDBACK_LENGTH} characters.` };
  }

  const newest = await prisma.feedback.findFirst({
    where: { discordUserId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (newest && Date.now() - newest.createdAt.getTime() < FEEDBACK_COOLDOWN_MS) {
    return { error: FEEDBACK_COOLDOWN_MESSAGE };
  }

  const [member, character] = await Promise.all([
    listGuildMembers()
      .then((members) => members.find((m) => m.id === discordUserId) ?? null)
      .catch(() => null),
    prisma.character.findFirst({
      where: { discordUserId, status: "ALIVE" },
      select: { name: true },
    }),
  ]);

  const username = member?.nick || member?.globalName || member?.username || "Someone";
  const guildId = process.env.DISCORD_GUILD_ID;
  const avatarUrl = member && guildId ? avatarUrlFor(guildId, member) : null;

  await prisma.feedback.create({
    data: {
      discordUserId,
      discordUsername: username,
      characterName: character?.name ?? null,
      body: text,
    },
  });

  // Best effort, and deliberately awaited so a slow Discord does not outlive
  // the request — postFeedbackToDiscord swallows its own failures.
  await postFeedbackToDiscord({
    username,
    avatarUrl,
    characterName: character?.name ?? null,
    body: text,
  });

  return { ok: true };
}
