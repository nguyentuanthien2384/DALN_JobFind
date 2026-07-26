# Job Finder

## Cấu trúc dự án

- `backend`: API Node.js/Express, Sequelize và script nạp dữ liệu.
- `frontend`: giao diện React.
- `database/jobfindtest.sql`: dữ liệu mẫu nguyên gốc từ `JobFindResourceV2.1.zip`.

## Chạy dự án

1. Cấu hình MySQL trong `backend/.env` với các biến `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
2. Khôi phục dữ liệu mẫu theo [RESTORE_SAMPLE_DATA.md](RESTORE_SAMPLE_DATA.md).
3. Chạy API:

   ```powershell
   cd backend
   npm install
   npm start
   ```

4. Chạy giao diện:

   ```powershell
   cd frontend
   npm install
   npm start
   ```
