'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `Notifications` (thông báo cho user 5 - ứng viên demo).
 * Yêu cầu đã chạy migration bổ sung cột `content` và `link`.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const now = new Date();
        await queryInterface.bulkInsert('Notifications', [
            { userId: 5, typeCode: 'NEW_POST', isChecked: 0, content: 'Công ty bạn theo dõi vừa đăng tin tuyển dụng mới', link: '/job', createdAt: now, updatedAt: now },
            { userId: 5, typeCode: 'NEW_POST', isChecked: 1, content: 'Có 2 việc làm mới phù hợp với kỹ năng của bạn', link: '/job', createdAt: now, updatedAt: now },
        ], {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('Notifications', { typeCode: 'NEW_POST' }, {});
    }
};
