'use strict';
module.exports = {
    async up(q, S) {
        const tables = (await q.showAllTables()).map(table => String(table).toLowerCase());
        if (!tables.includes('chatattachments')) await q.createTable('ChatAttachments', {
            id: { type: S.UUID, primaryKey: true, allowNull: false },
            senderId: { type: S.INTEGER, allowNull: false }, receiverId: { type: S.INTEGER, allowNull: false },
            name: { type: S.STRING(255), allowNull: false }, mimeType: { type: S.STRING(64), allowNull: false },
            size: { type: S.INTEGER, allowNull: false }, pageCount: { type: S.INTEGER, allowNull: false },
            sha256: { type: S.STRING(64), allowNull: false }, bytes: { type: S.BLOB('long'), allowNull: false },
            createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
        });
        const columns = await q.describeTable('ChatMessages');
        for (const [name, type] of [['attachmentId', S.UUID], ['jobPostId', S.INTEGER], ['jobSnapshot', S.JSON]]) {
            if (!columns[name]) await q.addColumn('ChatMessages', name, { type, allowNull: true });
        }
        const indexes = await q.showIndex('ChatAttachments');
        if (!indexes.some(index => index.name === 'chat_attachment_dedup')) await q.addIndex('ChatAttachments',
            ['senderId', 'receiverId', 'sha256'], { unique: true, name: 'chat_attachment_dedup' });
        const messageIndexes = await q.showIndex('ChatMessages');
        if (!messageIndexes.some(index => index.name === 'chat_message_attachment')) await q.addIndex('ChatMessages',
            ['attachmentId', 'senderId', 'receiverId'], { name: 'chat_message_attachment' });
    },
    async down(q) {
        await q.removeIndex('ChatMessages', 'chat_message_attachment');
        for (const name of ['attachmentId', 'jobPostId', 'jobSnapshot']) await q.removeColumn('ChatMessages', name);
        await q.dropTable('ChatAttachments');
    },
};
