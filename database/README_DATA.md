# Dữ liệu mẫu cho JobFind (project_source)

Thư mục này bổ sung **dữ liệu mẫu** cho `project_source` — vốn ban đầu chỉ có code
mà không kèm data như bản `JobFindResourceV2_1`. Bạn có **2 cách** để nạp dữ liệu,
chọn cách nào tùy tình huống.

> Lưu ý cấu trúc thư mục: trong `project_source`, phần **API/backend Node.js**
> nằm ở thư mục `frontend/` (chứa `src/models`, `src/migrations`, `src/seeders`),
> còn phần **giao diện React** nằm ở `backend/`. Tên thư mục bị đặt ngược so với
> vai trò thực, nhưng theo yêu cầu ta **giữ nguyên tên**.

---

## Cách 1 — Import trực tiếp file SQL dump (nhanh nhất)

Dùng khi bạn muốn có ngay toàn bộ dữ liệu gốc (kể cả CV base64 trong `usersettings`).

1. Tạo database rỗng tên `jobfindtest` (khớp `frontend/src/config/config.json`).
2. Import file `database/jobfindtest.sql`:

   **Bằng dòng lệnh MySQL/MariaDB:**
   ```bash
   mysql -u root jobfindtest < database/jobfindtest.sql
   ```

   **Hoặc bằng phpMyAdmin:** chọn DB `jobfindtest` → tab *Import* → chọn
   `jobfindtest.sql` → *Go*.

File dump đã bao gồm cả cấu trúc bảng lẫn dữ liệu và ràng buộc khóa ngoại,
nên **không cần** chạy migration khi dùng cách này.

---

## Cách 2 — Chạy migration + seeder Sequelize (linh hoạt, sạch)

Dùng khi bạn muốn khởi tạo schema từ code và nạp data có kiểm soát,
hoặc muốn reset lại data nhiều lần trong lúc phát triển.

Chạy trong thư mục `frontend/` (nơi chứa Sequelize):

```bash
cd frontend
npm install

# 1. Tạo database (nếu chưa có)
npx sequelize-cli db:create

# 2. Tạo bảng từ migrations
npx sequelize-cli db:migrate

# 3. Nạp dữ liệu mẫu từ seeders
npx sequelize-cli db:seed:all
```

Muốn xoá sạch data mẫu (giữ nguyên bảng):
```bash
npx sequelize-cli db:seed:undo:all
```

### Các seeder được sinh ra (`frontend/src/seeders/`)

| Thứ tự | Bảng            | Số bản ghi | Ghi chú |
|-------:|-----------------|-----------:|---------|
| 01 | allcodes        | 53 | Danh mục: ngành nghề, khu vực, mức lương, kinh nghiệm… |
| 02 | packageposts    | 5  | Gói đăng tin |
| 03 | packagecvs      | 4  | Gói xem CV |
| 04 | skills          | 41 | Kỹ năng |
| 05 | companies       | 17 | 8 công ty gốc + 9 bổ sung* |
| 06 | users           | 35 | Hồ sơ người dùng |
| 07 | accounts        | 35 | Tài khoản đăng nhập (mật khẩu gốc – hash bcrypt) |
| 08 | usersettings    | 6  | Cấu hình tìm việc + CV |
| 09 | userskills      | 31 | Bảng nối user–skill |
| 10 | detailposts     | 28 | 4 gốc + 24 bổ sung* |
| 11 | posts           | 41 | Tin tuyển dụng |
| 12 | notes           | 31 | Ghi chú ứng viên |
| 13 | orderpackages   | 25 | Đơn mua gói đăng tin |
| 14 | orderpackagecvs | 1  | Đơn mua gói CV |
| 15 | test-accounts   | 3  | **Tài khoản test mật khẩu biết trước** (xem bên dưới) |

\* **Vì sao có bản ghi bổ sung?** File dump gốc bị thiếu một số `detailposts`
và `companies` mà `posts`/`users` lại tham chiếu tới (lỗi toàn vẹn có sẵn trong
dump gốc). Nếu seed nguyên trạng khi bật ràng buộc khóa ngoại sẽ lỗi. Các seeder
đã tự **bổ sung các bản ghi còn thiếu** (nhân bản từ bản gốc, đổi id/tên) để giữ
đủ 41 tin tuyển dụng mà vẫn toàn vẹn khoá ngoại.

---

## Tài khoản đăng nhập

### Tài khoản TEST (mật khẩu biết trước) — chỉ có khi dùng **Cách 2**
Seeder `…015-demo-test-accounts.js` tạo sẵn, mật khẩu đều là `123456`:

