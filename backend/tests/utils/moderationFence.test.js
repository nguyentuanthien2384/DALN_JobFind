const mockDb = { sequelize: { query: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { cancelLegacyModeration } = require('../../src/utils/moderationFence');
const transaction = { id: 'test-only-transaction' };
beforeEach(() => mockDb.sequelize.query.mockReset());

test('a standalone legacy database with no fence table does not require a migration to edit', async () => {
    mockDb.sequelize.query.mockResolvedValueOnce([[]]);
    await cancelLegacyModeration(17, transaction);
    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(1);
    expect(mockDb.sequelize.query.mock.calls[0][1]).toEqual({ transaction });
});
test.each(['MyISAM', null])('existing unsafe engine %s is not treated as a missing optional table', async engine => {
    mockDb.sequelize.query.mockResolvedValueOnce([[{ engine }]]);
    await expect(cancelLegacyModeration(17, transaction)).rejects.toThrow('giao dịch');
    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(1);
});
test.each(['lookup', 'write'])('does not swallow %s errors and continue without cancellation', async stage => {
    if (stage === 'write') mockDb.sequelize.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]]);
    mockDb.sequelize.query.mockRejectedValueOnce(new Error('private SQL failure'));
    await expect(cancelLegacyModeration(17, transaction)).rejects.toThrow('private SQL failure');
});
test('uses the caller transaction and bound target id to cancel the request, never creating an AI request', async () => {
    mockDb.sequelize.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]]).mockResolvedValueOnce([[], 1]);
    await cancelLegacyModeration(17, transaction);
    expect(mockDb.sequelize.query).toHaveBeenLastCalledWith(expect.stringContaining("state = 'cancelled'"), {
        transaction, replacements: { postId: 17, now: expect.any(Date) }
    });
});
