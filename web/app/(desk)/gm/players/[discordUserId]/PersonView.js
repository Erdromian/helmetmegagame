"use client";

import PageShell, { PageHeader } from "@/app/components/PageShell";
import PersonShell from "./PersonShell";

// What the page draws, from the one object page.js#FreshPlayerDeskPerson produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <PersonShell> always took.
export default function PersonView(props) {
  // Keying on the conversation makes a navigation between people a remount,
  // which is what resets the pane's local page/claim state.
  return <PersonShell key={props.discordUserId} {...props} />;
}
