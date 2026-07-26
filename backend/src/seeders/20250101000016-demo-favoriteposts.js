'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `FavoritePosts` (tin tuyển dụng đã lưu).
 * Các userId là ứng viên (CANDIDATE) có sẵn trong seeder users/accounts: 5, 9, 30, 31.
 * Các postId là tin đang hoạt động (statusCode = 'PS1') trong seeder posts.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const now = new Date();
        await queryInterface.bulkInsert('FavoritePosts', [
            { id: 1, userId: 5, postId: 1, createdAt: now, updatedAt: now },
            { id: 2, userId: 5, postId: 4, createdAt: now, updatedAt: now },
            { id: 3, userId: 5, postId: 5, createdAt: now, updatedAt: now },
            { id: 4, userId: 9, postId: 4, createdAt: now, updatedAt: now },
            { id: 5, userId: 9, postId: 6, createdAt: now, updatedAt: now },
            { id: 6, userId: 30, postId: 1, createdAt: now, updatedAt: now },
            { id: 7, userId: 31, postId: 7, createdAt: now, updatedAt: now },
        ], {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('FavoritePosts', null, {});
    }
};
