// The pure text-splitting half of the Discord REST layer, kept in its own
// dependency-free module so a "use client" component can import it.
//
// discordRest.js is server-only — it reads DISCORD_TOKEN, calls fetch, and
// holds the Cloudflare circuit-breaker state — so a composer that wants to
// tell a GM "this arrives as 3 messages" cannot import from there. This file
// has no requires at all, so `@lifeweb/db/lib/chunkText` resolves cleanly in
// the browser bundle. Import the deep path, never the @lifeweb/db barrel,
// which pulls in @prisma/client and node:fs (same reasoning as
// web/lib/formatTagRequirement.js).
//
// discordRest.js requires this file and re-exports chunkMessage, so every
// existing caller keeps its import path.

const DISCORD_MESSAGE_LIMIT = 2000;

// Splits text into as few ≤2000-char chunks as possible, preferring to
// break on paragraph boundaries (blank lines). A paragraph that alone exceeds
// the cap is broken on its LINES next — the Game Ended roster is a hundred
// lines with no blank line between them, and slicing that at exactly 2000
// cut through the middle of somebody's name. Only a single line longer than
// the cap is hard-split.
function chunkMessage(text) {
  const paragraphs = text.split("\n\n");
  const chunks = [];
  let current = "";

  // Adds one piece to the running chunk, or starts a new chunk with it.
  // `joiner` is what sits between this piece and what came before it.
  function push(piece, joiner) {
    const candidate = current ? `${current}${joiner}${piece}` : piece;
    if (candidate.length > DISCORD_MESSAGE_LIMIT) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length <= DISCORD_MESSAGE_LIMIT) {
      push(paragraph, "\n\n");
      continue;
    }
    const lines = paragraph.split("\n");
    lines.forEach((line, index) => {
      const joiner = index === 0 ? "\n\n" : "\n";
      if (line.length <= DISCORD_MESSAGE_LIMIT) {
        push(line, joiner);
        return;
      }
      for (let i = 0; i < line.length; i += DISCORD_MESSAGE_LIMIT) {
        push(line.slice(i, i + DISCORD_MESSAGE_LIMIT), i === 0 ? joiner : "\n");
      }
    });
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = { DISCORD_MESSAGE_LIMIT, chunkMessage };
