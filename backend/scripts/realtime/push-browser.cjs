const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

// Tests the real installed worker and browser notification API. Push is injected
// by Chromium DevTools; this intentionally does not contact a public provider.
module.exports = async () => {
  const worker = fs.readFileSync(
    path.resolve(__dirname, "../../../frontend/public/push-sw.js"),
  );
  const server = http.createServer((req, res) => {
    if (req.url === "/push-sw.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(worker);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<!doctype html><title>Isolated Web Push acceptance</title><p>Local push test</p>",
      );
    }
  });
  let browser;
  const profiles = path.resolve(__dirname, "../../../.local/push-browser");
  fs.mkdirSync(profiles, { recursive: true });
  const profile = fs.mkdtempSync(path.join(profiles, "test-"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const context = (browser = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      permissions: ["notifications"],
    }));
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.grantPermissions(["notifications"], { origin });
    await page.goto(origin);
    const cdp = await context.newCDPSession(page);
    cdp.on("ServiceWorker.workerErrorReported", (event) =>
      console.error("Worker error", event.errorMessage),
    );
    let registrationId;
    cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => {
      for (const registration of event.registrations)
        if (registration.scopeURL === origin + "/" && !registration.isDeleted)
          registrationId = registration.registrationId;
    });
    await cdp.send("ServiceWorker.enable");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/push-sw.js");
      await navigator.serviceWorker.ready;
    });
    const setOwner = (ownerId, expectedOwner) =>
      page.evaluate(
        async ({ ownerId, expectedOwner }) => {
          const registration = await navigator.serviceWorker.ready;
          return new Promise((resolve, reject) => {
            const channel = new MessageChannel(),
              timer = setTimeout(
                () => reject(new Error("Worker did not reply")),
                5000,
              );
            channel.port1.onmessage = (event) => {
              clearTimeout(timer);
              channel.port1.close();
              resolve(event.data);
            };
            registration.active.postMessage(
              { type: "push-owner", ownerId, expectedOwner },
              [channel.port2],
            );
          });
        },
        { ownerId, expectedOwner },
      );
    const notifications = () =>
      page.evaluate(async () =>
        (await (await navigator.serviceWorker.ready).getNotifications()).map(
          (n) => ({ tag: n.tag, body: n.body, data: n.data }),
        ),
      );
    assert.equal((await setOwner(7)).ok, true);
    const deadline = Date.now() + 5000;
    while (!registrationId && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      registrationId,
      "DevTools reports the actual installed registration",
    );
    const installedWorker = context.serviceWorkers()[0];
    await installedWorker.evaluate(() => {
      self.__pushSeen = 0;
      self.__pushError = null;
      self.addEventListener("push", () => {
        self.__pushSeen++;
      });
      self.addEventListener("unhandledrejection", (e) => {
        self.__pushError = String(e.reason);
      });
    });
    const deliver = (changes = {}) =>
      cdp.send("ServiceWorker.deliverPushMessage", {
        origin,
        registrationId,
        data: JSON.stringify({
          v: 1,
          ownerId: 7,
          tag: "chat-15",
          path: "/chat/8",
          ...changes,
        }),
      });
    await deliver();
    let displayed = [];
    for (let i = 0; i < 100; i++) {
      displayed = await notifications();
      if (displayed.length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      displayed.length,
      1,
      JSON.stringify(
        await installedWorker.evaluate(async () => ({
          seen: self.__pushSeen,
          error: self.__pushError,
          owner: await (
            await (
              await caches.open("jobfind-push-settings-v1")
            ).match("/__jobfind_push_owner")
          ).json(),
          permission: Notification.permission,
        })),
      ),
    );
    assert.equal(displayed[0].tag, "chat-15");
    assert.equal(displayed[0].data.path, "/chat/8");
    assert.equal(
      displayed[0].body,
      "Bạn có tin nhắn mới. Mở Job Finder để xem.",
    );
    await deliver();
    await deliver({ ownerId: 8, tag: "chat-16" });
    // A worker message drains queued delivery work and makes assertions deterministic.
    await setOwner(7);
    assert.equal((await notifications()).length, 1);
    await setOwner(null, 7);
    assert.equal((await notifications()).length, 0);
    await deliver();
    await setOwner(null);
    assert.equal((await notifications()).length, 0);
    await setOwner(8);
    assert.equal((await setOwner(null, 7)).changed, false);
    await deliver({ ownerId: 8, tag: "chat-17" });
    await setOwner(8);
    assert.equal((await notifications()).length, 1);
    await setOwner(7);
    assert.equal((await notifications()).length,0,'Changing account closes existing notifications');
    await setOwner(null, 7);
    console.log(
      "PASS Web Push Chromium: real worker install, native notification display, generic body, duplicate tag, wrong-account suppression, logout closes notifications, old logout preserves new owner",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (
      path.dirname(path.resolve(profile)) === profiles &&
      path.basename(profile).startsWith("test-")
    )
      fs.rmSync(profile, { recursive: true, force: true });
  }
};
if (require.main === module)
  module.exports().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
