"use client";

// A synopsis, rendered. See docs/systemdocs/ORACLE.md.
//
// The third renderer built on MESSAGE_PLUGINS, after MarkdownContent (a DM) and
// DocumentMarkdown (a document). Same plugins, same Discord vocabulary, its own
// `richtoken` component — which is the established way to say "this surface
// speaks the short token vocabulary, and means something different by one of
// them".
//
// The difference here is `{char:…}`. In a DM it draws a face and a name; on
// this desk it has to be a CONTROL, because clicking a name is how a GM pulls
// somebody into the inspector beside the prose. So it renders a button, and
// the click goes to a callback from context rather than a prop — react-markdown
// gives a component no way to thread props down to a nested renderer.

import { createContext, useContext, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { MESSAGE_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "@/app/components/markdownPlugins";
import { splitCharPayload } from "@/app/components/messageTokens";
import InfoIcon from "@/app/components/InfoIcon";

const InspectContext = createContext(null);

function CharButton({ payload }) {
  const onInspect = useContext(InspectContext);
  const { id, frozenName } = splitCharPayload(payload);

  // The name comes off the TOKEN, frozen at write time. Same rule the chat
  // mention follows: a later rename must not rewrite what a past turn's record
  // said somebody was called.
  const name = frozenName ?? id;

  // No callback (or no id) means no control. A name still reads as a name —
  // failing to a plain word is the whole reason db/lib/oracleInput.js resolves
  // these server-side and drops the braces off a name nobody answers to.
  if (!onInspect || !id) return <span>{name}</span>;

  return (
    <button type="button" className="oracle-name" onClick={() => onInspect(id, name, "Moves")}>
      {name}
    </button>
  );
}

function OracleToken({ kind, payload, raw }) {
  if (kind === "char") return <CharButton payload={payload} />;
  if (kind === "info") return <InfoIcon text={payload.trim()} />;
  // Anything else is left as written. A synopsis may name a person; it has no
  // business minting a catalog chip.
  return raw;
}

const COMPONENTS = { richtoken: OracleToken, ...DISCORD_COMPONENTS };

export default function OracleMarkdown({ text, onInspect, className }) {
  // Memoised so the whole tree does not re-render every time the parent's
  // state moves — a synopsis is a few hundred words of markdown and the desk
  // re-renders on every inspector click.
  const value = useMemo(() => onInspect ?? null, [onInspect]);
  if (!text) return null;

  return (
    <InspectContext.Provider value={value}>
      <div className={className}>
        <ReactMarkdown remarkPlugins={MESSAGE_PLUGINS} components={COMPONENTS}>
          {escapeTokenBars(text)}
        </ReactMarkdown>
      </div>
    </InspectContext.Provider>
  );
}
