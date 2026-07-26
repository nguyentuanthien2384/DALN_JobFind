'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `FollowCompanies` (theo dõi công ty).
 * userId là ứng viên có sẵn: 5, 9, 30, 31 — companyId có sẵn: 6..22.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const now = new Date();
        await queryInterface.bulkInsert('FollowCompanies', [
            { id: 1, userId: 5, companyId: 6, createdAt: now, updatedAt: now },
            { id: 2, userId: 5, companyId: 7, createdAt: now, updatedAt: now },
            { id: 3, userId: 5, companyId: 11, createdAt: now, updatedAt: now },
            { id: 4, userId: 9, companyId: 6, createdAt: now, updatedAt: now },
            { id: 5, userId: 30, companyId: 8, createdAt: now, updatedAt: now },
            { id: 6, userId: 31, companyId: 6, createdAt: now, updatedAt: now },
        ], {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('FollowCompanies', null, {});
    }
};
