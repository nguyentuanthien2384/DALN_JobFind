'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `orderpackagecvs` (1 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "packageCvId": 1,
    "userId": 2,
    "currentPrice": 1,
    "amount": 5,
    "createdAt": "2022-11-15 12:42:09",
    "updatedAt": "2022-11-15 12:42:09"
  }
];
    await queryInterface.bulkInsert('OrderPackageCVs', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('OrderPackageCVs', null, {});
  }
};
