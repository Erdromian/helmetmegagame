// The extensions are spelled out, unlike every other import here, so plain node
// can load this file: db/test/chatFormatting.test.js runs the two passes with
// no bundler and no build step.
import wrapRuns from "./chatRuns.js";
import wrapSpeech from "./speechRuns.js";

// The two things a chat line does that a document never does, as one remark plugin alongside remark-gfm,
// remarkTokens and remarkDiscord in ChatMarkdown.js — `||like this||` a spoiler, `"like this"` quoted speech
// (tinted with --speech, since the words somebody SAID are what a reader scans a wall of narration for).
// BOTH PASSES SEE PAST ONE TEXT NODE, so `he said "*get out*"` still tints — chatRuns.js says why.

// Speech is found by db/lib/speech.js, the rule the server hears by, over the whole line read as text
// (speechRuns.js). A quote runs over line breaks and blank lines, holds any formatting, and has no length cap.

// Discord's own delimiter. Double pipes, nothing empty inside, and the bars
// themselves are not part of what is hidden.
const SPOILER = {
  open: /\|\|/,
  close: /\|\|/,
  forbidden: /[|\n]/,
  build: (children) => element("chatspoiler", "chat-spoiler", children),
};

function element(hName, className, children) {
  return {
    type: "chatSpan",
    data: { hName, hProperties: { className } },
    children,
  };
}

export default function remarkChat() {
  return (tree) => {
    // Spoilers before speech, so a quote inside a hidden line is still a quote once revealed.
    wrapRuns(tree, SPOILER);
    wrapSpeech(tree, (children) => element("span", "speech", children));
  };
}
