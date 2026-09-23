const assert = require("node:assert/strict"),
  https = require("https"),
  fs = require("fs"),
  path = require("path");
const { createECDH, randomBytes } = require("crypto"),
  { DataTypes } = require("sequelize");
const push = require("web-push"),
  ece = require("http_ece");
module.exports = async (db, tokenFor) => {
  const migration = require("../../src/migrations/migrationzzzzzz-web-push");
  await migration.up(db.sequelize.getQueryInterface(), DataTypes);
  await migration.up(db.sequelize.getQueryInterface(), DataTypes);
  const service = require("../../src/services/webPushService"),
    chat = require("../../src/services/chatService");
  const keys = push.generateVAPIDKeys();
  process.env.WEB_PUSH_ENABLED = "true";
  process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
  process.env.WEB_PUSH_SUBJECT = "mailto:test@example.com";
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  const auth = randomBytes(16).toString("base64url");
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/isolated-fixture",
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth },
    expirationTime: null,
  };
  let server, apiServer;
  const originalSend = push.sendNotification;
  try {
    const app = require("express")();
    app.use(require("express").json({ limit: "8kb" }));
    const controller = require("../../src/controllers/webPushController");
    const authenticate =
      require("../../src/middlewares/jwtVerify").verifyTokenUser;
    const {
      authorize,
      PERMISSIONS,
    } = require("../../src/middlewares/authorize");
    app.get(
      "/api/push/config",
      authenticate,
      authorize(PERMISSIONS.ACCOUNT_SELF),
      controller.config,
    );
    app.post(
      "/api/push/subscription",
      authenticate,
      authorize(PERMISSIONS.ACCOUNT_SELF),
      controller.subscribe,
    );
    app.delete(
      "/api/push/subscription",
      authenticate,
      authorize(PERMISSIONS.ACCOUNT_SELF),
      controller.unsubscribe,
    );
    apiServer = require("http").createServer(app);
    await new Promise((r) => apiServer.listen(0, "127.0.0.1", r));
    const apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
    const token = tokenFor(8);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    assert.equal((await fetch(apiUrl + "/api/push/config")).status, 401);
    assert.equal(
      (
        await fetch(apiUrl + "/api/push/config", {
          headers: { Authorization: "Bearer bad" },
        })
      ).status,
      401,
    );
    let response = await fetch(apiUrl + "/api/push/subscription", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...subscription, userId: 9 }),
    });
    assert.equal(response.status, 400);
    response = await fetch(apiUrl + "/api/push/subscription", {
      method: "POST",
      headers,
      body: JSON.stringify(subscription),
    });
    assert.equal(response.status, 200);
    const saved = (await response.json()).data;
    response = await fetch(apiUrl + "/api/push/config?id=" + saved.id, {
      headers,
    });
    const configuration = await response.json();
    assert.equal(configuration.data.subscribed, true);
    assert.equal(
      JSON.stringify(configuration).includes(keys.privateKey),
      false,
    );
    await db.Account.update({ statusCode: "S2" }, { where: { userId: 8 } });
    assert.equal(
      (await fetch(apiUrl + "/api/push/config", { headers })).status,
      403,
    );
    await db.Account.update({ statusCode: "S1" }, { where: { userId: 8 } });
    assert.equal(
      (
        await fetch(apiUrl + "/api/push/subscription", {
          method: "DELETE",
          headers,
          body: JSON.stringify({ id: saved.id }),
        })
      ).status,
      200,
    );
    console.log(
      "PASS Web Push API: real HTTP/JWT/current SQL account/RBAC, rejects forged identity, missing or invalid tokens and inactive account, no private key in response",
    );
    const registered = await service.subscribe(8, subscription);
    assert.equal(registered.errCode, 0);
    const original = await db.WebPushSubscription.findByPk(registered.data.id, {
      raw: true,
    });
    assert.equal(
      (await service.subscribe(8, subscription)).data.id,
      original.id,
    );
    assert.equal(
      (await db.WebPushSubscription.findByPk(original.id)).generation,
      original.generation,
    );
    await service.unsubscribe(9, original.id);
    assert.ok(await db.WebPushSubscription.findByPk(original.id));
    assert.equal(await service.isSubscribed(8, original.id), true);
    assert.equal(await service.isSubscribed(9, original.id), false);
    // True sender retries exercise SQL uniqueness and transactional enqueue.
    const packet = {
      senderId: 7,
      receiverId: 8,
      content: "private text must never appear in push",
      clientMessageId: "push-atomic-message-0001",
    };
    const sent = await Promise.all(
      Array.from({ length: 5 }, () => chat.handleSendMessage(packet)),
    );
    assert.equal(new Set(sent.map((s) => s.data.id)).size, 1);
    assert.equal(await db.WebPushDelivery.count(), 1);
    await assert.rejects(
      db.sequelize.transaction(async (transaction) => {
        const message = await db.ChatMessage.create(
          { senderId: 7, receiverId: 8, content: "rollback", isRead: 0 },
          { transaction },
        );
        await service.enqueue(message, transaction);
        throw new Error("rollback");
      }),
    );
    assert.equal(await db.WebPushDelivery.count(), 1);
    assert.equal(
      await db.ChatMessage.count({ where: { content: "rollback" } }),
      0,
    );
    const due = () =>
      db.WebPushDelivery.update(
        { nextAttemptAt: new Date(0) },
        { where: { status: "pending" } },
      );
    await due();
    let received = [],
      providerError;
    // Reuse the independently generated test TLS certificate. Provider is
    // loopback only. Production endpoint validation remains unchanged.
    const certDir = process.env.CHAT_TEST_PUSH_TLS_DIR;
    if (!certDir)
      throw new Error(
        "CHAT_TEST_PUSH_TLS_DIR must contain local.crt/local.key",
      );
    const cert = fs.readFileSync(path.join(certDir, "local.crt"));
    server = https.createServer(
      { cert, key: fs.readFileSync(path.join(certDir, "local.key")) },
      (req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            assert.equal(req.headers["content-encoding"], "aes128gcm");
            assert.match(req.headers.authorization, /^vapid /);
            const payload = JSON.parse(
              ece
                .decrypt(Buffer.concat(chunks), {
                  version: "aes128gcm",
                  privateKey: curve,
                  authSecret: auth,
                })
                .toString(),
            );
            received.push(payload);
            res.writeHead(201);
            res.end();
          } catch (error) {
            providerError = error;
            res.writeHead(500);
            res.end();
          }
        });
      },
    );
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const agent = new https.Agent({ ca: cert });
    const sender = (s, payload, options) =>
      originalSend.call(
        push,
        { ...s, endpoint: `https://127.0.0.1:${server.address().port}/push` },
        payload,
        { ...options, agent },
      );
    // Exercise the default worker call as well as its explicit test injection.
    push.sendNotification = function (...args) {
      assert.equal(this, push);
      return sender(...args);
    };
    const workers = [service.createWorker(), service.createWorker(sender)];
    await Promise.all(workers.map((w) => w.tick()));
    if (providerError) throw providerError;
    assert.equal(received.length, 1);
    assert.equal(received[0].ownerId, 8);
    assert.equal(JSON.stringify(received).includes("private text"), false);
    assert.equal((await db.WebPushDelivery.findOne()).status, "sent");
    console.log(
      "PASS Web Push: SQL transaction + concurrent dedupe, exclusive worker lease, real VAPID/encryption over local HTTPS, payload decrypted without message text",
    );
    let message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-retry-message-0002",
    });
    await due();
    await service
      .createWorker(async () => {
        throw { statusCode: 503 };
      })
      .tick();
    let job = await db.WebPushDelivery.findOne({
      where: { messageId: message.data.id },
      raw: true,
    });
    assert.equal(job.status, "pending");
    assert.equal(job.attempts, 1);
    assert.ok(new Date(job.nextAttemptAt) > new Date());
    await due();
    await service.createWorker(sender).tick();
    assert.equal(received.length, 2);
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-read-message-00003",
    });
    await db.ChatMessage.update(
      { isRead: 1 },
      { where: { id: message.data.id } },
    );
    await due();
    await service.createWorker(sender).tick();
    assert.equal(received.length, 2);
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-expired-lease-0004",
    });
    await due();
    await db.WebPushDelivery.update(
      { status: "sending", lease: "crashed", leaseUntil: new Date(0) },
      { where: { messageId: message.data.id } },
    );
    await service.createWorker(sender).tick();
    assert.equal(received.length, 3);
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-owner-change-0005",
    });
    await service.subscribe(9, subscription);
    await due();
    await service.createWorker(sender).tick();
    assert.equal(received.length, 3);
    assert.equal(
      (
        await db.WebPushDelivery.findOne({
          where: { messageId: message.data.id },
        })
      ).status,
      "skipped",
    );
    await service.subscribe(8, subscription);
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-disable-user-0006",
    });
    await db.Account.update({ statusCode: "S2" }, { where: { userId: 8 } });
    await due();
    await service.createWorker(sender).tick();
    assert.equal(received.length, 3);
    await db.Account.update({ statusCode: "S1" }, { where: { userId: 8 } });
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-expired-device-07",
    });
    await due();
    await service
      .createWorker(async () => {
        throw { statusCode: 410 };
      })
      .tick();
    assert.equal(await db.WebPushSubscription.count(), 0);
    assert.equal(
      (
        await db.WebPushDelivery.findOne({
          where: { messageId: message.data.id },
        })
      ).lastCode,
      "EXPIRED",
    );
    await service.subscribe(8, subscription);
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-exhausted-retry-08",
    });
    await due();
    await db.WebPushDelivery.update(
      { attempts: 5 },
      { where: { messageId: message.data.id } },
    );
    await service
      .createWorker(async () => {
        throw new Error("network timeout");
      })
      .tick();
    job = await db.WebPushDelivery.findOne({
      where: { messageId: message.data.id },
      raw: true,
    });
    assert.equal(job.status, "dead");
    assert.equal(job.attempts, 6);
    message = await chat.handleSendMessage({
      ...packet,
      clientMessageId: "push-vapid-denied-0009",
    });
    await due();
    await service
      .createWorker(async () => {
        throw { statusCode: 403 };
      })
      .tick();
    assert.equal(
      (
        await db.WebPushDelivery.findOne({
          where: { messageId: message.data.id },
        })
      ).status,
      "dead",
    );
    for (let i = 0; i < 9; i++)
      assert.equal(
        (
          await service.subscribe(8, {
            ...subscription,
            endpoint: subscription.endpoint + i,
          })
        ).errCode,
        0,
      );
    assert.equal(
      (
        await service.subscribe(8, {
          ...subscription,
          endpoint: subscription.endpoint + "extra",
        })
      ).code,
      "DEVICE_LIMITED",
    );
    await db.WebPushSubscription.update(
      { expiresAt: new Date(0) },
      { where: { userId: 8 } },
    );
    assert.equal((await service.subscribe(8, subscription)).errCode, 0);
    assert.equal(await db.WebPushSubscription.count(), 1);
    assert.notEqual(
      (await db.WebPushSubscription.findByPk(original.id)).generation,
      original.generation,
    );
    console.log(
      "PASS Web Push: retry/backoff, restart after lease expiry, skip read messages, suppress old-account jobs, disabled account, 410 cleanup, owner-only unsubscribe",
    );
    console.log(
      "PASS Web Push: default library binding, six-attempt retry ceiling, permanent rejection, ten-device cap, expired-device renewal, private subscription status",
    );
  } finally {
    push.sendNotification = originalSend;
    if (server) await new Promise((r) => server.close(r));
    if (apiServer) await new Promise((r) => apiServer.close(r));
    process.env.WEB_PUSH_ENABLED = 'false';
    delete process.env.WEB_PUSH_PRIVATE_KEY;
    delete process.env.WEB_PUSH_PUBLIC_KEY;
    delete process.env.WEB_PUSH_SUBJECT;
  }
};
