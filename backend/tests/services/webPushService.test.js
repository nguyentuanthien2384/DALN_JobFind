const mockDb = {
  sequelize: { transaction: jest.fn() },
  User: { findByPk: jest.fn() },
  WebPushSubscription: {
    destroy: jest.fn(), findByPk: jest.fn(), count: jest.fn(), upsert: jest.fn(),
    findOne: jest.fn(), findAll: jest.fn(),
  },
  WebPushDelivery: {
    bulkCreate: jest.fn(), findAll: jest.fn(), update: jest.fn(), destroy: jest.fn(),
  },
  ChatMessage: { findByPk: jest.fn() },
};
const mockConfig = {
  settings: jest.fn(), validSubscription: jest.fn(), endpointId: jest.fn(),
  validEndpoint: jest.fn(),
};
const mockMetrics = { increment: jest.fn() };
const mockCanParticipantsChat = jest.fn();
const mockSendNotification = jest.fn();

jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/webPushConfig', () => mockConfig);
jest.mock('../../src/utils/realtimeMetrics', () => mockMetrics);
jest.mock('../../src/services/chatService', () => ({
  canParticipantsChat: (...args) => mockCanParticipantsChat(...args),
}));
jest.mock('web-push', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));

const { Op } = require('sequelize');
const push = require('../../src/services/webPushService');

const NOW = new Date('2026-09-23T12:00:00.000Z');
const DEVICE_ID = 'a'.repeat(64);
const TX = { LOCK: { UPDATE: 'UPDATE' } };
const SETTINGS = { vapidDetails: { subject: 'mailto:test@example.com' }, TTL: 3600 };
const subscription = (overrides = {}) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/device',
  keys: { p256dh: 'public-key', auth: 'auth-key' },
  expirationTime: null,
  ...overrides,
});
const dueJob = (overrides = {}) => ({
  id: 31, subscriptionId: DEVICE_ID, userId: 7, generation: 'generation-1',
  messageId: 41, attempts: 0,
  ...overrides,
});
const activeSubscription = (overrides = {}) => ({
  id: DEVICE_ID, userId: 7, generation: 'generation-1',
  endpoint: subscription().endpoint, p256dh: 'public-key', auth: 'auth-key',
  ...overrides,
});
const activeMessage = (overrides = {}) => ({
  id: 41, senderId: 8, receiverId: 7, isRead: 0,
  createdAt: new Date(NOW.getTime() - 1000),
  ...overrides,
});

const configureWorkerJob = (job = dueJob()) => {
  mockDb.WebPushDelivery.findAll.mockResolvedValue([job]);
  mockDb.WebPushDelivery.update.mockResolvedValue([1]);
  mockDb.WebPushSubscription.findOne.mockResolvedValue(activeSubscription());
  mockDb.ChatMessage.findByPk.mockResolvedValue(activeMessage());
  mockCanParticipantsChat.mockResolvedValue({ allowed: true });
  return jest.fn().mockResolvedValue(undefined);
};
const finalDeliveryUpdate = () => mockDb.WebPushDelivery.update.mock.calls.at(-1);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.resetAllMocks();
  mockConfig.settings.mockReturnValue(SETTINGS);
  mockConfig.validSubscription.mockReturnValue(true);
  mockConfig.endpointId.mockReturnValue(DEVICE_ID);
  mockConfig.validEndpoint.mockReturnValue(true);
  mockDb.sequelize.transaction.mockImplementation((callback) => callback(TX));
  mockDb.User.findByPk.mockResolvedValue({ id: 7 });
  mockDb.WebPushSubscription.findByPk.mockResolvedValue(null);
  mockDb.WebPushSubscription.count.mockResolvedValue(0);
  mockDb.WebPushSubscription.findAll.mockResolvedValue([]);
  mockDb.WebPushDelivery.findAll.mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

