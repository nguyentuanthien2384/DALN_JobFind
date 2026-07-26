'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `accounts` (35 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "phonenumber": "0795095049",
    "password": "$2a$10$Ys9kQ9aISTyHN5b3pdBG.u0X3CTzsXRPa7frPN.oDiTHFnC7MQPE.",
    "roleCode": "ADMIN",
    "statusCode": "S1",
    "userId": 1,
    "createdAt": "2022-07-19 06:49:31",
    "updatedAt": "2022-08-18 14:54:28"
  },
  {
    "id": 4,
    "phonenumber": "0764188023",
    "password": "$2a$10$lljdWtt1SgX4X3uIFAy4he25MlY7mz57CznrJuHDtZzDwXyUxHEKy",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 2,
    "createdAt": "2022-07-19 06:59:34",
    "updatedAt": "2022-07-24 15:22:28"
  },
  {
    "id": 5,
    "phonenumber": "0785095048",
    "password": "$2a$10$lljdWtt1SgX4X3uIFAy4he25MlY7mz57CznrJuHDtZzDwXyUxHEKy",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 3,
    "createdAt": "2022-07-19 08:24:02",
    "updatedAt": "2022-07-19 08:24:02"
  },
  {
    "id": 6,
    "phonenumber": "0764088024",
    "password": "$2a$10$GG2rfKv4qlzmtT6228unF.Sz0YdoxsZWntIjqg0cttiQA9li3r5O.",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 4,
    "createdAt": "2022-07-21 10:34:34",
    "updatedAt": "2022-07-26 16:32:03"
  },
  {
    "id": 7,
    "phonenumber": "0764088023",
    "password": "$2b$10$.kv90t4ypRFrDPGpeTIcFu8mw0790N9wfl/9jDoX.PN93WlS6/fCW",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 5,
    "createdAt": "2022-07-21 10:39:40",
    "updatedAt": "2025-04-04 01:56:12"
  },
  {
    "id": 8,
    "phonenumber": "0764088022",
    "password": "$2a$10$XLk10fQXlZoU7XcK4QVm/OeED/6H2yI5PIu8ozHl.xlAsc3PYa4.y",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 6,
    "createdAt": "2022-07-21 10:39:57",
    "updatedAt": "2022-07-22 11:19:13"
  },
  {
    "id": 9,
    "phonenumber": "0764088020",
    "password": "$2a$10$9VHXPj/MisR6pntSwLKtsucdKvxwGXFKW761AhEsYPmz54ogFBV9q",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 7,
    "createdAt": "2022-07-21 10:44:30",
    "updatedAt": "2022-07-24 17:13:56"
  },
  {
    "id": 10,
    "phonenumber": "0795095008",
    "password": "$2a$10$aZsHxZvKkYnKA8hWlSgViuJMcLLzQZWTNeFQX7Ky1wKbNCz0JelAa",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 8,
    "createdAt": "2022-07-24 15:30:05",
    "updatedAt": "2022-07-24 15:30:05"
  },
  {
    "id": 11,
    "phonenumber": "0795095041",
    "password": "$2a$10$Ys9kQ9aISTyHN5b3pdBG.u0X3CTzsXRPa7frPN.oDiTHFnC7MQPE.",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 9,
    "createdAt": "2022-08-06 11:19:48",
    "updatedAt": "2022-08-22 20:10:21"
  },
  {
    "id": 12,
    "phonenumber": "0944043559",
    "password": "$2a$10$vj6zd8nXpWwmTNVYpAc02e3Y6odWWezc04Zwvx3FGhCcQeebJ2Sau",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 10,
    "createdAt": "2022-08-20 15:19:52",
    "updatedAt": "2022-08-20 15:23:24"
  },
  {
    "id": 13,
    "phonenumber": "0795095047",
    "password": "$2a$10$7Y/didL0acc8LMlNjRIlyOgB9nBL/FEzNgzgWQqtAA4/0uHJVMm0.",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 14,
    "createdAt": "2022-08-20 15:40:27",
    "updatedAt": "2022-08-20 15:40:27"
  },
  {
    "id": 14,
    "phonenumber": "0795095044",
    "password": "$2a$10$kgFy9DXsqckQAaLva9JJXOcbesp4r30xA3eqv1HAHWy4bSGMBlC7y",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 15,
    "createdAt": "2022-08-21 12:19:05",
    "updatedAt": "2022-08-21 12:19:05"
  },
  {
    "id": 15,
    "phonenumber": "0795095040",
    "password": "$2a$10$Ys9kQ9aISTyHN5b3pdBG.u0X3CTzsXRPa7frPN.oDiTHFnC7MQPE.",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 16,
    "createdAt": "2022-08-21 12:21:22",
    "updatedAt": "2022-08-21 12:21:22"
  },
  {
    "id": 16,
    "phonenumber": "0795095000",
    "password": "$2a$10$yfNa4GF857tbmYuAg/GJp.C0WkdY9Aw3UvsRrjR6pPwQK2yobSg3e",
    "roleCode": "ADMIN",
    "statusCode": "S1",
    "userId": 17,
    "createdAt": "2022-08-21 12:23:09",
    "updatedAt": "2022-08-21 12:31:38"
  },
  {
    "id": 17,
    "phonenumber": "0795095042",
    "password": "$2a$10$Ys9kQ9aISTyHN5b3pdBG.u0X3CTzsXRPa7frPN.oDiTHFnC7MQPE.",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 18,
    "createdAt": "2022-08-22 20:12:20",
    "updatedAt": "2022-08-22 20:28:24"
  },
  {
    "id": 18,
    "phonenumber": "0795095038",
    "password": "$2a$10$ZuQvRA5DOhw443rPyjExSuiMSEyMw70sIIry8C0/WeY56cVxa.XEC",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 19,
    "createdAt": "2022-08-25 13:23:02",
    "updatedAt": "2022-08-25 13:25:05"
  },
  {
    "id": 19,
    "phonenumber": "0795095028",
    "password": "$2a$10$GzJAXB1IIMEZ0PNCS6zaUunDN6OiellgRrqbafYCTWSZGL9brD/uW",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 20,
    "createdAt": "2022-08-28 20:38:51",
    "updatedAt": "2022-08-28 20:43:06"
  },
  {
    "id": 20,
    "phonenumber": "0795095001",
    "password": "$2a$10$IWOfBxyugOTXW3dqJJN/aOpR0YdVQNZGnxJwfccvli1N48UiJl8S2",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 21,
    "createdAt": "2022-08-28 21:03:26",
    "updatedAt": "2022-08-28 21:03:26"
  },
  {
    "id": 21,
    "phonenumber": "0795095002",
    "password": "$2a$10$JjQMCYWM.RPWaNS1ikpAben8Vlqj/y8xxcmTgXfDnTPV6SxlK62ZK",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 22,
    "createdAt": "2022-08-28 21:07:42",
    "updatedAt": "2022-08-28 21:07:42"
  },
  {
    "id": 22,
    "phonenumber": "0795095148",
    "password": "$2a$10$GOpcAbVxCfcSG2JUcoUfZuKfQhC8A4QQfT4O9Rb5K1RDcO6L750Ze",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 23,
    "createdAt": "2022-09-02 18:33:49",
    "updatedAt": "2022-09-02 18:55:18"
  },
  {
    "id": 23,
    "phonenumber": "0795095012",
    "password": "$2a$10$65akSptDl7W1xD6mD4hItuRfJg2Ltwh6AIjKjQ4P/ou1c4AgoA4bW",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 24,
    "createdAt": "2022-09-02 19:18:30",
    "updatedAt": "2022-09-02 19:18:30"
  },
  {
    "id": 24,
    "phonenumber": "0795095248",
    "password": "$2a$10$8tEYVsIXTeIh/8sAKj9z3ukmXc94yGfvHhu2MBLxMjQOlgo5h8u4m",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 25,
    "createdAt": "2022-09-03 14:30:50",
    "updatedAt": "2022-09-03 14:45:15"
  },
  {
    "id": 25,
    "phonenumber": "0795095123",
    "password": "$2a$10$8tEYVsIXTeIh/8sAKj9z3umPK1E24hJAL1jEgRrXMtnBQRBkda1rO",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 26,
    "createdAt": "2022-09-03 14:53:29",
    "updatedAt": "2022-09-03 14:53:29"
  },
  {
    "id": 26,
    "phonenumber": "0795095098",
    "password": "$2a$10$m38Sofay//T37ExYUPk2BeZugTYR6/vDaXt2D1i4hTmpNquIkTgA2",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 27,
    "createdAt": "2022-09-10 15:39:11",
    "updatedAt": "2022-09-10 15:46:32"
  },
  {
    "id": 27,
    "phonenumber": "0795095456",
    "password": "$2a$10$m38Sofay//T37ExYUPk2Begf9zb6KVSJeF6HvmzRGr1SomNswpdky",
    "roleCode": "EMPLOYER",
    "statusCode": "S1",
    "userId": 28,
    "createdAt": "2022-09-10 16:35:46",
    "updatedAt": "2022-09-10 16:35:46"
  },
  {
    "id": 28,
    "phonenumber": "0795095125",
    "password": "$2a$10$GWdggL6U3AfQ.rsveiAj4OF9ZJHYvmG6WADXg6i3y1PbtOs0PxlBK",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 29,
    "createdAt": "2022-09-10 21:26:14",
    "updatedAt": "2022-09-10 21:28:43"
  },
  {
    "id": 29,
    "phonenumber": "0795095768",
    "password": "$2a$10$SF8mxmUAQmfsEJuBcjiQBOliZT6MTBR5n3QjPECUkDm5mYCksqxwW",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 30,
    "createdAt": "2022-11-26 13:52:24",
    "updatedAt": "2022-11-26 13:52:24"
  },
  {
    "id": 30,
    "phonenumber": "0795095789",
    "password": "$2a$10$wIUGToaJX6iEvrBhBDPApelIXlgEZ1fLUVOQyinLBKeMj1aixy8tW",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 31,
    "createdAt": "2022-12-13 20:01:33",
    "updatedAt": "2022-12-13 20:01:33"
  },
  {
    "id": 31,
    "phonenumber": "0795095111",
    "password": "$2a$10$wIUGToaJX6iEvrBhBDPApelIXlgEZ1fLUVOQyinLBKeMj1aixy8tW",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 32,
    "createdAt": "2022-12-13 20:20:23",
    "updatedAt": "2022-12-13 20:23:57"
  },
  {
    "id": 32,
    "phonenumber": "0795095678",
    "password": "$2a$10$k3d/yguorWGIqWYuzNBBFuoLr0wGIRoCIWCTSf6haEVyd9hFpWgzK",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 33,
    "createdAt": "2022-12-13 21:28:58",
    "updatedAt": "2022-12-13 21:28:58"
  },
  {
    "id": 33,
    "phonenumber": "0795095222",
    "password": "$2a$10$sOcvOY1V9gCQYw2O2cQnZOREk/0KYAf7J.zk6b5pyj6r9OGg4cage",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 34,
    "createdAt": "2022-12-15 09:38:42",
    "updatedAt": "2022-12-15 09:40:50"
  },
  {
    "id": 34,
    "phonenumber": "0795095333",
    "password": "$2a$10$mGLKxcVMnZBuJY4NEUIlwusBm6sJ3AW7u3mZo6LssvL7Aq27Mn/OO",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 35,
    "createdAt": "2022-12-25 15:30:26",
    "updatedAt": "2022-12-25 19:53:19"
  },
  {
    "id": 35,
    "phonenumber": "0764188123",
    "password": "$2a$10$q2fcrtyCytWdGfywDn57iubTNOV5DuDpT8YJGf5Cmbhg4cbhjk2uy",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 36,
    "createdAt": "2022-12-25 20:24:42",
    "updatedAt": "2022-12-25 20:24:42"
  },
  {
    "id": 36,
    "phonenumber": "0764188024",
    "password": "$2a$10$q2fcrtyCytWdGfywDn57iubTNOV5DuDpT8YJGf5Cmbhg4cbhjk2uy",
    "roleCode": "COMPANY",
    "statusCode": "S1",
    "userId": 37,
    "createdAt": "2022-12-25 20:49:53",
    "updatedAt": "2022-12-26 13:17:43"
  },
  {
    "id": 37,
    "phonenumber": "0762216048",
    "password": "$2b$10$.kv90t4ypRFrDPGpeTIcFu8mw0790N9wfl/9jDoX.PN93WlS6/fCW",
    "roleCode": "CANDIDATE",
    "statusCode": "S1",
    "userId": 38,
    "createdAt": "2025-04-04 01:56:39",
    "updatedAt": "2025-04-04 01:56:39"
  }
];
    await queryInterface.bulkInsert('Accounts', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Accounts', null, {});
  }
};
