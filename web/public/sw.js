// The service worker, and it does exactly one job: draw the notification a
// push carries and open the page it names. It caches nothing and intercepts no
// request — /play is a live feed, and a worker serving it out of a cache would
// be showing yesterday's scene.
//
// Registered from the Hall's push toggle (web/app/(app)/play/pushStore.js);
// sent from db/lib/webPush.js. See HALL.md §5a.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A payload that will not parse still deserves a notification: a silent
    // push is worse than a vague one.
    data = {};
  }
  const title = data.title || "Bascinet";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // Where the click goes. Read back in notificationclick below.
      data: { url: data.url || "/play" },
      // One tag, so a second notification replaces the first rather than
      // stacking a screenful of them while somebody is away from the page.
      tag: "bascinet",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/play";
  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // A tab already on this site is focused and pointed at the place,
      // rather than opening a second copy of the Hall beside it.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
