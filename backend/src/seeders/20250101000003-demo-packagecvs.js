'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `packagecvs` (4 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "name": "5 lượt xem",
    "value": "5",
    "price": 1,
    "isActive": 1
  },
  {
    "id": 2,
    "name": "10 lượt xem",
    "value": "10",
    "price": 1.8,
    "isActive": 1
  },
  {
    "id": 3,
    "name": "20 lượt xem",
    "value": "20",
    "price": 3.5,
    "isActive": 1
  },
  {
    "id": 4,
    "name": "30 lượt xem",
    "value": "30",
    "price": 4.5,
    "isActive": 1
  }
];
    await queryInterface.bulkInsert('PackageCvs', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('PackageCvs', null, {});
  }
};
