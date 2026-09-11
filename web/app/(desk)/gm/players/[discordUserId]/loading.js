// A ROUTE boundary, which the desk had none of anywhere.
//
// Skeleton.js next door is handed to SnapshotPage as a prop, and that is a
// client fallback — it only ever paints once this segment's own RSC payload
// has arrived and React is rendering it. Between the click and that payload
// there was nothing at all: the router held the previous conversation on
// screen and the desk looked frozen for however long the person query took
// (a hundred DM rows and two Discord REST calls, on a pool shared with the
// inbox poll and every other GM).
//
// A loading.js gives the router something to commit to immediately, so the
// click always does something. Same skeleton, so the swap to the real thread
// doesn't reflow.
export { default } from "./Skeleton";
