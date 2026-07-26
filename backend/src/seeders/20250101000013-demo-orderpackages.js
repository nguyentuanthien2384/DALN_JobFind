'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `orderpackages` (25 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:30:36",
    "updatedAt": "2022-07-31 20:30:36"
  },
  {
    "id": 2,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:31:03",
    "updatedAt": "2022-07-31 20:31:03"
  },
  {
    "id": 3,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:32:30",
    "updatedAt": "2022-07-31 20:32:30"
  },
  {
    "id": 4,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:36:27",
    "updatedAt": "2022-07-31 20:36:27"
  },
  {
    "id": 5,
    "packagePostId": 2,
    "userId": 2,
    "currentPrice": 1,
    "amount": 1,
    "createdAt": "2022-07-31 20:38:57",
    "updatedAt": "2022-07-31 20:38:57"
  },
  {
    "id": 6,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:47:16",
    "updatedAt": "2022-07-31 20:47:16"
  },
  {
    "id": 7,
    "packagePostId": 3,
    "userId": 2,
    "currentPrice": 2,
    "amount": 1,
    "createdAt": "2022-07-31 20:50:06",
    "updatedAt": "2022-07-31 20:50:06"
  },
  {
    "id": 8,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:51:51",
    "updatedAt": "2022-07-31 20:51:51"
  },
  {
    "id": 9,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-07-31 20:58:51",
    "updatedAt": "2022-07-31 20:58:51"
  },
  {
    "id": 10,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-08-01 19:55:20",
    "updatedAt": "2022-08-01 19:55:20"
  },
  {
    "id": 11,
    "packagePostId": 4,
    "userId": 2,
    "currentPrice": 2,
    "amount": 15,
    "createdAt": "2022-08-21 10:48:55",
    "updatedAt": "2022-08-21 10:48:55"
  },
  {
    "id": 12,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 1,
    "createdAt": "2022-08-21 10:54:53",
    "updatedAt": "2022-08-21 10:54:53"
  },
  {
    "id": 13,
    "packagePostId": 1,
    "userId": 2,
    "currentPrice": 0.5,
    "amount": 2,
    "createdAt": "2022-08-21 10:55:53",
    "updatedAt": "2022-08-21 10:55:53"
  },
  {
    "id": 14,
    "packagePostId": 3,
    "userId": 18,
    "currentPrice": 1,
    "amount": 5,
    "createdAt": "2022-08-22 21:09:56",
    "updatedAt": "2022-08-22 21:09:56"
  },
  {
    "id": 15,
    "packagePostId": 1,
    "userId": 18,
    "currentPrice": 0.5,
    "amount": 2,
    "createdAt": "2022-08-22 21:10:55",
    "updatedAt": "2022-08-22 21:10:55"
  },
  {
    "id": 16,
    "packagePostId": 3,
    "userId": 19,
    "currentPrice": 1,
    "amount": 4,
    "createdAt": "2022-08-25 13:28:12",
    "updatedAt": "2022-08-25 13:28:12"
  },
  {
    "id": 17,
    "packagePostId": 3,
    "userId": 20,
    "currentPrice": 1,
    "amount": 4,
    "createdAt": "2022-08-28 21:12:03",
    "updatedAt": "2022-08-28 21:12:03"
  },
  {
    "id": 18,
    "packagePostId": 3,
    "userId": 23,
    "currentPrice": 1,
    "amount": 4,
    "createdAt": "2022-09-02 19:17:37",
    "updatedAt": "2022-09-02 19:17:37"
  },
  {
    "id": 19,
    "packagePostId": 3,
    "userId": 25,
    "currentPrice": 1,
    "amount": 3,
    "createdAt": "2022-09-03 14:49:59",
    "updatedAt": "2022-09-03 14:49:59"
  },
  {
    "id": 20,
    "packagePostId": 3,
    "userId": 27,
    "currentPrice": 1,
    "amount": 4,
    "createdAt": "2022-09-10 16:34:00",
    "updatedAt": "2022-09-10 16:34:00"
  },
  {
    "id": 21,
    "packagePostId": 3,
    "userId": 29,
    "currentPrice": 1,
    "amount": 6,
    "createdAt": "2022-09-10 21:33:01",
    "updatedAt": "2022-09-10 21:33:01"
  },
  {
    "id": 22,
    "packagePostId": 3,
    "userId": 32,
    "currentPrice": 1,
    "amount": 5,
    "createdAt": "2022-12-13 20:28:10",
    "updatedAt": "2022-12-13 20:28:10"
  },
  {
    "id": 23,
    "packagePostId": 3,
    "userId": 34,
    "currentPrice": 1,
    "amount": 5,
    "createdAt": "2022-12-15 09:43:58",
    "updatedAt": "2022-12-15 09:43:58"
  },
  {
    "id": 24,
    "packagePostId": 3,
    "userId": 34,
    "currentPrice": 1,
    "amount": 5,
    "createdAt": "2022-12-15 10:18:48",
    "updatedAt": "2022-12-15 10:18:48"
  },
  {
    "id": 25,
    "packagePostId": 3,
    "userId": 35,
    "currentPrice": 1,
    "amount": 4,
    "createdAt": "2022-12-25 19:57:03",
    "updatedAt": "2022-12-25 19:57:03"
  }
];
    await queryInterface.bulkInsert('OrderPackages', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('OrderPackages', null, {});
  }
};
