import { findAndReplace } from "mdast-util-find-and-replace";
import { TOKEN_SOURCE } from "./richTokens";

// A remark plugin: turns each {kind:payload} token (see richTokens.js) into
// a <richtoken kind payload raw> element in the hast tree that remark-rehype
// produces, via the node.data.hName/hProperties convention mdast-util-to-hast
// reads. DocumentMarkdown.js's `components` map then renders that tag as a
// live TagChip/ResourceChip — same as RichText does outside Markdown, but
// now a token also resolves correctly inside a table cell, a list item, etc.,
// since it's part of the same tree Markdown itself renders from.
//
// A token's payload holds no formatting: markdownPlugins.js escapes every
// Markdown-active character inside a `{…}` before any of this parses, so what
// arrives here is always one whole text node. See tokenEscape.js.
//
// `ignore` matches remarkChat's and remarkDiscord's, and it was the one pass
// without it: inside code the whole point of the text is that it is literal, so
// a `{tag:apex-form}` typed between backticks stays as typed.
export default function remarkTokens() {
  return (tree) => {
    findAndReplace(
      tree,
      [
        new RegExp(TOKEN_SOURCE, "g"),
        (raw, kind, payload) => ({
          type: "richToken",
          data: { hName: "richtoken", hProperties: { kind, payload, raw } },
        }),
      ],
      { ignore: ["code", "inlineCode"] },
    );
  };
}
