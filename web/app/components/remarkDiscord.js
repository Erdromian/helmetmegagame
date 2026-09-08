import { findAndReplace } from "mdast-util-find-and-replace";
import { reFor } from "@lifeweb/db/lib/discordMarkup";

// Discord's angle-bracket vocabulary, turned into elements in the same mdast
// tree everything else renders from — the node.data.hName/hProperties
// convention remarkTokens.js and remarkChat.js already use. Being in the one
// tree is the point: a <t:…> inside a quoted line stays inside the quote, and
// a mention inside a spoiler is still hidden.
//
// Every pattern comes from db/lib/discordMarkup.js and none is spelled out
// here, so the guard in db/test/discordMarkup.test.js and this renderer can
// never drift apart about what a token looks like.
//
// Why this exists at all: text written for Discord gets STORED — a DM row, a
// proxied line — and then read on the web, where `<t:1757700120:F>` is just
// characters. See the header of db/lib/discordMarkup.js.

const text = (value) => ({ type: "text", value });

function node(hName, hProperties, children = []) {
  return { type: "discordNode", data: { hName, hProperties }, children };
}

// Sequential calls rather than one array of pairs: remarkChat.js does the
// same, it is the form this repo has actually exercised, and the behaviour is
// identical. `ignore` matches remarkChat's too — inside code the whole point
// of the text is that it is literal.
const IGNORE = { ignore: ["code", "inlineCode"] };

export default function remarkDiscord() {
  return (tree) => {
    // Properties are strings because that is what survives the trip through
    // hast. `format`, not `style` — React owns `style`.
    findAndReplace(
      tree,
      [reFor("timestamp"), (_raw, epoch, style) => node("discordtime", { epoch, format: style ?? "" })],
      IGNORE,
    );

    // Roles before users: they cannot overlap, but the order removes the
    // question. Both, and channels, resolve to a neutral word — see
    // DiscordMarkupNodes.js for why nothing prints an id.
    for (const kind of ["role", "user"]) {
      findAndReplace(tree, [reFor(kind), () => node("discordmention", {}, [text("someone")])], IGNORE);
    }
    findAndReplace(tree, [reFor("channel"), () => node("discordmention", {}, [text("somewhere")])], IGNORE);

    findAndReplace(
      tree,
      [reFor("emoji"), (_raw, _animated, name) => node("discordemoji", {}, [text(`:${name}:`)])],
      IGNORE,
    );

    findAndReplace(tree, [reFor("ping"), (raw) => node("discordping", {}, [text(raw)])], IGNORE);
  };
}
