'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `packageposts` (5 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "name": "Gói 5 bài bình thường",
    "value": "5",
    "price": 0.5,
    "isHot": 0,
    "isActive": 1
  },
  {
    "id": 2,
    "name": "Gói 15 bài bình thường",
    "value": "15",
    "price": 1,
    "isHot": 0,
    "isActive": 1
  },
  {
    "id": 3,
    "name": "Gói 5 bài nổi bật",
    "value": "5",
    "price": 1,
    "isHot": 1,
    "isActive": 1
  },
  {
    "id": 4,
    "name": "Gói 15 bài nổi bật",
    "value": "15",
    "price": 2,
    "isHot": 1,
    "isActive": 1
  },
  {
    "id": 6,
    "name": "Gói 30 bài viết bình thường",
    "value": "30",
    "price": 2,
    "isHot": 0,
    "isActive": 1
  }
];
    await queryInterface.bulkInsert('PackagePosts', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('PackagePosts', null, {});
  }
};