| Số điện thoại | Vai trò   | Mật khẩu |
|---------------|-----------|----------|
| 0900000001    | ADMIN     | 123456   |
| 0900000002    | COMPANY   | 123456   |
| 0900000003    | CANDIDATE | 123456   |

### Tài khoản gốc (từ dump) — có ở **cả 2 cách**
Mật khẩu là bcrypt hash không đọc ngược được. Một số SĐT tham khảo:
`0795095049` (ADMIN), `0764188023` (COMPANY), `0764088023` (CANDIDATE)…
Nếu không biết mật khẩu, hãy dùng tài khoản TEST ở trên, hoặc cập nhật lại
password hash trong DB.

---

## Cấu hình môi trường

- `frontend/src/config/config.json`: DB `jobfindtest`, host `127.0.0.1`,
  user `root`, password `null` — sửa lại cho khớp máy bạn.
- `frontend/.env`: đã tạo sẵn từ mẫu (PORT, JWT_SECRET, Cloudinary, PayPal…).
  Nhớ thay `EMAIL_APP` / `EMAIL_APP_PASSWORD` bằng thông tin thật nếu cần gửi mail.


---

## Quy trình cài đặt đầy đủ (đối chiếu theo video `HuongDanCaiDat.mp4`)

1. Cài **XAMPP** (MySQL/MariaDB + phpMyAdmin) và **Node.js**.
2. Bật **Apache + MySQL** trong XAMPP Control Panel.
3. Vào `http://localhost/phpmyadmin` → tạo database **`jobfindtest`**
   (collation `utf8mb4_unicode_ci`) → tab **Import** → chọn `database/jobfindtest.sql` → **Go**.
   *(Hoặc dùng Cách 2 migration + seeder bên trên thay cho bước import.)*
4. Mở thư mục **`frontend/`** (API Node.js):
   ```bash
   cd frontend
   npm install
   npm start        # API chạy ở http://localhost:5000
   ```
5. Mở thư mục **`backend/`** (giao diện React):
   ```bash
   cd backend
   npm install
   npm start        # Web chạy ở http://localhost:3000
   ```
6. Truy cập `http://localhost:3000` → trang chủ đã có đầy đủ tin tuyển dụng,
   công ty, gói dịch vụ… giống bản JobFind gốc.

> Cấu hình đã khớp sẵn: API port `5000`, React port `3000`,
> `URL_REACT=http://localhost:3000` (CORS), React gọi API qua `http://localhost:5000`.

---

## Ghi chú kỹ thuật (bản cập nhật)

- **Tên bảng trong seeders đã được sửa** để khớp chính xác với tên bảng trong
  migrations (`Users`, `Posts`, `DetailPosts`, `OrderPackageCVs`, …).
  Nhờ vậy Cách 2 chạy được trên **cả Windows lẫn Linux/macOS**
  (MySQL trên Linux phân biệt chữ hoa/thường trong tên bảng, bản cũ dùng
  tên chữ thường sẽ báo lỗi "table doesn't exist").
- Bảng `accounts` sau khi seed có **38** bản ghi = 35 tài khoản gốc + 3 tài khoản TEST.
- Đã kiểm tra tự động: toàn bộ seeder hợp lệ cú pháp, không có bản ghi nào
  vi phạm khóa ngoại (accounts→users, users↔companies, posts→detailposts/users,
  notes, orderpackages, userskills, usersettings…).

---

## Tính năng mới bổ sung (bản phát triển thêm)

Ba tính năng mới đã được thêm để dự án giống các trang tuyển dụng thực tế:

1. **Lưu tin tuyển dụng** — nút trái tim "Lưu tin" ở trang chi tiết việc làm,
   trang "Việc làm đã lưu" tại `/candidate/saved-jobs` (menu tài khoản ứng viên).
   Bảng mới: `FavoritePosts`. API: `POST /api/toggle-favorite-post`,
   `GET /api/check-favorite-post`, `GET /api/get-favorite-post-by-user`.
2. **Đánh giá công ty** — chấm sao 1–5 + viết cảm nhận ở trang chi tiết công ty,
   hiển thị điểm trung bình và danh sách đánh giá. Bảng mới: `CompanyReviews`.
   API: `POST /api/create-company-review`, `GET /api/get-review-by-company`,
   `POST /api/delete-company-review`.
3. **Việc làm tương tự** — gợi ý 5 tin cùng lĩnh vực đang hoạt động dưới mô tả
   công việc. API: `GET /api/get-related-post`.

### Cách kích hoạt

- **Nếu dựng DB mới bằng Cách 2:** chạy bình thường
  `npx sequelize-cli db:migrate` rồi `npx sequelize-cli db:seed:all`
  (đã bao gồm 2 bảng mới + data mẫu: 7 tin đã lưu, 10 đánh giá công ty).
