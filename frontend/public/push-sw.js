/* Only stores a device account preference. Never caches API, chat or credentials. */
const CACHE = "jobfind-push-settings-v1",
  OWNER = "/__jobfind_push_owner";
const owner = async () => {
  const cache = await caches.open(CACHE),
    value = await cache.match(OWNER);
  return value ? value.json() : null;
};
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
let writes = Promise.resolve();
self.addEventListener("message", (event) => {
  if (event.data?.type !== "push-owner") return;
  // Messages only accepted from same-origin window clients.
  if (
    !event.source?.url ||
    new URL(event.source.url).origin !== self.location.origin
  )
    return;
  writes = writes
    .catch(() => {})
    .then(async () => {
      const data = event.data,
        current = await owner();
      if (data.expectedOwner !== undefined && current !== data.expectedOwner) {
        event.ports[0]?.postMessage({ ok: true, changed: false });
        return;
      }
      if (
        data.ownerId !== null &&
        (!Number.isSafeInteger(data.ownerId) || data.ownerId <= 0)
      )
        throw new Error("Invalid owner");
      const cache = await caches.open(CACHE);
      await cache.put(OWNER, new Response(JSON.stringify(data.ownerId)));
      if (data.ownerId === null || current !== data.ownerId)
        for (const notification of await self.registration.getNotifications())
          notification.close();
      event.ports[0]?.postMessage({ ok: true, changed: true });
    })
    .catch(() => event.ports[0]?.postMessage({ ok: false }));
  event.waitUntil(writes);
});
self.addEventListener("push", (event) => {
  writes = writes
    .catch(() => {})
    .then(async () => {
      let payload;
      try {
        payload = event.data.json();
      } catch {
        return;
      }
      if (
        payload?.v !== 1 ||
        !Number.isSafeInteger(payload.ownerId) ||
        payload.ownerId !== (await owner()) ||
        !/^\/chat\/[1-9][0-9]*$/.test(payload.path) ||
        !/^chat-[1-9][0-9]*$/.test(payload.tag)
      )
        return;
      await self.registration.showNotification("Job Finder — Tin nhắn mới", {
        body: "Bạn có tin nhắn mới. Mở Job Finder để xem.",
        tag: payload.tag,
        renotify: false,
        data: { path: payload.path, ownerId: payload.ownerId },
        icon: "/push-icon-192.png",
      });
    });
  event.waitUntil(writes);
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      await writes.catch(() => {});
      const data = event.notification.data;
      if (
        data?.ownerId !== (await owner()) ||
        !/^\/chat\/[1-9][0-9]*$/.test(data.path)
      )
        return;
      const url = new URL(data.path, self.location.origin).href;
      for (const client of await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(url);
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
