'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `users` (35 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652631754/dev_setups/idoll3tndocylttjiwfn.jpg",
    "dob": "947782800000",
    "companyId": null
  },
  {
    "id": 2,
    "firstName": "Nguyễn Văn",
    "lastName": "A",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652631754/dev_setups/idoll3tndocylttjiwfn.jpg",
    "dob": "947782800000",
    "companyId": 6
  },
  {
    "id": 3,
    "firstName": "Nguyễn Lê",
    "lastName": "Tấn",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652631754/dev_setups/idoll3tndocylttjiwfn.jpg",
    "dob": "947782800000",
    "companyId": 7
  },
  {
    "id": 4,
    "firstName": "Lê Thị Kim",
    "lastName": "Ảnh",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652631754/dev_setups/idoll3tndocylttjiwfn.jpg",
    "dob": "1658595600000",
    "companyId": null
  },
  {
    "id": 5,
    "firstName": "Lê Thị Kim",
    "lastName": "Ảnh11",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661053526/dev_setups/blm0wg0elmx3plksh1aq.jpg",
    "dob": "1594400400000",
    "companyId": null
  },
  {
    "id": 6,
    "firstName": "Lê Thị Kim",
    "lastName": "Ảnh",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652631754/dev_setups/idoll3tndocylttjiwfn.jpg",
    "dob": "1658595600000",
    "companyId": 10
  },
  {
    "id": 7,
    "firstName": "Lê Thị Kim",
    "lastName": "Ảnh",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652631754/dev_setups/idoll3tndocylttjiwfn.jpg",
    "dob": "962816400000",
    "companyId": 9
  },
  {
    "id": 8,
    "firstName": "Nguyễn Văn",
    "lastName": "B",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1658651404/dev_setups/l60Hf_blyqhb_lgm1gk.png",
    "dob": "962730000000",
    "companyId": 6
  },
  {
    "id": 9,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": "Quận 12",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1659759587/dev_setups/l60Hf_blyqhb_hucil6.png",
    "dob": null,
    "companyId": null
  },
  {
    "id": 10,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1660983589/dev_setups/l60Hf_blyqhb_uhk9b6.png",
    "dob": null,
    "companyId": 11
  },
  {
    "id": 14,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": "Quận 10",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1660984827/dev_setups/l60Hf_blyqhb_uonxjx.png",
    "dob": "966445200000",
    "companyId": 11
  },
  {
    "id": 15,
    "firstName": "123123123",
    "lastName": "123123",
    "email": "example@gmail.com",
    "address": "Quận 10",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661059145/dev_setups/l60Hf_blyqhb_txmnlh.png",
    "dob": "966358800000",
    "companyId": null
  },
  {
    "id": 16,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài2",
    "email": "example@gmail.com",
    "address": "Quận 11",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661059282/dev_setups/l60Hf_blyqhb_s2vlsd.png",
    "dob": "966963600000",
    "companyId": 8
  },
  {
    "id": 17,
    "firstName": "Nguyễn Văn",
    "lastName": "ADMIN",
    "email": "example@gmail.com",
    "address": "Quận 7",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661059830/dev_setups/chdageg33j6wnyxga0at.jpg",
    "dob": "965062800000",
    "companyId": null
  },
  {
    "id": 18,
    "firstName": "Nguyễn Văn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661173940/dev_setups/l60Hf_blyqhb_ccgua8.png",
    "dob": null,
    "companyId": 12
  },
  {
    "id": 19,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661408582/dev_setups/l60Hf_blyqhb_gflnmh.png",
    "dob": null,
    "companyId": 13
  },
  {
    "id": 20,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "D",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661693929/dev_setups/l60Hf_blyqhb_xdvjce.png",
    "dob": null,
    "companyId": 14
  },
  {
    "id": 21,
    "firstName": "Nguyễn Văn",
    "lastName": "Trọng",
    "email": "example@gmail.com",
    "address": "Quận 10",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661695404/dev_setups/l60Hf_blyqhb_kimy0o.png",
    "dob": "965926800000",
    "companyId": null
  },
  {
    "id": 22,
    "firstName": "Bùi Thị",
    "lastName": "Tâm",
    "email": "example@gmail.com",
    "address": "Quận 10",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1661695660/dev_setups/l60Hf_blyqhb_dl45wo.png",
    "dob": "966531600000",
    "companyId": 14
  },
  {
    "id": 23,
    "firstName": "Nguyễn Văn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662118427/dev_setups/l60Hf_blyqhb_bkianl.png",
    "dob": null,
    "companyId": 15
  },
  {
    "id": 24,
    "firstName": "Nguyễn Văn",
    "lastName": "Viên",
    "email": "example@gmail.com",
    "address": "Quận 10",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662121108/dev_setups/l60Hf_blyqhb_iehfam.png",
    "dob": "967741200000",
    "companyId": 15
  },
  {
    "id": 25,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662190248/dev_setups/l60Hf_blyqhb_a7nub3.png",
    "dob": null,
    "companyId": 16
  },
  {
    "id": 26,
    "firstName": "Nguyên Văn",
    "lastName": "H",
    "email": "example@gmail.com",
    "address": "Quận 10",
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662191606/dev_setups/l60Hf_blyqhb_rt2yu6.png",
    "dob": "968000400000",
    "companyId": 16
  },
  {
    "id": 27,
    "firstName": "Nguyễn Thị",
    "lastName": "A",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662799150/dev_setups/l60Hf_blyqhb_blny2o.png",
    "dob": null,
    "companyId": 17
  },
  {
    "id": 28,
    "firstName": "Nguyễn Thị",
    "lastName": "Na",
    "email": "example@gmail.com",
    "address": "Quận 12",
    "genderCode": "FE",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662802544/dev_setups/l60Hf_blyqhb_kmbm6o.png",
    "dob": "968864400000",
    "companyId": 17
  },
  {
    "id": 29,
    "firstName": "Nguyễn Văn",
    "lastName": "Lộc",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": "M",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662819972/dev_setups/l60Hf_blyqhb_l8uw2q.png",
    "dob": null,
    "companyId": 18
  },
  {
    "id": 30,
    "firstName": "Nguyễn Lê Tấn",
    "lastName": "Tài",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1669445543/dev_setups/l60Hf_blyqhb_lctqgo.png",
    "dob": null,
    "companyId": null
  },
  {
    "id": 31,
    "firstName": "Trần Văn",
    "lastName": "Kha",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1670936494/dev_setups/l60Hf_blyqhb_mx2pa6.png",
    "dob": null,
    "companyId": null
  },
  {
    "id": 32,
    "firstName": "Trần Văn",
    "lastName": "Chiến",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1670937624/dev_setups/l60Hf_blyqhb_itj0fs.png",
    "dob": null,
    "companyId": 19
  },
  {
    "id": 33,
    "firstName": "Trần Văn",
    "lastName": "Nghĩa",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1670941739/dev_setups/l60Hf_blyqhb_nqdyma.png",
    "dob": null,
    "companyId": null
  },
  {
    "id": 34,
    "firstName": "Trần Văn",
    "lastName": "Nghĩa",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1671071922/dev_setups/l60Hf_blyqhb_erojhz.png",
    "dob": null,
    "companyId": 20
  },
  {
    "id": 35,
    "firstName": "Nguyễn Văn",
    "lastName": "Nhật",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1671957023/dev_setups/l60Hf_blyqhb_cpn5vn.png",
    "dob": null,
    "companyId": 21
  },
  {
    "id": 36,
    "firstName": "Trần Thị",
    "lastName": "My",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1671974681/dev_setups/l60Hf_blyqhb_l75yre.png",
    "dob": null,
    "companyId": null
  },
  {
    "id": 37,
    "firstName": "Trần Minh",
    "lastName": "Tiến",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1671976192/dev_setups/l60Hf_blyqhb_kjp3fc.png",
    "dob": null,
    "companyId": 22
  },
  {
    "id": 38,
    "firstName": "Thanh",
    "lastName": "Do Tan",
    "email": "example@gmail.com",
    "address": null,
    "genderCode": null,
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1743706593/dev_setups/l60Hf_blyqhb_kywjvk.png",
    "dob": null,
    "companyId": null
  }
];
    await queryInterface.bulkInsert('Users', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Users', null, {});
  }
};
