'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `posts` (41 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 38,
    "createdAt": "2022-07-19 08:05:48",
    "updatedAt": "2022-10-23 09:37:54"
  },
  {
    "id": 4,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 1,
    "timePost": "1659596024704",
    "detailPostId": 2,
    "createdAt": "2022-07-19 08:13:24",
    "updatedAt": "2022-07-19 08:13:24"
  },
  {
    "id": 5,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 3,
    "createdAt": "2022-07-19 08:13:24",
    "updatedAt": "2022-07-19 08:13:24"
  },
  {
    "id": 6,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 1,
    "timePost": "1659596024704",
    "detailPostId": 4,
    "createdAt": "2022-07-19 08:14:43",
    "updatedAt": "2022-07-19 08:14:43"
  },
  {
    "id": 7,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 5,
    "createdAt": "2022-07-19 08:14:43",
    "updatedAt": "2022-08-04 13:51:52"
  },
  {
    "id": 8,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 22,
    "createdAt": "2022-07-19 08:17:31",
    "updatedAt": "2022-08-04 13:51:52"
  },
  {
    "id": 9,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 3,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 7,
    "createdAt": "2022-07-19 08:17:31",
    "updatedAt": "2022-07-19 08:17:31"
  },
  {
    "id": 10,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 3,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 8,
    "createdAt": "2022-07-19 08:18:41",
    "updatedAt": "2022-07-19 08:18:41"
  },
  {
    "id": 11,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 3,
    "isHot": 1,
    "timePost": "1659596024704",
    "detailPostId": 9,
    "createdAt": "2022-07-19 08:18:41",
    "updatedAt": "2022-07-19 08:18:41"
  },
  {
    "id": 12,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 3,
    "isHot": 1,
    "timePost": "1659596024704",
    "detailPostId": 10,
    "createdAt": "2022-07-19 08:20:07",
    "updatedAt": "2022-07-19 08:20:07"
  },
  {
    "id": 13,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 3,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 11,
    "createdAt": "2022-07-19 08:20:07",
    "updatedAt": "2022-07-29 13:52:01"
  },
  {
    "id": 18,
    "statusCode": "PS1",
    "timeEnd": "1661187600000",
    "userId": 2,
    "isHot": 0,
    "timePost": "1659596024704",
    "detailPostId": 21,
    "createdAt": "2022-07-23 11:28:09",
    "updatedAt": "2022-07-29 13:58:42"
  },
  {
    "id": 19,
    "statusCode": "PS1",
    "timeEnd": "1661360400000",
    "userId": 2,
    "isHot": 0,
    "timePost": "1660126448974",
    "detailPostId": 23,
    "createdAt": "2022-07-31 16:45:16",
    "updatedAt": "2022-08-10 17:14:08"
  },
  {
    "id": 20,
    "statusCode": "PS1",
    "timeEnd": "1661360400000",
    "userId": 2,
    "isHot": 1,
    "timePost": "1660982444020",
    "detailPostId": 24,
    "createdAt": "2022-07-31 16:46:44",
    "updatedAt": "2022-08-20 15:00:44"
  },
  {
    "id": 21,
    "statusCode": "PS1",
    "timeEnd": "1660880012795",
    "userId": 2,
    "isHot": 1,
    "timePost": "1661176793766",
    "detailPostId": 4,
    "createdAt": "2022-08-19 10:27:06",
    "updatedAt": "2022-08-22 20:59:53"
  },
  {
    "id": 22,
    "statusCode": "PS1",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": "1661176756780",
    "detailPostId": 25,
    "createdAt": "2022-08-22 20:42:35",
    "updatedAt": "2022-08-22 20:59:16"
  },
  {
    "id": 23,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:25",
    "updatedAt": "2022-08-22 21:13:25"
  },
  {
    "id": 24,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:31",
    "updatedAt": "2022-08-22 21:13:31"
  },
  {
    "id": 25,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:33",
    "updatedAt": "2022-08-22 21:13:33"
  },
  {
    "id": 26,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:35",
    "updatedAt": "2022-08-22 21:13:35"
  },
  {
    "id": 27,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:37",
    "updatedAt": "2022-08-22 21:13:37"
  },
  {
    "id": 28,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:42",
    "updatedAt": "2022-08-22 21:13:42"
  },
  {
    "id": 29,
    "statusCode": "PS3",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:13:44",
    "updatedAt": "2022-08-22 21:13:44"
  },
  {
    "id": 30,
    "statusCode": "PS2",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": null,
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:14:38",
    "updatedAt": "2022-08-23 13:59:05"
  },
  {
    "id": 31,
    "statusCode": "PS1",
    "timeEnd": "1662742800000",
    "userId": 18,
    "isHot": 0,
    "timePost": "1661237876600",
    "detailPostId": 25,
    "createdAt": "2022-08-22 21:14:40",
    "updatedAt": "2022-08-23 13:57:56"
  },
  {
    "id": 32,
    "statusCode": "PS1",
    "timeEnd": "1662742800000",
    "userId": 19,
    "isHot": 1,
    "timePost": "1661410308243",
    "detailPostId": 27,
    "createdAt": "2022-08-25 13:43:47",
    "updatedAt": "2022-08-25 13:51:48"
  },
  {
    "id": 33,
    "statusCode": "PS1",
    "timeEnd": "1662051600000",
    "userId": 19,
    "isHot": 1,
    "timePost": "1661481649184",
    "detailPostId": 27,
    "createdAt": "2022-08-25 13:52:39",
    "updatedAt": "2022-08-26 09:40:49"
  },
  {
    "id": 34,
    "statusCode": "PS1",
    "timeEnd": "1662742800000",
    "userId": 20,
    "isHot": 1,
    "timePost": "1661696284650",
    "detailPostId": 29,
    "createdAt": "2022-08-28 21:13:34",
    "updatedAt": "2022-08-28 21:18:04"
  },
  {
    "id": 35,
    "statusCode": "PS3",
    "timeEnd": "1663693200000",
    "userId": 20,
    "isHot": 1,
    "timePost": null,
    "detailPostId": 29,
    "createdAt": "2022-08-28 21:45:27",
    "updatedAt": "2022-08-28 21:45:27"
  },
  {
    "id": 36,
    "statusCode": "PS3",
    "timeEnd": "1665162000000",
    "userId": 24,
    "isHot": 1,
    "timePost": null,
    "detailPostId": 30,
    "createdAt": "2022-09-02 19:24:43",
    "updatedAt": "2022-09-02 19:24:43"
  },
  {
    "id": 37,
    "statusCode": "PS1",
    "timeEnd": "1665162000000",
    "userId": 24,
    "isHot": 1,
    "timePost": "1662123223322",
    "detailPostId": 32,
    "createdAt": "2022-09-02 19:33:21",
    "updatedAt": "2022-09-02 19:53:43"
  },
  {
    "id": 39,
    "statusCode": "PS3",
    "timeEnd": "1665162000000",
    "userId": 25,
    "isHot": 1,
    "timePost": null,
    "detailPostId": 34,
    "createdAt": "2022-09-03 14:51:42",
    "updatedAt": "2022-09-03 14:51:42"
  },
  {
    "id": 40,
    "statusCode": "PS1",
    "timeEnd": "1665162000000",
    "userId": 26,
    "isHot": 1,
    "timePost": "1662191829725",
    "detailPostId": 36,
    "createdAt": "2022-09-03 14:55:04",
    "updatedAt": "2022-09-03 14:57:09"
  },
  {
    "id": 41,
    "statusCode": "PS3",
    "timeEnd": "1664816400000",
    "userId": 26,
    "isHot": 1,
    "timePost": null,
    "detailPostId": 36,
    "createdAt": "2022-09-03 15:02:55",
    "updatedAt": "2022-09-03 15:02:55"
  },
  {
    "id": 42,
    "statusCode": "PS1",
    "timeEnd": "1664384400000",
    "userId": 29,
    "isHot": 1,
    "timePost": "1662820517888",
    "detailPostId": 37,
    "createdAt": "2022-09-10 21:34:49",
    "updatedAt": "2022-09-10 21:35:17"
  },
  {
    "id": 43,
    "statusCode": "PS3",
    "timeEnd": "1664557200000",
    "userId": 29,
    "isHot": 1,
    "timePost": null,
    "detailPostId": 37,
    "createdAt": "2022-09-10 21:38:21",
    "updatedAt": "2022-09-10 21:38:21"
  },
  {
    "id": 44,
    "statusCode": "PS1",
    "timeEnd": "1672419600000",
    "userId": 32,
    "isHot": 1,
    "timePost": "1670939086773",
    "detailPostId": 39,
    "createdAt": "2022-12-13 20:30:35",
    "updatedAt": "2022-12-13 20:44:46"
  },
  {
    "id": 45,
    "statusCode": "PS1",
    "timeEnd": "1672419600000",
    "userId": 34,
    "isHot": 1,
    "timePost": "1671072354000",
    "detailPostId": 40,
    "createdAt": "2022-12-15 09:45:21",
    "updatedAt": "2022-12-15 09:45:54"
  },
  {
    "id": 46,
    "statusCode": "PS1",
    "timeEnd": "1672419600000",
    "userId": 34,
    "isHot": 1,
    "timePost": "1671074436249",
    "detailPostId": 41,
    "createdAt": "2022-12-15 10:19:47",
    "updatedAt": "2022-12-15 10:20:36"
  },
  {
    "id": 47,
    "statusCode": "PS1",
    "timeEnd": "1673283600000",
    "userId": 35,
    "isHot": 1,
    "timePost": "1671974159765",
    "detailPostId": 42,
    "createdAt": "2022-12-25 19:58:41",
    "updatedAt": "2022-12-25 20:15:59"
  },
  {
    "id": 48,
    "statusCode": "PS1",
    "timeEnd": "1673024400000",
    "userId": 37,
    "isHot": 0,
    "timePost": "1672035853297",
    "detailPostId": 43,
    "createdAt": "2022-12-26 13:20:50",
    "updatedAt": "2022-12-26 13:24:13"
  }
];
    await queryInterface.bulkInsert('Posts', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Posts', null, {});
  }
};
