// Chat never opens on Bascinet's DM by itself (CHAT.md §5, openPlace.js). Players came back
// to the page on the DM and typed their scene's dialogue to Bascinet. A hash that names the
// DM still opens it; a bare /chat, a reload or a return from another page does not.
//
// react is stubbed the way localStores.test.mjs stubs it: the store contract IS
// (subscribe, getSnapshot), so the test drives the pair directly. Each case imports the
// store with a fresh query string, because its state is module scope.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const STORE = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/chat/openPlace.js");
const LAST_KEY = "bascinet:play:last-place";
const DM = "gm";

const REACT_STUB = `data:text/javascript,${encodeURIComponent(`
  export function useSyncExternalStore(subscribe, getSnapshot) {
    globalThis.__reactCalls.push({ subscribe, getSnapshot });
    return getSnapshot();
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return { url: REACT_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let salt = 0;

// One fresh page load: a browser with `stored` in localStorage, sitting on `hash`.
async function openPage({ stored = {}, hash = "", navigation = "navigate" } = {}) {
  const data = new Map(Object.entries(stored));
  const win = {
    location: { hash, pathname: "/chat", search: "" },
    performance: { getEntriesByType: () => [{ type: navigation }] },
    localStorage: {
      get length() {
        return data.size;
      },
      key: (i) => [...data.keys()][i] ?? null,
      getItem: (key) => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: (key) => data.delete(key),
    },
    history: {
      pushState(_state, _title, url) {
        win.location.hash = url.startsWith("#") ? url : "";
      },
      replaceState(_state, _title, url) {
        win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = win;
  globalThis.__reactCalls = [];
  salt += 1;
  const store = await import(`${pathToFileURL(STORE).href}?fresh=${salt}`);
  return { store, win, data };
}

// Chat mounting: render once, then subscribe the way React does.
function mount(store) {
  store.useOpenPlace();
  const { subscribe, getSnapshot } = globalThis.__reactCalls.at(-1);
  const unsubscribe = subscribe(() => {});
  return { getSnapshot, unmount: unsubscribe };
}

test("a bare /chat opens the remembered street", async () => {
  const { store } = await openPage({ stored: { [LAST_KEY]: "loc:abc" } });
  assert.equal(mount(store).getSnapshot(), "loc:abc");
});

test("opening the DM does not make it the remembered place", async () => {
  const { store, data } = await openPage({ stored: { [LAST_KEY]: "loc:abc" } });
  const chat = mount(store);
  store.setOpenPlace(DM);
  assert.equal(chat.getSnapshot(), DM, "the row still opens it");
  assert.equal(data.get(LAST_KEY), "loc:abc", "the street is still the one remembered");

  const reload = await openPage({ stored: Object.fromEntries(data) });
  assert.equal(mount(reload.store).getSnapshot(), "loc:abc", "and a reload opens the street");
});

test("a DM stored before this change is ignored", async () => {
  const { store } = await openPage({ stored: { [LAST_KEY]: DM } });
  assert.equal(mount(store).getSnapshot(), null, "nothing wanted, so Chat falls back to the first place");
});

test("leaving Chat on the DM and coming back by the rail opens the street", async () => {
  const { store, win } = await openPage({ stored: { [LAST_KEY]: "room:bar" } });
  const chat = mount(store);
  store.setOpenPlace(DM);
  chat.unmount();
  win.location.hash = ""; // the rail's link is a bare /chat

  assert.equal(mount(store).getSnapshot(), "room:bar");
});

test("a hash naming the DM still opens it", async () => {
  const fresh = await openPage({ stored: { [LAST_KEY]: "loc:abc" }, hash: "#gm" });
  const chat = mount(fresh.store);
  assert.equal(chat.getSnapshot(), DM, "a notification's /chat#gm, on a fresh load");

  // Back to /chat#gm after leaving Chat on the DM.
  chat.unmount();
  assert.equal(mount(fresh.store).getSnapshot(), DM, "Back to the DM's own entry");
});

test("a reload on /chat#gm opens the street and clears the hash", async () => {
  const { store, win } = await openPage({ stored: { [LAST_KEY]: "loc:abc" }, hash: "#gm", navigation: "reload" });
  const chat = mount(store);
  assert.equal(chat.getSnapshot(), "loc:abc", "a phone bringing back the tab does not land on the DM");
  assert.equal(win.location.hash, "", "and the address bar no longer says #gm");

  store.setOpenPlace(DM);
  assert.equal(chat.getSnapshot(), DM, "the row still opens it afterwards");
});

test("a reload on any other place keeps it", async () => {
  const { store, win } = await openPage({ hash: "#room%3Abar", navigation: "reload" });
  assert.equal(mount(store).getSnapshot(), "room:bar");
  assert.equal(win.location.hash, "#room%3Abar");
});

test("leaving Chat on any other place keeps it", async () => {
  const { store, win } = await openPage();
  const chat = mount(store);
  store.setOpenPlace("room:bar");
  chat.unmount();
  win.location.hash = "";
  assert.equal(mount(store).getSnapshot(), "room:bar");
});
