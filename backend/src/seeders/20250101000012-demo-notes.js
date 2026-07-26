'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `notes` (31 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "note": "test chặn",
    "postId": 19,
    "userId": 1,
    "createdAt": "2022-08-10 17:07:21",
    "updatedAt": "2022-08-10 17:07:21"
  },
  {
    "id": 2,
    "note": "Mở lại test",
    "postId": 19,
    "userId": 1,
    "createdAt": "2022-08-10 17:10:09",
    "updatedAt": "2022-08-10 17:10:09"
  },
  {
    "id": 3,
    "note": "Đã duyệt bài thành công",
    "postId": 19,
    "userId": 1,
    "createdAt": "2022-08-10 17:14:08",
    "updatedAt": "2022-08-10 17:14:08"
  },
  {
    "id": 4,
    "note": "Đã duyệt bài thành công",
    "postId": 20,
    "userId": 1,
    "createdAt": "2022-08-20 15:00:44",
    "updatedAt": "2022-08-20 15:00:44"
  },
  {
    "id": 5,
    "note": "Thông tin mô tả không hợp lý",
    "postId": 22,
    "userId": 1,
    "createdAt": "2022-08-22 20:48:42",
    "updatedAt": "2022-08-22 20:48:42"
  },
  {
    "id": 6,
    "note": "Đã duyệt bài thành công",
    "postId": 22,
    "userId": 1,
    "createdAt": "2022-08-22 20:59:16",
    "updatedAt": "2022-08-22 20:59:16"
  },
  {
    "id": 7,
    "note": "Đã duyệt bài thành công",
    "postId": 21,
    "userId": 1,
    "createdAt": "2022-08-22 20:59:53",
    "updatedAt": "2022-08-22 20:59:53"
  },
  {
    "id": 8,
    "note": "Đã duyệt bài thành công",
    "postId": 31,
    "userId": 1,
    "createdAt": "2022-08-23 13:57:56",
    "updatedAt": "2022-08-23 13:57:56"
  },
  {
    "id": 9,
    "note": "Bài viết có nội dung mô tả không phù hợp",
    "postId": 30,
    "userId": 1,
    "createdAt": "2022-08-23 13:59:05",
    "updatedAt": "2022-08-23 13:59:05"
  },
  {
    "id": 10,
    "note": "test từ chối",
    "postId": 32,
    "userId": 1,
    "createdAt": "2022-08-25 13:45:13",
    "updatedAt": "2022-08-25 13:45:13"
  },
  {
    "id": 11,
    "note": "Đã duyệt bài thành công",
    "postId": 32,
    "userId": 1,
    "createdAt": "2022-08-25 13:51:48",
    "updatedAt": "2022-08-25 13:51:48"
  },
  {
    "id": 12,
    "note": "Đã duyệt bài thành công",
    "postId": 33,
    "userId": 1,
    "createdAt": "2022-08-26 09:40:49",
    "updatedAt": "2022-08-26 09:40:49"
  },
  {
    "id": 13,
    "note": "Bài viết mô tả chưa hợp lý",
    "postId": 34,
    "userId": 1,
    "createdAt": "2022-08-28 21:14:18",
    "updatedAt": "2022-08-28 21:14:18"
  },
  {
    "id": 14,
    "note": "Đã duyệt bài thành công",
    "postId": 34,
    "userId": 1,
    "createdAt": "2022-08-28 21:16:09",
    "updatedAt": "2022-08-28 21:16:09"
  },
  {
    "id": 15,
    "note": "bị chặn do duyệt sai",
    "postId": 34,
    "userId": 1,
    "createdAt": "2022-08-28 21:17:07",
    "updatedAt": "2022-08-28 21:17:07"
  },
  {
    "id": 16,
    "note": "Chặn nhầm",
    "postId": 34,
    "userId": 1,
    "createdAt": "2022-08-28 21:17:47",
    "updatedAt": "2022-08-28 21:17:47"
  },
  {
    "id": 17,
    "note": "Đã duyệt bài thành công",
    "postId": 34,
    "userId": 1,
    "createdAt": "2022-08-28 21:18:04",
    "updatedAt": "2022-08-28 21:18:04"
  },
  {
    "id": 18,
    "note": "Sửa lại mức lương phù hợp",
    "postId": 37,
    "userId": 1,
    "createdAt": "2022-09-02 19:52:03",
    "updatedAt": "2022-09-02 19:52:03"
  },
  {
    "id": 19,
    "note": "Đã duyệt bài thành công",
    "postId": 37,
    "userId": 1,
    "createdAt": "2022-09-02 19:53:43",
    "updatedAt": "2022-09-02 19:53:43"
  },
  {
    "id": 20,
    "note": "Thông tin mô tả chưa chính xác",
    "postId": 40,
    "userId": 1,
    "createdAt": "2022-09-03 14:56:01",
    "updatedAt": "2022-09-03 14:56:01"
  },
  {
    "id": 21,
    "note": "Đã duyệt bài thành công",
    "postId": 40,
    "userId": 1,
    "createdAt": "2022-09-03 14:57:09",
    "updatedAt": "2022-09-03 14:57:09"
  },
  {
    "id": 22,
    "note": "Đã duyệt bài thành công",
    "postId": 42,
    "userId": 1,
    "createdAt": "2022-09-10 21:35:17",
    "updatedAt": "2022-09-10 21:35:17"
  },
  {
    "id": 23,
    "note": "Đã duyệt bài thành công",
    "postId": 44,
    "userId": 1,
    "createdAt": "2022-12-13 20:31:06",
    "updatedAt": "2022-12-13 20:31:06"
  },
  {
    "id": 24,
    "note": "Đã duyệt bài thành công",
    "postId": 44,
    "userId": 1,
    "createdAt": "2022-12-13 20:42:14",
    "updatedAt": "2022-12-13 20:42:14"
  },
  {
    "id": 25,
    "note": "Đã duyệt bài thành công",
    "postId": 44,
    "userId": 1,
    "createdAt": "2022-12-13 20:44:46",
    "updatedAt": "2022-12-13 20:44:46"
  },
  {
    "id": 26,
    "note": "Đã duyệt bài thành công",
    "postId": 45,
    "userId": 1,
    "createdAt": "2022-12-15 09:45:54",
    "updatedAt": "2022-12-15 09:45:54"
  },
  {
    "id": 27,
    "note": "Đã duyệt bài thành công",
    "postId": 46,
    "userId": 1,
    "createdAt": "2022-12-15 10:20:36",
    "updatedAt": "2022-12-15 10:20:36"
  },
  {
    "id": 28,
    "note": "Hãy sửa lại số lượng nhân viên",
    "postId": 47,
    "userId": 1,
    "createdAt": "2022-12-25 19:59:29",
    "updatedAt": "2022-12-25 19:59:29"
  },
  {
    "id": 29,
    "note": "Đã duyệt bài thành công",
    "postId": 47,
    "userId": 1,
    "createdAt": "2022-12-25 20:15:59",
    "updatedAt": "2022-12-25 20:15:59"
  },
  {
    "id": 30,
    "note": "tu choi vi test",
    "postId": 48,
    "userId": 1,
    "createdAt": "2022-12-26 13:21:13",
    "updatedAt": "2022-12-26 13:21:13"
  },
  {
    "id": 31,
    "note": "Đã duyệt bài thành công",
    "postId": 48,
    "userId": 1,
    "createdAt": "2022-12-26 13:24:13",
    "updatedAt": "2022-12-26 13:24:13"
  }
];
    await queryInterface.bulkInsert('Notes', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Notes', null, {});
  }
};
