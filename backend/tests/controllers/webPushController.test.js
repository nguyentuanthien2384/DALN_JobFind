jest.mock("../../src/services/webPushService", () => ({
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  isSubscribed: jest.fn(),
}));
jest.mock("../../src/utils/realtimeLimiter", () => ({ consume: jest.fn() }));
jest.mock("../../src/utils/webPushConfig", () => ({ settings: jest.fn() }));
const service = require("../../src/services/webPushService"),
  limiter = require("../../src/utils/realtimeLimiter"),
  config = require("../../src/utils/webPushConfig"),
  controller = require("../../src/controllers/webPushController");
const response = () => {
  const res = { setHeader: jest.fn(), json: jest.fn() };
  res.status = jest.fn(() => res);
  return res;
};
beforeEach(() => {
  jest.resetAllMocks();
  limiter.consume.mockResolvedValue({ allowed: true });
  config.settings.mockReturnValue({
    vapidDetails: { publicKey: "public", privateKey: "private-never-exposed" },
  });
});
test("configuration exposes only public key and current account subscription status", async () => {
  service.isSubscribed.mockResolvedValue(true);
  const res = response();
  await controller.config({ user: { id: 7 }, query: { id: "device" } }, res);
  expect(service.isSubscribed).toHaveBeenCalledWith(7, "device");
  expect(JSON.stringify(res.json.mock.calls)).not.toContain(
    "private-never-exposed",
  );
  expect(res.setHeader).toHaveBeenCalledWith(
    "Cache-Control",
    "private, no-store",
  );
});
test.each(["subscribe", "unsubscribe"])(
  "%s uses verified account rather than client account id",
  async (method) => {
    service[method].mockResolvedValue({ errCode: 0 });
    const res = response();
    await controller[method](
      { user: { id: 7 }, body: { userId: 999, id: "device" } },
      res,
    );
    expect(service[method].mock.calls[0][0]).toBe(7);
    expect(res.status).toHaveBeenCalledWith(200);
  },
);
test("rate limiting stops registration and backend failures expose no endpoint or keys", async () => {
  limiter.consume.mockResolvedValueOnce({ allowed: false });
  let res = response();
  await controller.subscribe({ user: { id: 7 } }, res);
  expect(res.status).toHaveBeenCalledWith(429);
  expect(service.subscribe).not.toHaveBeenCalled();
  service.subscribe.mockRejectedValue(new Error("endpoint with secret"));
  res = response();
  await controller.subscribe({ user: { id: 7 }, body: {} }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({
    errCode: -1,
    code: "PUSH_UNAVAILABLE",
  });
});
