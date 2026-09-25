'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `allcodes` (53 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "code": "1-nam",
    "type": "EXPTYPE",
    "value": "1 năm",
    "image": ""
  },
  {
    "code": "10-15tr",
    "type": "SALARYTYPE",
    "value": "10-15 triệu",
    "image": ""
  },
  {
    "code": "2-nam",
    "type": "EXPTYPE",
    "value": "2 năm",
    "image": ""
  },
  {
    "code": "3-5tr",
    "type": "SALARYTYPE",
    "value": "3 - 5 triệu",
    "image": ""
  },
  {
    "code": "3nam",
    "type": "EXPTYPE",
    "value": "3 năm",
    "image": ""
  },
  {
    "code": "ADMIN",
    "type": "ROLE",
    "value": "Quản trị",
    "image": null
  },
  {
    "code": "An Giang",
    "type": "PROVINCE",
    "value": "An Giang",
    "image": null
  },
  {
    "code": "Bà Rịa – Vũng Tàu",
    "type": "PROVINCE",
    "value": "Bà Rịa – Vũng Tàu",
    "image": null
  },
  {
    "code": "Bắc Giang",
    "type": "PROVINCE",
    "value": "Bắc Giang",
    "image": null
  },
  {
    "code": "Bắc Kạn",
    "type": "PROVINCE",
    "value": "Bắc Kạn",
    "image": null
  },
  {
    "code": "Bạc Liêu",
    "type": "PROVINCE",
    "value": "Bạc Liêu",
    "image": null
  },
  {
    "code": "Bắc Ninh",
    "type": "PROVINCE",
    "value": "Bắc Ninh",
    "image": null
  },
  {
    "code": "bat-dong-san",
    "type": "JOBTYPE",
    "value": "Bất động sản",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1671071744/dev_setups/blvvjrk05lhknjukqgax_lcqugl_k78pll_sfllhk.png"
  },
  {
    "code": "Bến Tre",
    "type": "PROVINCE",
    "value": "Bến Tre",
    "image": null
  },
  {
    "code": "Bình Dương",
    "type": "PROVINCE",
    "value": "Bình Dương",
    "image": null
  },
  {
    "code": "Bình Phước",
    "type": "PROVINCE",
    "value": "Bình Phước",
    "image": null
  },
  {
    "code": "Bình Thuận",
    "type": "PROVINCE",
    "value": "Bình Thuận",
    "image": null
  },
  {
    "code": "Bình Định",
    "type": "PROVINCE",
    "value": "Bình Định",
    "image": null
  },
  {
    "code": "Cà Mau",
    "type": "PROVINCE",
    "value": "Cà Mau",
    "image": null
  },
  {
    "code": "ca-hai",
    "type": "GENDERPOST",
    "value": "Cả hai",
    "image": null
  },
  {
    "code": "Cần Thơ",
    "type": "PROVINCE",
    "value": "Cần Thơ",
    "image": null
  },
  {
    "code": "CANDIDATE",
    "type": "ROLE",
    "value": "Ứng viên",
    "image": null
  },
  {
    "code": "Cao Bằng",
    "type": "PROVINCE",
    "value": "Cao Bằng",
    "image": null
  },
  {
    "code": "COMPANY",
    "type": "ROLE",
    "value": "Công ty",
    "image": null
  },
  {
    "code": "cong-nghe-thong-tin",
    "type": "JOBTYPE",
    "value": "Công nghệ thông tin",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1642571312/dev_setups/n2uhnbfl2gcni5ykcf3l.png"
  },
  {
    "code": "CS1",
    "type": "CENSORSTATUS",
    "value": "Đã kiểm duyệt",
    "image": null
  },
  {
    "code": "CS2",
    "type": "CENSORSTATUS",
    "value": "Chưa kiểm duyệt",
    "image": null
  },
  {
    "code": "CS3",
    "type": "CENSORSTATUS",
    "value": "Đang chờ kiểm duyệt",
    "image": null
  },
  {
    "code": "EMPLOYER",
    "type": "ROLE",
    "value": "Người tuyển dụng",
    "image": null
  },
  {
    "code": "FE",
    "type": "GENDER",
    "value": "Nữ",
    "image": null
  },
  {
    "code": "fulltime",
    "type": "WORKTYPE",
    "value": "Toàn thời gian",
    "image": ""
  },
  {
    "code": "giam-doc",
    "type": "JOBLEVEL",
    "value": "Giám đốc",
    "image": ""
  },
  {
    "code": "giao-vien",
    "type": "JOBTYPE",
    "value": "Giáo viên",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662819886/dev_setups/u5kf8v6fkcj95alvfytl.png"
  },
  {
    "code": "kinh-te",
    "type": "JOBTYPE",
    "value": "Kinh tế",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652633795/dev_setups/glmujvsadqboz5eby9gb.png"
  },
  {
    "code": "luat",
    "type": "JOBTYPE",
    "value": "Luật",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652633485/dev_setups/gwboeujjnqkffhl15me1.png"
  },
  {
    "code": "M",
    "type": "GENDER",
    "value": "Nam",
    "image": null
  },
  {
    "code": "nam-post",
    "type": "GENDERPOST",
    "value": "Nam",
    "image": null
  },
  {
    "code": "nhan-vien",
    "type": "JOBLEVEL",
    "value": "Nhân viên",
    "image": ""
  },
  {
    "code": "nu-post",
    "type": "GENDERPOST",
    "value": "Nữ",
    "image": null
  },
  {
    "code": "part-time",
    "type": "WORKTYPE",
    "value": "Bán thời gian",
    "image": ""
  },
  {
    "code": "PS1",
    "type": "POSTSTATUS",
    "value": "Đã kiểm duyệt",
    "image": null
  },
  {
    "code": "PS2",
    "type": "POSTSTATUS",
    "value": "Đã bị từ chối",
    "image": null
  },
  {
    "code": "PS3",
    "type": "POSTSTATUS",
    "value": "Chờ kiểm duyệt",
    "image": null
  },
  {
    "code": "PS4",
    "type": "POSTSTATUS",
    "value": "Đã bị chặn",
    "image": null
  },
  {
    "code": "quan-ly-nhan-su",
    "type": "JOBTYPE",
    "value": "Quản lý nhân sự",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1662190751/dev_setups/ywcvdydyfob61ctftpcj.png"
  },
  {
    "code": "remote",
    "type": "WORKTYPE",
    "value": "Remote",
    "image": ""
  },
  {
    "code": "S1",
    "type": "STATUS",
    "value": "Đã kích hoạt",
    "image": null
  },
  {
    "code": "S2",
    "type": "STATUS",
    "value": "Không kích hoạt",
    "image": null
  },
  {
    "code": "thoa-thuan",
    "type": "SALARYTYPE",
    "value": "Thoả thuận",
    "image": ""
  },
  {
    "code": "thuc-tap",
    "type": "WORKTYPE",
    "value": "Thực tập",
    "image": ""
  },
  {
    "code": "truong-phong",
    "type": "JOBLEVEL",
    "value": "Trưởng phòng",
    "image": ""
  },
  {
    "code": "truyen-thong",
    "type": "JOBTYPE",
    "value": "Truyền thông",
    "image": "http://res.cloudinary.com/bingo2706/image/upload/v1652633755/dev_setups/rekymnl5o5znzme0ij37.png"
  },
  {
    "code": "Đà Nẵng",
    "type": "PROVINCE",
    "value": "Đà Nẵng",
    "image": null
  }
];
    await queryInterface.bulkInsert('Allcodes', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Allcodes', null, {});
  }
};
