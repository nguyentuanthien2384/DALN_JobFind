'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `ChatMessages` (chat ứng viên - nhà tuyển dụng).
 * user 5 = ứng viên (SĐT 0795095041), user 2 = chủ công ty (COMPANY).
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const base = new Date('2025-06-01T09:00:00');
        const t = (minutes) => new Date(base.getTime() + minutes * 60000);
        await queryInterface.bulkInsert('ChatMessages', [
            { id: 1, senderId: 5, receiverId: 2, content: 'Chào anh/chị, em thấy công ty đang tuyển vị trí Nhân viên kinh doanh. Em muốn hỏi thêm về mức lương và chế độ ạ.', isRead: 1, createdAt: t(0), updatedAt: t(0) },
            { id: 2, senderId: 2, receiverId: 5, content: 'Chào em, cảm ơn em đã quan tâm. Mức lương vị trí này từ 10-15 triệu tùy kinh nghiệm, có thưởng doanh số hàng quý nhé.', isRead: 1, createdAt: t(15), updatedAt: t(15) },
            { id: 3, senderId: 5, receiverId: 2, content: 'Dạ vâng. Cho em hỏi công ty có hỗ trợ đào tạo cho người chưa có nhiều kinh nghiệm không ạ?', isRead: 1, createdAt: t(20), updatedAt: t(20) },
            { id: 4, senderId: 2, receiverId: 5, content: 'Có em nhé, công ty có chương trình đào tạo 2 tháng đầu cho nhân viên mới. Em cứ nộp CV qua tin tuyển dụng, bộ phận HR sẽ liên hệ sắp xếp phỏng vấn.', isRead: 1, createdAt: t(30), updatedAt: t(30) },
            { id: 5, senderId: 5, receiverId: 2, content: 'Dạ em cảm ơn, em sẽ nộp CV ngay ạ!', isRead: 0, createdAt: t(35), updatedAt: t(35) },
        ], {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('ChatMessages', null, {});
    }
};
