'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `userskills` (31 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "userId": 5,
    "skillId": 8
  },
  {
    "userId": 5,
    "skillId": 9
  },
  {
    "userId": 5,
    "skillId": 10
  },
  {
    "userId": 5,
    "skillId": 28
  },
  {
    "userId": 5,
    "skillId": 29
  },
  {
    "userId": 9,
    "skillId": 5
  },
  {
    "userId": 9,
    "skillId": 21
  },
  {
    "userId": 30,
    "skillId": 1
  },
  {
    "userId": 30,
    "skillId": 8
  },
  {
    "userId": 30,
    "skillId": 10
  },
  {
    "userId": 30,
    "skillId": 13
  },
  {
    "userId": 30,
    "skillId": 29
  },
  {
    "userId": 30,
    "skillId": 39
  },
  {
    "userId": 31,
    "skillId": 1
  },
  {
    "userId": 31,
    "skillId": 2
  },
  {
    "userId": 31,
    "skillId": 8
  },
  {
    "userId": 31,
    "skillId": 9
  },
  {
    "userId": 33,
    "skillId": 12
  },
  {
    "userId": 33,
    "skillId": 13
  },
  {
    "userId": 33,
    "skillId": 14
  },
  {
    "userId": 33,
    "skillId": 31
  },
  {
    "userId": 33,
    "skillId": 38
  },
  {
    "userId": 33,
    "skillId": 39
  },
  {
    "userId": 36,
    "skillId": 1
  },
  {
    "userId": 36,
    "skillId": 2
  },
  {
    "userId": 36,
    "skillId": 8
  },
  {
    "userId": 36,
    "skillId": 39
  },
  {
    "userId": 36,
    "skillId": 40
  },
  {
    "userId": 36,
    "skillId": 41
  },
  {
    "userId": 36,
    "skillId": 42
  },
  {
    "userId": 36,
    "skillId": 43
  }
];
    await queryInterface.bulkInsert('UserSkills', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('UserSkills', null, {});
  }
};
