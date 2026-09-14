jest.mock("../../src/services/notificationService", () => ({
  handleMarkReadNotification: jest.fn(),
}));
jest.mock("../../src/config/socket", () => ({
  emitNotificationRead: jest.fn(),
}));
const service = require("../../src/services/notificationService"),
  socket = require("../../src/config/socket"),
  controller = require("../../src/controllers/notificationController");
beforeEach(() => jest.resetAllMocks());
test("read invalidation targets authenticated user only, after successful persistence", async () => {
  service.handleMarkReadNotification.mockResolvedValue({ errCode: 0 });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.handleMarkReadNotification(
    { user: { id: 7 }, body: { id: 4, userId: 999 } },
    res,
  );
  expect(service.handleMarkReadNotification).toHaveBeenCalledWith({
    id: 4,
    userId: 7,
  });
  expect(socket.emitNotificationRead).toHaveBeenCalledWith(7);
  expect(
    service.handleMarkReadNotification.mock.invocationCallOrder[0],
  ).toBeLessThan(socket.emitNotificationRead.mock.invocationCallOrder[0]);
});
test("broadcast failure cannot undo a committed read, unsuccessful read emits nothing", async () => {
  service.handleMarkReadNotification
    .mockResolvedValueOnce({ errCode: 0 })
    .mockResolvedValueOnce({ errCode: 1 });
  socket.emitNotificationRead.mockRejectedValue(new Error("redis down"));
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.handleMarkReadNotification(
    { user: { id: 7 }, body: {} },
    res,
  );
  expect(res.json).toHaveBeenCalledWith({ errCode: 0 });
  await controller.handleMarkReadNotification(
    { user: { id: 7 }, body: {} },
    res,
  );
  expect(socket.emitNotificationRead).toHaveBeenCalledTimes(1);
});
