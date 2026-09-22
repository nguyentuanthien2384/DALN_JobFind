'use strict';

const { DEMO_JOB_NOTIFICATIONS } = require('../utils/notificationDestination');

/**
 * Seeder dữ liệu mẫu cho bảng `Notifications` (thông báo cho user 5 - ứng viên demo).
 * Yêu cầu đã chạy migration bổ sung cột `content` và `link`.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const now = new Date();
        await queryInterface.bulkInsert('Notifications', DEMO_JOB_NOTIFICATIONS.map(
            ({ content, link }, index) => ({
                userId: 5, typeCode: 'NEW_POST', isChecked: index,
                content, link, createdAt: now, updatedAt: now
            })
        ), {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('Notifications', {
            userId: 5,
            typeCode: 'NEW_POST',
            [Sequelize.Op.or]: DEMO_JOB_NOTIFICATIONS.flatMap(({ legacyContent, content, link }) => [
                { content: legacyContent, link: '/job' },
                { content, link }
            ])
        }, {});
    }
};
