"use client";

import GmAside from "./GmAside";
import NextGmAside from "./next/GmAside";
import GmSystemComposer from "./GmSystemComposer";
import DecreeDialog from "./DecreeDialog";
import GmNoticeCards from "./GmNoticeCards";
import GmSpeakerPanel from "./GmSpeakerPanel";
import { GmToolsContext } from "./gmTools";

// The only file that imports Chat's GM components (./gmTools.js says why).
// ./layout.js renders it for GMs alone. The layout is its own bundle, apart
// from the page's, so this file and everything under it reach the browser
// only when the server has drawn it.
const TOOLS = { GmAside, NextGmAside, GmSystemComposer, DecreeDialog, GmNoticeCards, GmSpeakerPanel };

export default function GmToolsProvider({ children }) {
  return <GmToolsContext.Provider value={TOOLS}>{children}</GmToolsContext.Provider>;
}
