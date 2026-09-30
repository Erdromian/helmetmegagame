// THE ONE RULE EVERY localStorage-BACKED STORE HAS TO KEEP: a browser that refuses site
// data may cost the REMEMBERING, and nothing else. The switch still moves, this page load.
//
// It has been broken four times, in four files, from one copy-paste lineage. The shape is
// always the same: keep the state only in localStorage, swallow the refused setItem, and
// the next getSnapshot() hands back the UNCHANGED stored value — so useSyncExternalStore
// sees no change, skips the render, and the control sits there looking dead. The :active
// bevel still flips, so the click looks like it landed, and nothing reaches the console.
// foldStore.js was fixed on its own in 7773596b; the other three kept the bug until the
// sound switches were reported.
//
// So the assertion that matters below is `snapshot !== before` — identity, not equality.
// That is the exact thing useSyncExternalStore compares, and the exact thing the bug broke.
// Asserting only "the value reads back right" would pass on the broken code for the three
// stores that still fired their listeners.
//
// react is stubbed rather than rendered: these are stores, not components, and the store
// contract IS (subscribe, getSnapshot) — so the stub just captures the pair the hook hands
// over and the test drives them directly. Each case imports its store with a fresh query
// string, because the state under test is module scope and would otherwise leak between
// cases.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