describe('device registration', () => {
  test('disabled push and invalid subscriptions stop before opening a transaction', async () => {
    mockConfig.settings.mockReturnValueOnce(null);
    expect(await push.subscribe(7, subscription())).toEqual({ errCode: 1, code: 'PUSH_DISABLED' });
    expect(mockConfig.validSubscription).not.toHaveBeenCalled();

    mockConfig.validSubscription.mockReturnValueOnce(false);
    expect(await push.subscribe(7, subscription())).toEqual({ errCode: 1, code: 'PAYLOAD_INVALID' });
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
  });

  test('locks the account and refuses to register a device for an inactive user', async () => {
    mockDb.User.findByPk.mockResolvedValue(null);
    expect(await push.subscribe(7, subscription())).toEqual({ errCode: 1, code: 'AUTH_INACTIVE' });
    expect(mockDb.User.findByPk).toHaveBeenCalledWith(7, { transaction: TX, lock: 'UPDATE' });
    expect(mockDb.WebPushSubscription.destroy).not.toHaveBeenCalled();
    expect(mockDb.WebPushSubscription.upsert).not.toHaveBeenCalled();
  });

  test('removes expired devices and stores a new device with a bounded lifetime in one transaction', async () => {
    const value = subscription();
    const result = await push.subscribe(7, value);
    const expiry = new Date(NOW.getTime() + 30 * 86400000);

    expect(result).toEqual({ errCode: 0, data: { id: DEVICE_ID, expiresAt: expiry } });
    expect(mockConfig.endpointId).toHaveBeenCalledWith(value.endpoint);
    expect(mockDb.WebPushSubscription.destroy).toHaveBeenCalledWith({
      where: { userId: 7, expiresAt: { [Op.lte]: NOW } }, transaction: TX,
    });
    expect(mockDb.WebPushSubscription.findByPk).toHaveBeenCalledWith(DEVICE_ID, {
      transaction: TX, lock: 'UPDATE',
    });
    expect(mockDb.WebPushSubscription.count).toHaveBeenCalledWith({ where: { userId: 7 }, transaction: TX });
    expect(mockDb.WebPushSubscription.upsert).toHaveBeenCalledWith({
      id: DEVICE_ID, userId: 7, generation: expect.any(String), endpoint: value.endpoint,
      p256dh: value.keys.p256dh, auth: value.keys.auth, expiresAt: expiry,
    }, { transaction: TX });
    expect(mockDb.WebPushSubscription.upsert.mock.calls[0][0].generation).toMatch(/^[a-f0-9-]{36}$/);
  });

  test('honors an earlier provider expiration and preserves generation when keys are unchanged', async () => {
    const earlier = NOW.getTime() + 86400000;
    mockDb.WebPushSubscription.findByPk.mockResolvedValue({
      id: DEVICE_ID, userId: 7, generation: 'current-generation',
      p256dh: 'public-key', auth: 'auth-key',
    });
    mockDb.WebPushSubscription.count.mockResolvedValue(10);

    expect(await push.subscribe(7, subscription({ expirationTime: earlier }))).toEqual({
      errCode: 0, data: { id: DEVICE_ID, expiresAt: new Date(earlier) },
    });
    expect(mockDb.WebPushSubscription.count).not.toHaveBeenCalled();
    expect(mockDb.WebPushSubscription.upsert.mock.calls[0][0].generation).toBe('current-generation');
  });

  test('new credentials rotate generation, invalidating older queued deliveries', async () => {
    mockDb.WebPushSubscription.findByPk.mockResolvedValue({
      id: DEVICE_ID, userId: 7, generation: 'old-generation',
      p256dh: 'previous-key', auth: 'auth-key',
    });
    await push.subscribe(7, subscription());
    expect(mockDb.WebPushSubscription.upsert.mock.calls[0][0].generation).not.toBe('old-generation');
  });

  test.each([null, { id: DEVICE_ID, userId: 99 }])(
    'enforces the ten-device limit for an unowned endpoint: %p', async (existing) => {
      mockDb.WebPushSubscription.findByPk.mockResolvedValue(existing);
      mockDb.WebPushSubscription.count.mockResolvedValue(10);
      expect(await push.subscribe(7, subscription())).toEqual({ errCode: 1, code: 'DEVICE_LIMITED' });
      expect(mockDb.WebPushSubscription.upsert).not.toHaveBeenCalled();
    },
  );

  test('an endpoint previously owned by another account can be rebound when below the limit', async () => {
    mockDb.WebPushSubscription.findByPk.mockResolvedValue({
      id: DEVICE_ID, userId: 99, generation: 'other-account-generation',
      p256dh: 'public-key', auth: 'auth-key',
    });
    await push.subscribe(7, subscription());
    expect(mockDb.WebPushSubscription.count).toHaveBeenCalled();
    expect(mockDb.WebPushSubscription.upsert.mock.calls[0][0]).toMatchObject({ userId: 7 });
    expect(mockDb.WebPushSubscription.upsert.mock.calls[0][0].generation).not.toBe('other-account-generation');
  });

  test('database errors reject registration without reporting success', async () => {
    mockDb.WebPushSubscription.upsert.mockRejectedValue(new Error('database unavailable'));
    await expect(push.subscribe(7, subscription())).rejects.toThrow('database unavailable');
  });
});

