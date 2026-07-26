'use strict';

const bcrypt = require('bcryptjs');

/**
 * Tài khoản đăng nhập TEST với mật khẩu đã biết = "123456".
 * Mật khẩu được hash lúc chạy bằng bcryptjs (đã có trong dependencies),
 * nên không cần hard-code hash.
 *
 *  SĐT (đăng nhập)   | Vai trò    | Mật khẩu
 *  ------------------|-----------|---------
 *  0900000001        | ADMIN     | 123456
 *  0900000002        | COMPANY   | 123456
 *  0900000003        | CANDIDATE | 123456
 *
 * userId ánh xạ sang user có sẵn trong seeder users (id 1 = admin, 2 = company, 5 = candidate).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const hash = bcrypt.hashSync('123456', 10);
    await queryInterface.bulkInsert('Accounts', [
      {
        id: 9001,
        phonenumber: '0900000001',
        password: hash,
        roleCode: 'ADMIN',
        statusCode: 'S1',
        userId: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 9002,
        phonenumber: '0900000002',
        password: hash,
        roleCode: 'COMPANY',
        statusCode: 'S1',
        userId: 2,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 9003,
        phonenumber: '0900000003',
        password: hash,
        roleCode: 'CANDIDATE',
        statusCode: 'S1',
        userId: 5,
        createdAt: now,
        updatedAt: now
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Accounts', {
      phonenumber: ['0900000001', '0900000002', '0900000003']
    }, {});
  }
};