const REACT_STUB = `data:text/javascript,${encodeURIComponent(`
  export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
    globalThis.__reactCalls.push({ subscribe, getSnapshot, getServerSnapshot });
    return getSnapshot();
  }
  export function useCallback(fn) { return fn; }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return { url: REACT_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// `writable: false` is the reported failure — Firefox with site data blocked answers reads
// and throws on every write. `readable: false` is the harsher one a private window can give,
// where touching the store at all throws.
//
// `quota` is the third way, and the one players actually hit: a store that works until it is
// full, counted the way browsers count it (key plus value, in characters), then refuses any
// write that would grow it with a QuotaExceededError.
function makeStorage({ writable = true, readable = true, quota = Infinity } = {}) {
  const data = new Map();
  const deny = () => {
    throw new Error("The operation is insecure.");
  };
  const used = () => {
    let total = 0;
    for (const [key, value] of data) total += key.length + value.length;
    return total;
  };
  return {
    data,
    api: {
      get length() {
        if (!readable) deny();
        return data.size;
      },
      key(i) {
        if (!readable) deny();
        return [...data.keys()][i] ?? null;
      },
      getItem(key) {
        if (!readable) deny();
        return data.has(key) ? data.get(key) : null;
      },
      setItem(key, value) {
        if (!writable) deny();
        const next = String(value);
        const before = data.has(key) ? key.length + data.get(key).length : 0;
        const after = key.length + next.length;
        if (after > before && used() - before + after > quota) {
          const err = new Error("The quota has been exceeded.");
          err.name = "QuotaExceededError";
          throw err;
        }
        data.set(key, next);
      },
      removeItem(key) {
        if (!writable) deny();
        data.delete(key);
      },
    },
  };
}

let salt = 0;

async function loadStore(path, storage) {
  globalThis.window = {
    localStorage: storage.api,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.__reactCalls = [];
  salt += 1;
  return import(`${pathToFileURL(resolvePath(WEB_ROOT, path)).href}?fresh=${salt}`);
}

// Subscribe the way React would, so `subscribe`'s own cache invalidation is exercised.
function attach() {
  const { subscribe, getSnapshot } = globalThis.__reactCalls.at(-1);
  let notified = 0;
  subscribe(() => {
    notified += 1;
  });
  return { getSnapshot, notified: () => notified };
}

const CASES = [
  {
    name: "soundStore, the music switch",
    path: "app/components/soundStore.js",
    mount: (m) => m.useSound(),
    act: (m) => m.setMusicOn(false),
    value: (m) => m.soundSetting().music,
    before: true,
    after: false,
  },
  {
    name: "asideTabStore, the chat aside tab",
    path: "app/(app)/chat/asideTabStore.js",
    mount: (m) => m.useAsideTab(["here", "who"], "here"),
    act: (m) => m.useAsideTab(["here", "who"], "here")[1]("who"),
    value: (m) => m.useAsideTab(["here", "who"], "here")[0],
    before: "here",
    after: "who",
  },
  {
    name: "foldStore, a folded places section",
    path: "app/(app)/chat/next/foldStore.js",
    mount: (m) => m.useFolds(),
    act: (m) => m.useFolds()[1]("zone:town", null),
    value: (m) => m.useFolds()[0].has("zone:town"),
    before: false,
    after: true,
  },
  {
    name: "thingsOpenStore, chat's Things section",
    path: "app/(app)/chat/thingsOpenStore.js",
    mount: (m) => m.useThingsOpen(),
    act: (m) => m.useThingsOpen()[1](),
    value: (m) => m.useThingsOpen()[0],
    before: true,
    after: false,
  },
  {
    name: "asideFoldStore, a shut right-column block",
    path: "app/(app)/chat/next/asideFoldStore.js",
    mount: (m) => m.useAsideFolds(),
    act: (m) => m.useAsideFolds()[1]("here"),
    value: (m) => m.useAsideFolds()[0].has("here"),
    before: false,
    after: true,
  },
  {
    name: "seenStore, a read mark",
    path: "app/(app)/chat/seenStore.js",
    mount: (m) => m.useSeen(),
    act: (m) => m.markSeen("room:1", "50"),
    value: (m) => m.peekSeen("room:1"),
    before: null,
    after: "50",
  },
  {
    name: "notifiedStore, a notified count",
    path: "app/(app)/chat/notifiedStore.js",
    mount: (m) => m.useNotified(),
    act: (m) => m.noteNotified("room:1"),
    value: (m) => m.useNotified().get("room:1") ?? 0,
    before: 0,
    after: 1,
  },
];

for (const item of CASES) {
  test(`${item.name}: a refused write still moves the snapshot`, async () => {
    const storage = makeStorage({ writable: false });
    const store = await loadStore(item.path, storage);

    item.mount(store);
    const { getSnapshot, notified } = attach();
    assert.deepEqual(item.value(store), item.before, "starts at the default");

    const before = getSnapshot();
    item.act(store);

    assert.ok(notified() >= 1, "subscribers were told");
    assert.notEqual(getSnapshot(), before, "the snapshot CHANGED — this is the bug's ground zero");
    assert.deepEqual(item.value(store), item.after, "and it reads back as the new value");
    assert.equal(storage.data.size, 0, "nothing was persisted, which is the part we accept losing");
  });

  test(`${item.name}: an unreadable store does not throw`, async () => {
    const storage = makeStorage({ writable: false, readable: false });
    const store = await loadStore(item.path, storage);

    item.mount(store);
    const { getSnapshot } = attach();
    const before = getSnapshot();
    item.act(store);

    assert.notEqual(getSnapshot(), before);
    assert.deepEqual(item.value(store), item.after);
  });

  test(`${item.name}: a working store still persists`, async () => {
    const storage = makeStorage();
    const store = await loadStore(item.path, storage);

    item.mount(store);
    const { getSnapshot, notified } = attach();

    const before = getSnapshot();
    item.act(store);

    assert.ok(notified() >= 1);
    assert.notEqual(getSnapshot(), before);
    assert.deepEqual(item.value(store), item.after);
    assert.ok(storage.data.size > 0, "it reached localStorage");

    // A second browser session reading the same store must see the choice.
    const reopened = await loadStore(item.path, storage);
    item.mount(reopened);
    assert.deepEqual(item.value(reopened), item.after, "and survives a reload");
  });

  // The reported bug: page snapshots had filled localStorage, so the setting lived only in
  // memory and a reload brought back the old one.
  test(`${item.name}: a storage full of cached pages makes room and still persists`, async () => {
    const storage = makeStorage({ quota: 2000 });
    storage.data.set("bascinet:snap:2:u1:play", "x".repeat(1970));
    storage.data.set("bascinet:snap:index", "{}");
    const store = await loadStore(item.path, storage);

    item.mount(store);
    attach();
    item.act(store);

    assert.deepEqual(item.value(store), item.after);
    assert.ok(
      [...storage.data.keys()].every((key) => !key.startsWith("bascinet:snap:")),
      "the cached page went",
    );
    assert.ok(storage.data.size > 0, "and the setting took its place");

    const reopened = await loadStore(item.path, storage);
    item.mount(reopened);
    assert.deepEqual(item.value(reopened), item.after, "so it survives a reload");
  });
}

// The rules that are specific to one store, and that the loop above cannot see.

test("seenStore: a mark only ever moves forward, and says nothing when it does not move", async () => {
  const storage = makeStorage({ writable: false });
  const store = await loadStore("app/(app)/chat/seenStore.js", storage);

  store.useSeen();
  const { getSnapshot, notified } = attach();

  store.markSeen("room:1", "50");
  const atFifty = getSnapshot();
  const after = notified();

  // "9" sorts after "10" as a string, so this also pins the BigInt comparison.
  store.markSeen("room:1", "9");
  assert.equal(store.peekSeen("room:1"), "50", "a stale write must not re-mark a room unread");
  assert.equal(getSnapshot(), atFifty, "and must not churn the snapshot");
  assert.equal(notified(), after, "nor wake every subscriber");
});

test("seenStore: markAllSeen notifies once for the whole sweep", async () => {
  const storage = makeStorage({ writable: false });
  const store = await loadStore("app/(app)/chat/seenStore.js", storage);

  store.useSeen();
  const { notified } = attach();

  store.markAllSeen([
    { placeKey: "room:1", seq: "5" },
    { placeKey: "room:2", seq: "6" },
    { placeKey: "room:3", seq: "7" },
  ]);

  assert.equal(notified(), 1, "one notify, not one per place");
  assert.equal(store.peekSeen("room:2"), "6");
});

test("notifiedStore: counts accumulate to the cap, and clearing empties them", async () => {
  const storage = makeStorage({ writable: false });
  const store = await loadStore("app/(app)/chat/notifiedStore.js", storage);

  store.useNotified();
  attach();

  for (let i = 0; i < store.NOTIFIED_CAP + 5; i += 1) store.noteNotified("room:1");
  assert.equal(store.useNotified().get("room:1"), store.NOTIFIED_CAP, "capped, the way Discord caps it");

  store.noteNotified("room:2");
  store.clearNotified("room:1");
  assert.equal(store.useNotified().get("room:1"), undefined, "the place that was read is gone");
  assert.equal(store.useNotified().get("room:2"), 1, "and the one that was not is untouched");

  store.clearAllNotified();
  assert.equal(store.useNotified().size, 0, "the tick in the column's foot clears the rest");
});

// The page snapshots (lib/snapshot/snapshotStore.js) are what filled storage in the first place.

const SNAPSHOTS = "lib/snapshot/snapshotStore.js";
const big = (n) => ({ body: "x".repeat(n) });

test("snapshotStore: the oldest snapshots go once the budget is spent", async () => {
  const storage = makeStorage();
  const store = await loadStore(SNAPSHOTS, storage);

  store.writeSnapshot("gm-audit:1", "u1", big(1_000_000));
  store.writeSnapshot("gm-audit:2", "u1", big(1_000_000));
  store.writeSnapshot("gm-audit:3", "u1", big(1_000_000));

  assert.equal(storage.data.has("bascinet:snap:2:u1:gm-audit:1"), false, "the oldest went");
  assert.equal(storage.data.has("bascinet:snap:2:u1:gm-audit:2"), true);
  assert.equal(storage.data.has("bascinet:snap:2:u1:gm-audit:3"), true);
  assert.deepEqual(
    Object.keys(JSON.parse(storage.data.get("bascinet:snap:index"))).sort(),
    ["bascinet:snap:2:u1:gm-audit:2", "bascinet:snap:2:u1:gm-audit:3"],
    "and the index says what is left",
  );
  assert.deepEqual(store.peekSnapshot("gm-audit:1", "u1"), big(1_000_000), "this tab still has it in memory");
});

test("snapshotStore: rewriting one scope does not count its old copy against it", async () => {
  const storage = makeStorage();
  const store = await loadStore(SNAPSHOTS, storage);

  store.writeSnapshot("chat", "u1", big(1_200_000));
  store.writeSnapshot("character", "u1", big(1_200_000));
  store.writeSnapshot("chat", "u1", big(1_200_000));

  assert.equal(storage.data.has("bascinet:snap:2:u1:chat"), true);
  assert.equal(storage.data.has("bascinet:snap:2:u1:character"), true, "both fit, so neither went");
});

test("snapshotStore: keys an older version left behind are swept on the next write", async () => {
  const storage = makeStorage();
  storage.data.set("bascinet:snap:1:u1:play", "{}");
  storage.data.set("bascinet:snap:2:u1:unindexed", "{}");
  storage.data.set("hall:seen:room:1", "50");
  const store = await loadStore(SNAPSHOTS, storage);

  store.writeSnapshot("play", "u1", { a: 1 });

  assert.equal(storage.data.has("bascinet:snap:1:u1:play"), false, "the old version went");
  assert.equal(storage.data.has("bascinet:snap:2:u1:unindexed"), false, "so did a key nothing indexed");
  assert.equal(storage.data.get("hall:seen:room:1"), "50", "a read mark is not a snapshot");
  assert.equal(storage.data.get("bascinet:snap:2:u1:play"), '{"a":1}');
});

test("snapshotStore: a storage full of other things drops the other snapshots before giving up", async () => {
  const storage = makeStorage({ quota: 3000 });
  const store = await loadStore(SNAPSHOTS, storage);

  store.writeSnapshot("character", "u1", big(1000));
  storage.data.set("hall:seen:room:1", "y".repeat(1400));
  store.writeSnapshot("play", "u1", big(1000));

  assert.equal(storage.data.has("bascinet:snap:2:u1:character"), false);
  assert.ok(storage.data.get("bascinet:snap:2:u1:play"), "the new page was stored");
  assert.equal(storage.data.get("hall:seen:room:1").length, 1400, "and nothing else was touched");
});