describe('device removal and status', () => {
  test.each(['', 'wrong', 'A'.repeat(64), 'a'.repeat(63)])(
    'rejects an invalid endpoint id: %p', async (id) => {
      expect(await push.unsubscribe(7, id)).toEqual({ errCode: 1, code: 'PAYLOAD_INVALID' });
      expect(await push.isSubscribed(7, id)).toBe(false);
      expect(mockDb.WebPushSubscription.destroy).not.toHaveBeenCalled();
      expect(mockDb.WebPushSubscription.findOne).not.toHaveBeenCalled();
    },
  );

  test('deletes only the authenticated account subscription', async () => {
    expect(await push.unsubscribe(7, DEVICE_ID)).toEqual({ errCode: 0 });
    expect(mockDb.WebPushSubscription.destroy).toHaveBeenCalledWith({ where: { id: DEVICE_ID, userId: 7 } });
  });

  test('reports only an unexpired subscription owned by the authenticated account', async () => {
    mockDb.WebPushSubscription.findOne.mockResolvedValueOnce({ id: DEVICE_ID }).mockResolvedValueOnce(null);
    expect(await push.isSubscribed(7, DEVICE_ID)).toBe(true);
    expect(await push.isSubscribed(7, DEVICE_ID)).toBe(false);
    expect(mockDb.WebPushSubscription.findOne).toHaveBeenCalledWith({
      where: { id: DEVICE_ID, userId: 7, expiresAt: { [Op.gt]: NOW } },
      attributes: ['id'], raw: true,
    });
  });
});

describe('delivery enqueue', () => {
  test('does not create deliveries when the recipient has no live subscriptions', async () => {
    await push.enqueue({ id: 41, receiverId: 7 }, TX);
    expect(mockDb.WebPushSubscription.findAll).toHaveBeenCalledWith({
      where: { userId: 7, expiresAt: { [Op.gt]: NOW } }, transaction: TX, raw: true,
    });
    expect(mockDb.WebPushDelivery.bulkCreate).not.toHaveBeenCalled();
  });

  test('enqueues one generation-bound delivery per active device using the message transaction', async () => {
    mockDb.WebPushSubscription.findAll.mockResolvedValue([
      { id: DEVICE_ID, generation: 'g1' }, { id: 'b'.repeat(64), generation: 'g2' },
    ]);
    await push.enqueue({ id: 41, receiverId: 7 }, TX);
    expect(mockDb.WebPushDelivery.bulkCreate).toHaveBeenCalledWith([
      { messageId: 41, subscriptionId: DEVICE_ID, generation: 'g1', userId: 7,
        nextAttemptAt: new Date(NOW.getTime() + 5000) },
      { messageId: 41, subscriptionId: 'b'.repeat(64), generation: 'g2', userId: 7,
        nextAttemptAt: new Date(NOW.getTime() + 5000) },
    ], { transaction: TX });
  });

  test('propagates queue insertion failures to the enclosing message transaction', async () => {
    mockDb.WebPushSubscription.findAll.mockResolvedValue([{ id: DEVICE_ID, generation: 'g1' }]);
    mockDb.WebPushDelivery.bulkCreate.mockRejectedValue(new Error('queue unavailable'));
    await expect(push.enqueue({ id: 41, receiverId: 7 }, TX)).rejects.toThrow('queue unavailable');
  });
});

