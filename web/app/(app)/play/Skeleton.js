// This is only ever rendered as layout.js's `{children}` — that layout
// already draws the `.chat-shell` wrapper and the one DeskHeader, both above
// where Suspense cuts in for this route's page.js. Drawing either one again
// here used to stack a second "Chat" header, and a second `.chat-shell`
// (height: 100dvh, a flex column) squeezed inside the real one's already-
// sized body slot, right up until the real page replaced it a moment later.
// All this needs to hold still is the same three-column body shape.
//
// The aside is deliberately absent. Chat.js renders it only `{aside && …}`,
// and a GM with no living character has none — drawing it unconditionally
// gave them a phantom third column that vanished on load.
export default function Loading() {
  return (
    <div className="chat-body" aria-hidden="true">
      <div className="chat-places" />
      <div className="chat-centre" />
    </div>
  );
}
