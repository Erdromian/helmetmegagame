import AppHeader from "@/app/components/AppHeader";

// Chat owns its whole screen, the way the (desk) workspaces do: no PageShell,
// no centred max-width, a 100dvh column whose regions scroll inside it. A chat
// that scrolled the document would drag the header off the top every time
// somebody spoke.
//
// The header itself is the shared one now — the same AppHeader every other
// page draws, which is where the turn chip this layout used to assemble by
// hand has moved to (components/TurnMeta.js). What is left here is the shell.
export default function PlayLayout({ children }) {
  return (
    <div className="chat-shell">
      <AppHeader title="Chat" />
      {children}
    </div>
  );
}
