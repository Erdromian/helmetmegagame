// syncZones Bodies: the text bodies for a Room's starter post and a Location's pinned anchor.
const { liveLine } = require("../roomLive");

function italicParagraphs(text) {
  // Italic markup doesn't survive a blank line, so each paragraph wraps on its own.
  return (text || "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `*${paragraph.trim()}*`)
    .join("\n\n");
}

// The live line joins the description's LAST paragraph with a pipe rather than standing on its own — it is a fact about the room, not a second post stapled under it.
function buildRoomBody(room, liveState) {
  const parts = [`**${room.name}**`];
  const description = italicParagraphs(room.description);
  const live = liveLine(room.live, liveState);
  if (description) parts.push(live ? `${description} | ${live}` : description);
  else if (live) parts.push(live);
  if (room.soundproof) parts.push("**Muffled**: shouts do not carry out of here.");
  // One newline, not two — a blank line between the bolded name and its `-#` subtext would read as two separate posts stapled together.
  return parts.join("\n");
}

// The pinned anchor: name, -# description, and the Public Rooms index. Private rooms are deliberately absent — that's what the Secret rooms? button is for.
function buildAnchorBody(location, rooms) {
  const parts = [`**${location.name}**`];
  const description = (location.description || "").trim();
  if (description) {
    parts.push(
      description
        .split(/\n{2,}/)
        .map((paragraph) => `-# ${paragraph.trim().replace(/\s*\n+\s*/g, " ")}`)
        .join("\n"),
    );
  }
  const links = publicRoomLinks(rooms);
  parts.push(`**Public Rooms**: ${links || "none"}`);
  return parts.join("\n");
}

// "<#t1> | <#t2>" — a Location's public Rooms as thread mentions, in their
// authored order. Empty when there are none.
function publicRoomLinks(rooms) {
  return rooms
    .filter((r) => r.kind === "PUBLIC" && r.discordThreadId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => `<#${r.discordThreadId}>`)
    .join(" | ");
}

// The line under a Discord traveller's "Moved to": the Location's channel and
// its public Rooms, as links. On a phone, finding a new channel or a thread you
// haven't joined in the sidebar is the slow part of arriving, and a tap on a
// mention goes straight there. Null when the Location has no channel.
function arrivalLinksLine(location, rooms) {
  if (!location?.discordChannelId) return null;
  const links = publicRoomLinks(rooms);
  return `-# <#${location.discordChannelId}>${links ? ` · Rooms: ${links}` : ""}`;
}

module.exports = {
  buildRoomBody,
  buildAnchorBody,
  publicRoomLinks,
  arrivalLinksLine,
};
