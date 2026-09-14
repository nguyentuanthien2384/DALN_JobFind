const migration = require('../../src/migrations/migrationzzzz-chat-reliability');
const { DataTypes } = require('sequelize');
test('resumes after partial MySQL DDL and never duplicates an existing index', async () => {
    const columns = {}, indexes = [];
    const q = {
        describeTable: jest.fn(async () => columns), showIndex: jest.fn(async () => indexes),
        addColumn: jest.fn(async (_, name, options) => { columns[name] = options; }),
        addIndex: jest.fn(async (_, fields, options) => { indexes.push({ fields, ...options }); }),
        removeIndex: jest.fn(async (_, name) => { indexes.splice(indexes.findIndex((i) => i.name === name), 1); }),
        removeColumn: jest.fn(async (_, name) => { delete columns[name]; }),
    };
    q.addIndex.mockRejectedValueOnce(new Error('interrupted DDL'));
    await expect(migration.up(q, DataTypes)).rejects.toThrow('interrupted');
    await migration.up(q, DataTypes); await migration.up(q, DataTypes);
    expect(q.addColumn).toHaveBeenCalledTimes(1);
    expect(indexes).toHaveLength(3);
    expect(indexes.find((i) => i.unique)).toEqual(expect.objectContaining({ name: 'uq_chat_sender_client_message', fields: ['senderId', 'clientMessageId'] }));
    await migration.down(q); await migration.down(q);
    expect(q.removeColumn).toHaveBeenCalledTimes(1); expect(indexes).toHaveLength(0);
});
