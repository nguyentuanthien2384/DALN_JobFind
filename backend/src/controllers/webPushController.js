const service = require("../services/webPushService");
const config = require("../utils/webPushConfig");
const limiter = require("../utils/realtimeLimiter");
const run = (action) => async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const rate = await limiter.consume(`push:${req.user.id}`, 30, 60000);
    if (!rate.allowed)
      return res.status(429).json({ errCode: 7, code: "RATE_LIMITED" });
    const result = await action(req);
    return res.status(result.errCode === 0 ? 200 : 400).json(result);
  } catch {
    return res.status(503).json({ errCode: -1, code: "PUSH_UNAVAILABLE" });
  }
};
module.exports = {
  config: run(async (req) => {
    const s = config.settings();
    return {
      errCode: 0,
      data: {
        enabled: !!s,
        publicKey: s?.vapidDetails.publicKey || null,
        subscribed:
          !!s &&
          (await service.isSubscribed(Number(req.user.id), req.query.id)),
      },
    };
  }),
  subscribe: run((req) => service.subscribe(Number(req.user.id), req.body)),
  unsubscribe: run((req) =>
    service.unsubscribe(Number(req.user.id), req.body?.id),
  ),
};
