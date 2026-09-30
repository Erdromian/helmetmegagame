// Every localStorage write that REMEMBERS something goes through here: read marks, the
// sound switches and slider, folds, pins, drafts. What it adds over a bare setItem is one
// rule — a remembered setting outranks a cached page.
//
// localStorage is about five million characters per site, and the page snapshots
// (./snapshot/snapshotStore.js) are the only thing here big enough to fill it: a whole
// page's props, up to 1.5 MB each. Once it was full every other write threw
// QuotaExceededError, the stores swallowed it (a refused write may cost only the
// remembering — ./__tests__/localStores.test.mjs), and a reload brought back whatever was
// stored before the storage filled. So the volume "reset", and every room lit unread,
// because the read marks had stopped saving hours earlier.
//
// The snapshots are a cache the next visit repaints from the server without, so on a
// refused write they all go and the write is tried once more. A second refusal is thrown
// on to the caller, which is a browser that blocks site data outright — the case every
// store here already survives in memory.

// The snapshot store's key prefix, every version. Here rather than there so the settings
// stores need nothing but this file (their node tests load them without React).
export const SNAPSHOT_PREFIX = "bascinet:snap:";

// Drops every stored snapshot, for this account and any other. The tab's in-memory copies
// are the snapshot store's own and stay put, so nothing on screen changes. Returns whether
// anything went, so a caller with nothing to free does not retry for nothing.
export function dropStoredSnapshots(store = window.localStorage) {
  const doomed = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(SNAPSHOT_PREFIX)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
  return doomed.length > 0;
}

/** localStorage.setItem, making room by dropping cached pages if storage is full. Throws if it still cannot write. */
export function saveLocal(key, value) {
  const store = window.localStorage;
  try {
    store.setItem(key, value);
  } catch (err) {
    let freed = false;
    try {
      freed = dropStoredSnapshots(store);
    } catch {
      // Unreadable too: nothing to free, and the original refusal is the one to report.
    }
    if (!freed) throw err;
    store.setItem(key, value);
  }
}