describe('delivery worker', () => {
  test('a disabled worker does not query deliveries', async () => {
    mockConfig.settings.mockReturnValue(null);
    await push.createWorker(jest.fn()).tick();
    expect(mockDb.WebPushDelivery.findAll).not.toHaveBeenCalled();
    expect(mockDb.WebPushDelivery.destroy).not.toHaveBeenCalled();
  });

  test('claims only due pending or expired leased jobs, then prunes old diagnostics', async () => {
    await push.createWorker(jest.fn()).tick();
    expect(mockDb.WebPushDelivery.findAll).toHaveBeenCalledWith({
      where: {
        nextAttemptAt: { [Op.lte]: NOW },
        [Op.or]: [{ status: 'pending' }, { status: 'sending', leaseUntil: { [Op.lt]: NOW } }],
      }, limit: 20, order: [['id', 'ASC']], raw: true,
    });
    expect(mockDb.WebPushDelivery.destroy).toHaveBeenCalledWith({ where: {
      status: { [Op.in]: ['sent', 'skipped', 'dead'] },
      updatedAt: { [Op.lt]: new Date(NOW.getTime() - 7 * 86400000) },
    } });
    expect(mockDb.WebPushSubscription.destroy).toHaveBeenCalledWith({
      where: { expiresAt: { [Op.lte]: NOW } },
    });
  });

  test('an unclaimed job is not read or sent', async () => {
    const send = configureWorkerJob();
    mockDb.WebPushDelivery.update.mockResolvedValue([0]);
    await push.createWorker(send).tick();
    expect(mockDb.WebPushDelivery.update).toHaveBeenCalledTimes(1);
    expect(mockDb.WebPushSubscription.findOne).not.toHaveBeenCalled();
    expect(mockDb.ChatMessage.findByPk).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    ['missing subscription', null, activeMessage()],
    ['deleted message', activeSubscription(), null],
    ['different recipient', activeSubscription(), activeMessage({ receiverId: 99 })],
    ['already read', activeSubscription(), activeMessage({ isRead: 1 })],
    ['older than one hour', activeSubscription(), activeMessage({ createdAt: new Date(NOW.getTime() - 3600001) })],
  ])('skips a stale delivery: %s', async (_reason, device, message) => {
    const send = configureWorkerJob();
    mockDb.WebPushSubscription.findOne.mockResolvedValue(device);
    mockDb.ChatMessage.findByPk.mockResolvedValue(message);
    await push.createWorker(send).tick();
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'skipped', lastCode: 'STALE', lease: null });
    expect(mockCanParticipantsChat).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test('rechecks account and company chat permission immediately before sending', async () => {
    const send = configureWorkerJob();
    mockCanParticipantsChat.mockResolvedValue({ allowed: false });
    await push.createWorker(send).tick();
    expect(mockCanParticipantsChat).toHaveBeenCalledWith(8, 7);
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'skipped', lastCode: 'NOT_ALLOWED' });
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects a stored endpoint if it no longer passes the allowlist', async () => {
    const send = configureWorkerJob();
    mockConfig.validEndpoint.mockReturnValue(false);
    await push.createWorker(send).tick();
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'dead', lastCode: 'INVALID_ENDPOINT' });
    expect(send).not.toHaveBeenCalled();
  });

  test('sends only notification metadata and completes with a lease-scoped compare-and-set', async () => {
    const send = configureWorkerJob();
    await push.createWorker(send).tick();
    expect(mockDb.WebPushSubscription.findOne).toHaveBeenCalledWith({
      where: { id: DEVICE_ID, userId: 7, generation: 'generation-1', expiresAt: { [Op.gt]: NOW } },
      raw: true,
    });
    expect(mockDb.ChatMessage.findByPk).toHaveBeenCalledWith(41, { raw: true });
    expect(send).toHaveBeenCalledWith({
      endpoint: subscription().endpoint,
      keys: { p256dh: 'public-key', auth: 'auth-key' },
    }, JSON.stringify({ v: 1, ownerId: 7, tag: 'chat-41', path: '/chat/8' }), SETTINGS);
    expect(send.mock.calls[0][1]).not.toContain('public-key');
    const [claimedValues, claimOptions] = mockDb.WebPushDelivery.update.mock.calls[0];
    expect(claimedValues).toMatchObject({ status: 'sending', attempts: 1,
      leaseUntil: new Date(NOW.getTime() + 30000) });
    expect(claimOptions.where).toMatchObject({ id: 31, nextAttemptAt: { [Op.lte]: NOW } });
    expect(finalDeliveryUpdate()).toEqual([
      { status: 'sent', lastCode: 'ACCEPTED', lease: null, leaseUntil: null },
      { where: { id: 31, lease: claimedValues.lease } },
    ]);
    expect(mockMetrics.increment).toHaveBeenCalledWith('web_push_delivery_total', '{result="accepted"}');
  });

  test('the default sender delegates delivery to the Web Push provider', async () => {
    configureWorkerJob();
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
    await push.createWorker().tick();
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: subscription().endpoint }),
      JSON.stringify({ v: 1, ownerId: 7, tag: 'chat-41', path: '/chat/8' }),
      SETTINGS,
    );
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'sent', lastCode: 'ACCEPTED' });
  });

  test.each([404, 410])('removes an expired provider subscription after HTTP %i', async (statusCode) => {
    const send = configureWorkerJob();
    send.mockRejectedValue({ statusCode });
    await push.createWorker(send).tick();
    expect(mockDb.WebPushSubscription.destroy).toHaveBeenCalledWith({
      where: { id: DEVICE_ID, generation: 'generation-1' },
    });
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'skipped', lastCode: 'EXPIRED' });
    expect(mockMetrics.increment).toHaveBeenCalledWith('web_push_delivery_total', '{result="failed"}');
  });

  test.each([400, 401, 403, 413])('marks a permanent provider error HTTP %i dead', async (statusCode) => {
    const send = configureWorkerJob();
    send.mockRejectedValue({ statusCode });
    await push.createWorker(send).tick();
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'dead', lastCode: `HTTP_${statusCode}` });
    expect(mockDb.WebPushSubscription.destroy).toHaveBeenCalledTimes(1);
  });

  test('marks an exhausted transient error dead', async () => {
    const send = configureWorkerJob(dueJob({ attempts: 5 }));
    send.mockRejectedValue(new Error('network unavailable'));
    await push.createWorker(send).tick();
    expect(finalDeliveryUpdate()[0]).toMatchObject({ status: 'dead', lastCode: 'RETRIES_EXHAUSTED' });
  });

  test.each([
    [503, 'HTTP_503'],
    [undefined, 'NETWORK'],
  ])('requeues a transient failure %p with bounded exponential delay', async (statusCode, lastCode) => {
    const send = configureWorkerJob(dueJob({ attempts: 2 }));
    send.mockRejectedValue({ statusCode });
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await push.createWorker(send).tick();
    } finally {
      random.mockRestore();
    }
    expect(finalDeliveryUpdate()[0]).toMatchObject({
      status: 'pending', lastCode,
      nextAttemptAt: new Date(NOW.getTime() + 15000 * 2 ** 2 + 2500),
    });
    expect(mockDb.WebPushSubscription.destroy).toHaveBeenCalledTimes(1);
  });

  test('concurrent ticks share one query and can retry after a failed tick', async () => {
    let release;
    mockDb.WebPushDelivery.findAll.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const worker = push.createWorker(jest.fn());
    const first = worker.tick();
    const second = worker.tick();
    expect(second).toBe(first);
    expect(mockDb.WebPushDelivery.findAll).toHaveBeenCalledTimes(1);
    release([]);
    await first;
    mockDb.WebPushDelivery.findAll.mockRejectedValueOnce(new Error('database offline'));
    await expect(worker.tick()).rejects.toThrow('database offline');
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(mockDb.WebPushDelivery.findAll).toHaveBeenCalledTimes(3);
  });

  test('start schedules one polling loop and stop prevents another tick', async () => {
    const worker = push.createWorker(jest.fn());
    worker.start();
    worker.start();
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockDb.WebPushDelivery.findAll).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    await worker.stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10000);
    expect(mockDb.WebPushDelivery.findAll).toHaveBeenCalledTimes(1);
  });

  test('start does nothing while push is disabled', async () => {
    mockConfig.settings.mockReturnValue(null);
    const worker = push.createWorker(jest.fn());
    worker.start();
    expect(jest.getTimerCount()).toBe(0);
    await worker.stop();
  });

  test('stop waits for a running tick before returning', async () => {
    let release;
    mockDb.WebPushDelivery.findAll.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const worker = push.createWorker(jest.fn());
    worker.tick();
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release([]);
    await stopping;
    expect(stopped).toBe(true);
  });

  test('polling catches database errors, records the error metric and continues', async () => {
    mockDb.WebPushDelivery.findAll.mockRejectedValueOnce(new Error('database offline'));
    const worker = push.createWorker(jest.fn());
    worker.start();
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockMetrics.increment).toHaveBeenCalledWith('web_push_worker_errors_total');
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockDb.WebPushDelivery.findAll).toHaveBeenCalledTimes(2);
    await worker.stop();
  });
});
