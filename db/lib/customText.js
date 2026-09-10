// Player- and GM-authored text, defanged. Three removals, each closing a real
// hole: `{` `}` so a description can never form a rich token ({tag:…} and
// {resource:…} render as REAL chips via richTokens.js — nobody at a keyboard
// must be able to forge one); `@` because authored names travel into Discord
// messages that default to parsing mentions; and control characters.
//
// This lived in web/lib/customCraft.js, which is where the custom-craft dialog
// wants it. It moved down here when the bot grew a surface that takes free text
// too — the GM's noticeboard modal — because bot/ cannot reach into web/, and
// two copies of an @everyone filter is exactly the shape of bug this function
// exists to prevent. customCraft.js re-exports it, so every caller it already
// had is untouched.
//
// ZERO DEPENDENCIES, and it must stay that way. Client components import this
// through customCraft.js; anything required here would be dragged into the
// browser bundle, and a `node:` builtin arriving that way kills the route with
// no digest to trace it by.

function cleanCustomText(raw, max) {
  if (typeof raw !== "string") return "";
  const printable = [...raw]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || code === 127) return " ";
      return "{}@".includes(ch) ? " " : ch;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

module.exports = { cleanCustomText };
