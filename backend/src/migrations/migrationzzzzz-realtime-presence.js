'use strict';
module.exports = {
    async up(q, S) {
        const tables = await q.showAllTables();
        if (!tables.some((table) => String(table).toLowerCase() === 'realtimepresences')) {
            await q.createTable('RealtimePresences', {
                userId: { type: S.INTEGER, primaryKey: true, allowNull: false },
                lastSeenAt: { type: S.DATE(3), allowNull: false },
            });
        }
    },
    async down(q) { await q.dropTable('RealtimePresences'); },
};
