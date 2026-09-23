const mockDb = {
  sequelize: { query: jest.fn() },
  RealtimePresence: { findByPk: jest.fn() }
};
jest.mock('../../src/models/index', () => mockDb);

const { touch, lastSeen } = require('../../src/services/realtimePresenceService');

beforeEach(() => {
  mockDb.sequelize.query.mockReset().mockResolvedValue([[]]);
  mockDb.RealtimePresence.findByPk.mockReset();
});

describe('recording chat presence', () => {
  test.each([1, '1', Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)])
  ('accepts canonical positive user ID %p and binds it as a number', async userId => {
    const at = new Date('2026-09-23T12:34:56.789Z');
    await expect(touch(userId, at)).resolves.toBeUndefined();

    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(1);
    const [sql, options] = mockDb.sequelize.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO RealtimePresences');
    expect(sql).toContain('GREATEST(lastSeenAt, VALUES(lastSeenAt))');
    expect(options.bind).toEqual({ userId: Number(userId), at });
    expect(options.bind.at).not.toBe(at);
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', '-1', '01', ' 1',
    '1e3', '', null, undefined, true, false, [], [1], {}, Infinity, NaN])
  ('rejects invalid user ID %p before any database write', async userId => {
    await expect(touch(userId)).rejects.toThrow('Invalid presence');
    expect(mockDb.sequelize.query).not.toHaveBeenCalled();
  });

  test.each([new Date(NaN), 'invalid', '', Infinity, null])
  ('rejects invalid observation time %p before any database write', async at => {
    await expect(touch(7, at)).rejects.toThrow('Invalid presence');
    expect(mockDb.sequelize.query).not.toHaveBeenCalled();
  });

  test('records the current observation time when one is not supplied', async () => {
    const now = new Date('2026-09-23T01:02:03.004Z');
    jest.useFakeTimers().setSystemTime(now);
    try {
      await touch(7);
      expect(mockDb.sequelize.query.mock.calls[0][1].bind).toEqual({ userId: 7, at: now });
    } finally { jest.useRealTimers(); }
  });

  test('propagates a failed presence write', async () => {
    const failure = new Error('database unavailable');
    mockDb.sequelize.query.mockRejectedValue(failure);
    await expect(touch(7)).rejects.toBe(failure);
  });
});

describe('reading the last observed chat activity', () => {
  test('returns null when the user has no presence row', async () => {
    mockDb.RealtimePresence.findByPk.mockResolvedValue(null);
    await expect(lastSeen('7')).resolves.toBeNull();
    expect(mockDb.RealtimePresence.findByPk).toHaveBeenCalledWith(7, { raw: true });
  });

  test.each(['2026-09-23T12:34:56.789Z', new Date('2026-09-23T12:34:56.789Z')])
  ('formats stored timestamp %p as ISO 8601', async lastSeenAt => {
    mockDb.RealtimePresence.findByPk.mockResolvedValue({ userId: 7, lastSeenAt });
    await expect(lastSeen(7)).resolves.toBe('2026-09-23T12:34:56.789Z');
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '01', ' 1', '1e3', null,
    undefined, true, [1], {}, NaN])
  ('rejects invalid user ID %p without a lookup', async userId => {
    await expect(lastSeen(userId)).rejects.toThrow('Invalid presence');
    expect(mockDb.RealtimePresence.findByPk).not.toHaveBeenCalled();
  });

  test('propagates lookup errors', async () => {
    const failure = new Error('lookup failed');
    mockDb.RealtimePresence.findByPk.mockRejectedValue(failure);
    await expect(lastSeen(7)).rejects.toBe(failure);
  });
});
