'use strict';

/**
 * Seeder dữ liệu mẫu cho bảng `skills` (41 bản ghi).
 * Được sinh tự động từ jobfindtest.sql.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const rows = [
  {
    "id": 1,
    "name": "Reactjs",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 2,
    "name": "Nextjs",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 5,
    "name": "Lý",
    "categoryJobCode": "giao-vien"
  },
  {
    "id": 6,
    "name": "Đàm phán",
    "categoryJobCode": "luat"
  },
  {
    "id": 7,
    "name": "Excel",
    "categoryJobCode": "kinh-te"
  },
  {
    "id": 8,
    "name": "Java",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 9,
    "name": "Nodejs",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 10,
    "name": "JS",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 11,
    "name": "Amazon Web Service",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 12,
    "name": "C#",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 13,
    "name": "MySQL",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 14,
    "name": "MSSQL",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 15,
    "name": "Spring Boot",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 16,
    "name": "Luật dân sự",
    "categoryJobCode": "luat"
  },
  {
    "id": 17,
    "name": "CSS",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 18,
    "name": "HTML",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 19,
    "name": "Problem solving",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 20,
    "name": "Giải quyết vấn đề",
    "categoryJobCode": "bat-dong-san"
  },
  {
    "id": 21,
    "name": "Giải quyết vấn đề",
    "categoryJobCode": "giao-vien"
  },
  {
    "id": 22,
    "name": "Giải quyết vấn đề",
    "categoryJobCode": "kinh-te"
  },
  {
    "id": 23,
    "name": "Giải quyết vấn đề",
    "categoryJobCode": "luat"
  },
  {
    "id": 24,
    "name": "Giải quyết vấn đề",
    "categoryJobCode": "quan-ly-nhan-su"
  },
  {
    "id": 25,
    "name": "Giải quyết vấn đề",
    "categoryJobCode": "truyen-thong"
  },
  {
    "id": 26,
    "name": "Adobe",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 27,
    "name": "Adobe",
    "categoryJobCode": "truyen-thong"
  },
  {
    "id": 28,
    "name": "Vuejs",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 29,
    "name": "Angular",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 30,
    "name": "AI",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 31,
    "name": "Machine Learning",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 32,
    "name": ".NET",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 33,
    "name": "MVC",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 34,
    "name": "SPA",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 35,
    "name": "Restful API",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 36,
    "name": "Agile",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 37,
    "name": "Scrum",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 38,
    "name": "Python",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 39,
    "name": "Blockchain",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 40,
    "name": "Figma",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 41,
    "name": "Jira",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 42,
    "name": "Knockoutjs",
    "categoryJobCode": "cong-nghe-thong-tin"
  },
  {
    "id": 43,
    "name": "MVVM",
    "categoryJobCode": "cong-nghe-thong-tin"
  }
];
    await queryInterface.bulkInsert('Skills', rows, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Skills', null, {});
  }
};
