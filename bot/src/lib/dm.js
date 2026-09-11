const { prisma } = require("@lifeweb/db");
const { dmLogRow } = require("@lifeweb/db/lib/dmPolicy");

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
  // db/lib/dmPolicy.js holds the kind/source defaults the other two
  // transports use. The embeds and `meta` are read off the PAYLOAD here rather
  // than off opts — this twin carries them there — so the three reaction
  // handlers that send one still need no opts at all: an inspect readout is
  // plumbing, and plumbing is QUIET.
  const hasEmbeds = Boolean(payload?.embeds?.length);
  await prisma.directMessage
    .create({
      data: {
        ...dmLogRow({
          discordUserId: user.id,
          // No `»` here: this transport's callers write their own where they
          // want one, and a payload may be an embed with no text at all.
          content: contentOf(payload),
          opts,
          discordMessageId: sent?.id ?? null,
          hasEmbeds,
        }),
        meta: opts.meta ?? (hasEmbeds ? { embed: true } : undefined),
      },
    })
    .catch(() => {});
  return { dm, sent };
}

module.exports = { sendDm };
