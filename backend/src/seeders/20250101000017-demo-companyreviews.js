'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `CompanyReviews` (đánh giá công ty).
 * userId: ứng viên 5, 9, 30, 31, 33 — companyId: các công ty có sẵn (6..22).
 * Mỗi user chỉ có tối đa 1 đánh giá cho mỗi công ty.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const now = new Date();
        await queryInterface.bulkInsert('CompanyReviews', [
            { id: 1, companyId: 6, userId: 5, star: 5, content: 'Môi trường làm việc chuyên nghiệp, đồng nghiệp thân thiện. Chế độ đãi ngộ tốt, lương thưởng rõ ràng.', createdAt: now, updatedAt: now },
            { id: 2, companyId: 6, userId: 9, star: 4, content: 'Công ty ổn, sếp tâm lý. Đôi lúc deadline hơi gấp nhưng nhìn chung phúc lợi đầy đủ.', createdAt: now, updatedAt: now },
            { id: 3, companyId: 6, userId: 30, star: 4, content: 'Quy trình phỏng vấn nhanh gọn, HR phản hồi lịch sự. Văn phòng đẹp, vị trí thuận tiện.', createdAt: now, updatedAt: now },
            { id: 4, companyId: 7, userId: 5, star: 4, content: 'Được đào tạo bài bản khi mới vào, có lộ trình thăng tiến rõ ràng.', createdAt: now, updatedAt: now },
            { id: 5, companyId: 7, userId: 31, star: 3, content: 'Công việc khá áp lực vào mùa cao điểm, bù lại có thưởng dự án xứng đáng.', createdAt: now, updatedAt: now },
            { id: 6, companyId: 8, userId: 9, star: 5, content: 'Một trong những công ty tốt nhất mình từng làm. Team building thường xuyên, sếp lắng nghe nhân viên.', createdAt: now, updatedAt: now },
            { id: 7, companyId: 11, userId: 30, star: 4, content: 'Chế độ OT tính rõ ràng, bảo hiểm đầy đủ. Mong công ty mở thêm chi nhánh gần trung tâm.', createdAt: now, updatedAt: now },
            { id: 8, companyId: 11, userId: 33, star: 2, content: 'Mức lương chưa cạnh tranh so với mặt bằng chung, hy vọng công ty cải thiện.', createdAt: now, updatedAt: now },
            { id: 9, companyId: 12, userId: 5, star: 5, content: 'Ứng tuyển qua JobFind và được nhận sau 1 tuần. Môi trường trẻ trung, năng động.', createdAt: now, updatedAt: now },
            { id: 10, companyId: 15, userId: 31, star: 4, content: 'Công ty hỗ trợ ăn trưa và gửi xe, văn hóa cởi mở, phù hợp với người mới ra trường.', createdAt: now, updatedAt: now },
        ], {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('CompanyReviews', null, {});
    }
};
