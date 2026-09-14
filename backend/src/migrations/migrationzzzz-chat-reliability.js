'use strict';
// Nullable IDs preserve existing rows and old clients. New clients always send
// an ID; MySQL's unique index is the concurrency boundary, not an in-memory map.
module.exports = {
    async up(q, S) {
        const columns = await q.describeTable('ChatMessages');
        if (!columns.clientMessageId) await q.addColumn('ChatMessages', 'clientMessageId', { type: S.STRING(64), allowNull: true });
        const indexes = await q.showIndex('ChatMessages');
        for (const [name, fields, unique] of [
            ['uq_chat_sender_client_message', ['senderId', 'clientMessageId'], true],
            ['idx_chat_sender_receiver_id', ['senderId', 'receiverId', 'id'], false],
            ['idx_chat_receiver_read_sender', ['receiverId', 'isRead', 'senderId'], false],
        ]) if (!indexes.some((i) => i.name === name)) await q.addIndex('ChatMessages', fields, { name, unique });
    },
    async down(q) {
        const indexes = await q.showIndex('ChatMessages');
        for (const name of ['uq_chat_sender_client_message', 'idx_chat_sender_receiver_id', 'idx_chat_receiver_read_sender']) {
            if (indexes.some((i) => i.name === name)) await q.removeIndex('ChatMessages', name);
        }
        const columns = await q.describeTable('ChatMessages');
        if (columns.clientMessageId) await q.removeColumn('ChatMessages', 'clientMessageId');
    },
};