- **Nếu đã import SQL dump (Cách 1) từ trước:** chỉ cần tạo thêm 2 bảng mới
  và nạp data mẫu cho chúng:
  ```bash
  cd frontend
  npx sequelize-cli db:migrate                    # chỉ chạy 2 migration mới còn thiếu
  npx sequelize-cli db:seed --seed 20250101000016-demo-favoriteposts.js
  npx sequelize-cli db:seed --seed 20250101000017-demo-companyreviews.js
  ```
  Lưu ý: khi DB dựng từ dump SQL, bảng `sequelizemeta` đã đánh dấu 16 migration cũ
  là đã chạy, nên `db:migrate` sẽ chỉ tạo 2 bảng mới. Nếu gặp lỗi tên migration
  chưa được đánh dấu, có thể tạo bảng thủ công bằng phpMyAdmin theo cấu trúc trong
  `src/migrations/migration-create-favoritepost.js` và `migration-create-companyreview.js`.

Data mẫu tính năng mới gắn với tài khoản ứng viên `0795095041` (userId 5, mật khẩu
`123456`) — đăng nhập tài khoản này sẽ thấy sẵn 3 tin đã lưu và các đánh giá đã gửi.

---

## Tính năng mới đợt 2 (theo dõi công ty, gợi ý việc làm, chat)

4. **Theo dõi công ty + thông báo tin mới** — nút "Theo dõi" ở trang chi tiết công ty
   (hiện số người theo dõi); khi admin duyệt tin của công ty (statusCode PS1), hệ thống
   tự tạo thông báo cho toàn bộ người theo dõi. Chuông thông báo trên header hiển thị
   số chưa đọc, bấm vào thông báo sẽ nhảy tới tin tuyển dụng. Bảng mới: `FollowCompanies`;
   bảng `Notifications` được bổ sung 2 cột `content`, `link`.
   API: `POST /api/toggle-follow-company`, `GET /api/check-follow-company`,
   `GET /api/get-followed-company-by-user`, `GET /api/get-notification-by-user`,
   `POST /api/mark-read-notification`.
5. **Gợi ý việc làm theo kỹ năng** — mục "Việc làm phù hợp với bạn" trên trang chủ
   (chỉ hiện với ứng viên đã đăng nhập). Thuật toán chấm điểm: +3 cùng lĩnh vực với
   kỹ năng, +2 tên tin chứa tên kỹ năng, +3 khớp ngành trong cài đặt tìm việc,
   +1 mỗi tiêu chí khu vực/lương/kinh nghiệm khớp. API: `GET /api/get-recommended-post`.
6. **Chat ứng viên – nhà tuyển dụng** — nút "Nhắn tin cho nhà tuyển dụng" ở trang
   chi tiết việc làm, trang chat đầy đủ tại `/chat` (danh sách hội thoại + khung chat,
   tự cập nhật mỗi 4 giây bằng polling, badge số tin chưa đọc trên header).
   Bảng mới: `ChatMessages`. API: `POST /api/send-chat-message`,
   `GET /api/get-chat-conversation`, `GET /api/get-list-chat-conversation`.
   *Ghi chú: dùng polling để không phải thêm thư viện; muốn realtime thật có thể
   nâng cấp lên socket.io sau.*

### Kích hoạt đợt 2

- DB dựng mới (Cách 2): `npx sequelize-cli db:migrate` + `db:seed:all` như bình thường.
- DB đã có sẵn: chạy trong `frontend/`:
  ```bash
  npx sequelize-cli db:migrate
  npx sequelize-cli db:seed --seed 20250101000018-demo-followcompanies.js
  npx sequelize-cli db:seed --seed 20250101000019-demo-chatmessages.js
  npx sequelize-cli db:seed --seed 20250101000020-demo-notifications.js
  ```

### Demo nhanh đợt 2

- Đăng nhập ứng viên `0795095041` / `123456` (userId 5): trang chủ có mục
  "Việc làm phù hợp với bạn"; chuông thông báo có 1 thông báo chưa đọc; vào `/chat`
  thấy sẵn hội thoại với một nhà tuyển dụng; trang công ty id 6/7/11 hiện "Đang theo dõi".
- Đăng nhập tài khoản công ty tương ứng user 2 rồi vào `/chat` sẽ thấy chiều ngược lại
  (có 1 tin chưa đọc từ ứng viên).
- Để test thông báo tự động: đăng nhập ADMIN duyệt một tin của công ty id 6 →
  đăng nhập lại ứng viên userId 5 sẽ thấy thông báo mới trên chuông.
