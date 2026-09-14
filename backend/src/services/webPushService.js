import db from "../models/index";
const { Op } = require("sequelize");
const { randomUUID } = require("crypto");
const config = require("../utils/webPushConfig");
const metrics = require("../utils/realtimeMetrics");

export const subscribe = async (userId, value) => {
  if (!config.settings()) return { errCode: 1, code: "PUSH_DISABLED" };
  if (!config.validSubscription(value))
    return { errCode: 1, code: "PAYLOAD_INVALID" };
  const id = config.endpointId(value.endpoint);
  return db.sequelize.transaction(async (transaction) => {
    // Serialize device registration per account, bounding storage and fanout.
    const user = await db.User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user) return { errCode: 1, code: "AUTH_INACTIVE" };
    await db.WebPushSubscription.destroy({
      where: { userId, expiresAt: { [Op.lte]: new Date() } },
      transaction,
    });
    const existing = await db.WebPushSubscription.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (
      (!existing || existing.userId !== userId) &&
      (await db.WebPushSubscription.count({
        where: { userId },
        transaction,
      })) >= 10
    )
      return { errCode: 1, code: "DEVICE_LIMITED" };
    const generation =
      existing &&
      existing.userId === userId &&
      existing.p256dh === value.keys.p256dh &&
      existing.auth === value.keys.auth
        ? existing.generation
        : randomUUID();
    const expiresAt = new Date(
      Math.min(Date.now() + 30 * 86400000, value.expirationTime || Infinity),
    );
    await db.WebPushSubscription.upsert(
      {
        id,
        userId,
        generation,
        endpoint: value.endpoint,
        ...value.keys,
        expiresAt,
      },
      { transaction },
    );
    return { errCode: 0, data: { id, expiresAt } };
  });
};
export const unsubscribe = async (userId, id) => {
  if (!/^[a-f0-9]{64}$/.test(id || ""))
    return { errCode: 1, code: "PAYLOAD_INVALID" };
  await db.WebPushSubscription.destroy({ where: { id, userId } });
  return { errCode: 0 };
};
export const isSubscribed = async (userId, id) => {
  if (!/^[a-f0-9]{64}$/.test(id || "")) return false;
  return !!(await db.WebPushSubscription.findOne({
    where: { id, userId, expiresAt: { [Op.gt]: new Date() } },
    attributes: ["id"],
    raw: true,
  }));
};
export const enqueue = async (message, transaction) => {
  const subscriptions = await db.WebPushSubscription.findAll({
    where: { userId: message.receiverId, expiresAt: { [Op.gt]: new Date() } },
    transaction,
    raw: true,
  });
  if (subscriptions.length)
    await db.WebPushDelivery.bulkCreate(
      subscriptions.map((s) => ({
        messageId: message.id,
        subscriptionId: s.id,
        generation: s.generation,
        userId: message.receiverId,
        nextAttemptAt: new Date(Date.now() + 5000),
      })),
      { transaction },
    );
};

// Compare-and-set leases ensure only one node claims a delivery; a crashed
// worker's lease expires. Provider acceptance is not proof of user receipt.
export const createWorker = (
  send = (...args) => require("web-push").sendNotification(...args),
) => {
  let timer,
    inFlight,
    stopping = false;
  const tick = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const settings = config.settings();
      if (!settings) return;
      const now = new Date(),
        due = {
          nextAttemptAt: { [Op.lte]: now },
          [Op.or]: [
            { status: "pending" },
            { status: "sending", leaseUntil: { [Op.lt]: now } },
          ],
        };
      const jobs = await db.WebPushDelivery.findAll({
        where: due,
        limit: 20,
        order: [["id", "ASC"]],
        raw: true,
      });
      await Promise.all(
        jobs.map(async (job) => {
          const lease = randomUUID();
          const [claimed] = await db.WebPushDelivery.update(
            {
              status: "sending",
              lease,
              leaseUntil: new Date(Date.now() + 30000),
              attempts: job.attempts + 1,
            },
            { where: { ...due, id: job.id } },
          );
          if (!claimed) return;
          const finish = (status, lastCode, extra = {}) =>
            db.WebPushDelivery.update(
              { status, lastCode, lease: null, leaseUntil: null, ...extra },
              { where: { id: job.id, lease } },
            );
          try {
            const subscription = await db.WebPushSubscription.findOne({
              where: {
                id: job.subscriptionId,
                userId: job.userId,
                generation: job.generation,
                expiresAt: { [Op.gt]: now },
              },
              raw: true,
            });
            const message = await db.ChatMessage.findByPk(job.messageId, {
              raw: true,
            });
            if (
              !subscription ||
              !message ||
              message.receiverId !== job.userId ||
              +message.isRead === 1 ||
              Date.now() - new Date(message.createdAt).getTime() > 3600000
            )
              return finish("skipped", "STALE");
            const relation = await require("./chatService").canParticipantsChat(
              message.senderId,
              message.receiverId,
            );
            if (!relation.allowed) return finish("skipped", "NOT_ALLOWED");
            if (!config.validEndpoint(subscription.endpoint))
              return finish("dead", "INVALID_ENDPOINT");
            await send(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify({
                v: 1,
                ownerId: job.userId,
                tag: `chat-${message.id}`,
                path: `/chat/${message.senderId}`,
              }),
              settings,
            );
            metrics.increment("web_push_delivery_total", '{result="accepted"}');
            await finish("sent", "ACCEPTED");
          } catch (error) {
            const status = Number(error.statusCode);
            if ([404, 410].includes(status)) {
              await db.WebPushSubscription.destroy({
                where: { id: job.subscriptionId, generation: job.generation },
              });
              await finish("skipped", "EXPIRED");
            } else if (
              job.attempts >= 5 ||
              [400, 401, 403, 413].includes(status)
            )
              await finish(
                "dead",
                Number.isInteger(status)
                  ? `HTTP_${status}`
                  : "RETRIES_EXHAUSTED",
              );
            else
              await finish(
                "pending",
                Number.isInteger(status) ? `HTTP_${status}` : "NETWORK",
                {
                  nextAttemptAt: new Date(
                    Date.now() +
                      Math.min(3600000, 15000 * 2 ** job.attempts) +
                      Math.floor(Math.random() * 5000),
                  ),
                },
              );
            metrics.increment("web_push_delivery_total", '{result="failed"}');
          }
        }),
      );
      // Retain recent delivery diagnostics, not an unbounded notification log.
      await db.WebPushDelivery.destroy({
        where: {
          status: { [Op.in]: ["sent", "skipped", "dead"] },
          updatedAt: { [Op.lt]: new Date(Date.now() - 7 * 86400000) },
        },
      });
      await db.WebPushSubscription.destroy({
        where: { expiresAt: { [Op.lte]: new Date() } },
      });
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    tick,
    start: () => {
      if (timer || !config.settings()) return;
      stopping = false;
      const run = async () => {
        try {
          await tick();
        } catch {
          metrics.increment("web_push_worker_errors_total");
        } finally {
          if (!stopping) {
            timer = setTimeout(run, 5000);
            timer.unref?.();
          }
        }
      };
      timer = setTimeout(run, 1000);
      timer.unref?.();
    },
    stop: async () => {
      stopping = true;
      clearTimeout(timer);
      timer = null;
      if (inFlight) await inFlight;
    },
  };
};
