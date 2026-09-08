const { prisma } = require("@lifeweb/db");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");

// Renders one embed (an EmbedBuilder instance or a plain object) to
// readable text: title, description, then each field as "**name**: value".
function embedText(e) {
  const data = e?.data ?? e ?? {};
  const lines = [data.title, data.description];
  for (const f of data.fields ?? []) {
    if (f?.name || f?.value) lines.push(`**${f.name}**: ${f.value}`);
  }
  return lines.filter(Boolean).join("\n");
}

function contentOf(payload) {
  if (typeof payload === "string") return payload;
  const parts = [];
  if (payload?.content) parts.push(payload.content);
  if (payload?.embeds?.length) parts.push(payload.embeds.map(embedText).filter(Boolean).join("\n\n"));
  return parts.join("\n");
}

// Every DM the bot sends is logged so the GM message inbox has a full
// record without needing to also intercept every call site individually.
async function sendDm(user, payload, opts = {}) {
  const dm = await user.createDM();
  const sent = await dm.send(payload);
  await prisma.directMessage
    .create({
      data: {
        discordUserId: user.id,
        direction: "OUTBOUND",
        content: contentOf(payload),
        authorDiscordUserId: opts.authorDiscordUserId ?? null,
        source: opts.source ?? "bot_auto",
        // NOTICE unless the caller says otherwise (db/lib/dmKinds.js): a DM
        // nobody classified is the game talking, not a person. An embed is
        // read off the payload the same way `meta` below is, so the three
        // reaction handlers that send one need no opts at all — an inspect
        // readout is plumbing, and plumbing is QUIET.
        kind: opts.kind ?? (payload?.embeds?.length ? DM_KIND.QUIET : DM_KIND.NOTICE),
        discordMessageId: sent?.id ?? null,
        meta: opts.meta ?? (payload?.embeds?.length ? { embed: true } : undefined),
      },
    })
    .catch(() => {});
  return { dm, sent };
}

module.exports = { sendDm };
