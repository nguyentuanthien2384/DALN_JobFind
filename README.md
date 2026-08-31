# JobFind

Nền tảng tuyển dụng kết nối **ứng viên**, **nhà tuyển dụng** và **quản trị viên**. JobFind kết hợp trải nghiệm tìm việc trên web, quản lý quy trình tuyển dụng bằng Kanban, thông báo thời gian thực và kiến trúc microservices có thể mở rộng.

![React](https://img.shields.io/badge/Frontend-React-61DAFB?logo=react&logoColor=111827)
![Node.js](https://img.shields.io/badge/Backend-Node.js-339933?logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Runtime-Docker-2496ED?logo=docker&logoColor=white)
![MySQL](https://img.shields.io/badge/Data-MySQL-4479A1?logo=mysql&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/Events-RabbitMQ-FF6600?logo=rabbitmq&logoColor=white)

## Trải nghiệm sản phẩm

### Ứng viên

- Khám phá việc làm, tìm kiếm và lọc theo từ khóa, ngành nghề, địa điểm, mức lương và hình thức làm việc.
- Xem trang chi tiết việc làm, thông tin công ty, lưu việc làm và theo dõi công ty quan tâm.
- Tạo/cập nhật hồ sơ, quản lý CV, nộp CV và theo dõi lịch sử ứng tuyển.
- Nhắn tin trực tiếp với nhà tuyển dụng; chuông thông báo cập nhật theo thời gian thực.
- Nhận email kết quả trúng tuyển hoặc không trúng tuyển với bố cục thẻ hiện đại, tối ưu cho Gmail và thiết bị di động.

### Nhà tuyển dụng

- Quản lý công ty, nhân sự tuyển dụng, tin đăng, gói đăng tin và lượt xem CV.
- Xem hồ sơ ứng viên theo bảng Kanban gồm sáu trạng thái: **Mới ứng tuyển → Đang xem xét → Phỏng vấn → Đề nghị → Đã nhận việc / Từ chối**.
- Kéo thả hồ sơ giữa các cột, chấm sao, ghi chú nội bộ, xem lịch sử xử lý và lưu ứng viên vào talent pool.
- Trong chi tiết hồ sơ, gửi **trúng tuyển** hoặc **không trúng tuyển**, kèm lời nhắn tùy chọn. Hệ thống cập nhật trạng thái, ghi lịch sử và gửi email đến địa chỉ ứng viên đã dùng khi nộp hồ sơ.
- Xem số lượng hồ sơ theo từng giai đoạn và tỷ lệ tuyển thành công ngay trên pipeline.

### Quản trị viên

- Quản lý người dùng, công ty, tin đăng, danh mục công việc, kỹ năng, cấp bậc, mức lương và hình thức làm việc.
- Duyệt tin tuyển dụng, quản lý gói dịch vụ và lịch sử giao dịch.
- Xem dashboard tổng quan, phân bố dữ liệu, phễu tuyển dụng, chuỗi số liệu theo thời gian và nhật ký hoạt động.

## UI/UX

Giao diện ưu tiên thao tác nhanh và trạng thái rõ ràng:

| Khu vực | Quyết định UX |
| --- | --- |
| Tìm việc | Bộ lọc dễ quét, thẻ việc làm ngắn gọn, dẫn thẳng tới trang chi tiết và hành động ứng tuyển. |
| Header | Hiển thị thông báo và tin nhắn chưa đọc; cập nhật lại bằng Socket.IO khi có sự kiện mới. |
| Khu quản trị | Sidebar theo vai trò, chỉ mở một nhóm menu tại một thời điểm và đánh dấu trang hiện hành. |
| Pipeline | Màu riêng cho từng giai đoạn, phản hồi cập nhật ngay khi kéo thả, modal chi tiết không làm mất ngữ cảnh bảng Kanban. |
| Kết quả tuyển dụng | Hai nút hành động phân biệt rõ bằng xanh/đỏ, có xác nhận trước khi gửi và ô lời nhắn tùy chọn. |
| Email | Bố cục card, nhãn trạng thái, màu ngữ cảnh và CSS inline để tương thích Gmail/Outlook/mobile. |

## Kiến trúc

```mermaid
flowchart LR
    UI["React UI\n:3000"] -->|"REST / JWT / Socket.IO"| GW["API Gateway\n:4000"]
    GW --> Legacy["Backend legacy\n:5000"]
    GW --> Identity["Identity\n:4001"]
    GW --> Job["Job Core\n:4002"]
    GW --> Search["Search\n:4003"]
    GW --> Apps["Application\n:4004"]
    GW --> Admin["Admin & Reporting\n:4006"]

    Legacy --> MySQL[("MySQL / XAMPP")]
    Job --> MySQL
    Apps --> Postgres[("PostgreSQL")]
    Identity --> Mongo[("MongoDB")]
    Admin --> Mongo
    Search --> ES[("Elasticsearch")]

    Legacy --> MQ{"RabbitMQ"}
    Job --> MQ
    Apps --> MQ
    MQ --> Search
    MQ --> AI["AI Worker"]
    MQ --> Notify["Notification\nEmail + Realtime\n:4005"]
    MQ --> Admin
    Notify --> MySQL
```

### Các service

| Service | Trách nhiệm |
| --- | --- |
| `api-gateway` | Cổng API duy nhất, xác thực JWT, RBAC, rate limit Redis, circuit breaker và proxy Socket.IO. |
| `identity-service` | Hồ sơ và CV dạng dữ liệu ứng dụng. |
| `job-core-service` | Ghi/cập nhật tin tuyển dụng, tác vụ AI và phát sự kiện. |
| `search-service` | Đánh chỉ mục Elasticsearch, tìm kiếm và bộ lọc. |
| `application-service` | Pipeline ứng tuyển, ghi chú, chấm điểm, talent pool và funnel. |
| `notification-service` | Lưu thông báo, gửi email và đẩy sự kiện realtime qua backend legacy. |
| `admin-service` | Báo cáo, master data và audit log. |
| `ai-worker` | Xử lý tác vụ parse CV, matching, moderation và cover letter qua hàng đợi. |

### Luồng thông báo kết quả tuyển dụng

1. Nhà tuyển dụng mở hồ sơ tại `/admin/pipeline`.
2. Chọn **Gửi trúng tuyển** hoặc **Gửi không trúng tuyển**, có thể thêm lời nhắn.
3. `application-service` kiểm tra quyền theo công ty, cập nhật trạng thái và ghi lịch sử.
4. Service phát sự kiện `application.decision_email_requested` qua RabbitMQ.
5. `notification-service` lưu thông báo trong ứng dụng, gửi realtime nếu có thể và gửi email kết quả tới ứng viên.

> Email dùng địa chỉ được lưu trong hồ sơ tại thời điểm ứng tuyển; vì vậy việc ứng viên thay đổi hồ sơ sau đó không làm sai dữ liệu tuyển dụng lịch sử.

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Frontend | React 18, React Router, Axios, SCSS, React Toastify, Socket.IO Client, Chart.js/Recharts |
| Backend legacy | Node.js, Express, Sequelize, MySQL, Socket.IO, JWT, Nodemailer |
| Microservices | Node.js, Express, Docker Compose, RabbitMQ, Redis |
| Data | MySQL, PostgreSQL, MongoDB, Elasticsearch |
| Tích hợp | Gmail App Password, Cloudinary, PayPal Sandbox, Anthropic API (tùy chọn) |

## Cấu trúc thư mục

```text
job_find/
├── backend/                  # API legacy, Socket.IO, Sequelize/MySQL và nghiệp vụ cũ
│   ├── src/
│   └── scripts/              # Khôi phục và tạo dữ liệu mẫu
├── frontend/                 # React UI
│   └── src/
│       ├── container/        # Trang public, candidate, employer và admin
│       ├── components/       # Thành phần tái sử dụng và modal
│       └── service/          # Lớp gọi API
├── microservices/            # Docker Compose và các service tách riêng
│   ├── api-gateway/
│   ├── application-service/
│   ├── notification-service/
│   ├── search-service/
│   └── shared/               # RabbitMQ, events và logger dùng chung
└── database/                 # Dữ liệu MySQL mẫu
```

## Điều kiện chạy

- Node.js 20+ (khuyến nghị Node.js 22)
- Docker Desktop
- XAMPP/MySQL với database `jobfindtest`
- MySQL legacy chạy ở cổng `3333` theo cấu hình mặc định; nếu máy dùng cổng khác, cập nhật đồng thời `backend/.env` và `microservices/.env`.

## Cài đặt và khởi chạy

### 1. Cấu hình backend legacy

Tạo/cập nhật `backend/.env`:

```env
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3333
DB_NAME=jobfindtest
DB_USER=root
DB_PASSWORD=
JWT_SECRET=thay-bang-khoa-rieng
URL_REACT=http://localhost:3000
RABBITMQ_URL=amqp://jobportal:jobportal@localhost:5673
INTERNAL_SECRET=thay-bang-khoa-rieng
```

Khởi chạy XAMPP/MySQL, nạp database mẫu nếu cần, rồi chạy backend:

```powershell
cd backend
npm install
npm start
```

Backend và Socket.IO lắng nghe tại `http://localhost:5000`.

### 2. Cấu hình microservices

Sao chép `microservices/.env.example` thành `microservices/.env`, sau đó điền các giá trị phù hợp:

```env
MYSQL_HOST=host.docker.internal
MYSQL_PORT=3333
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=jobfindtest
JWT_SECRET=phai-trung-voi-backend
LEGACY_URL=http://host.docker.internal:5000
INTERNAL_SECRET=phai-trung-voi-backend
CORS_ORIGIN=http://localhost:3000

# Bắt buộc nếu muốn gửi email kết quả thật
EMAIL_APP=your-address@gmail.com
EMAIL_APP_PASSWORD=gmail-app-password-16-characters

# Tùy chọn cho các tính năng AI
ANTHROPIC_API_KEY=
```

Khởi chạy toàn bộ service:

```powershell
cd microservices
npm install
npm run up
```

Theo dõi trạng thái:

```powershell
npm run ps
Invoke-RestMethod http://localhost:4000/status
```

### 3. Chạy frontend

`frontend/.env` đã trỏ frontend qua Gateway:

```env
REACT_APP_BACKEND_URL=http://localhost:4000
```

Khởi chạy môi trường phát triển:

```powershell
cd frontend
npm install
npm start
```

Mở `http://localhost:3000`.

Tạo bản build production:

```powershell
npm run build
```

## Các cổng sử dụng

| Thành phần | Cổng |
| --- | ---: |
| Frontend React | 3000 |
| Backend legacy + Socket.IO | 5000 |
| API Gateway | 4000 |
| MySQL/XAMPP | 3333 |
| PostgreSQL | 5435 |
| MongoDB | 27019 |
| Elasticsearch | 9201 |
| RabbitMQ AMQP / Management | 5673 / 15673 |
| Redis | 6380 |

## Kiểm tra nhanh

### Unit test

Từ thư mục gốc, chạy toàn bộ unit test backend, frontend và microservices:

```powershell
npm test
```

Chạy kèm báo cáo coverage:

```powershell
npm run test:coverage
```

Có thể chạy riêng từng phần bằng `npm run test:backend`, `npm run test:frontend`
hoặc `npm run test:microservices`. Các unit test mock toàn bộ dịch vụ ngoài như cơ sở
dữ liệu, RabbitMQ, Redis, Elasticsearch, SMTP và AI nên không cần khởi động Docker/XAMPP.

### Smoke test và build

```powershell
# Gateway và tình trạng mọi service
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/status

# Kiểm tra frontend build
cd frontend
npm run build

# Smoke test microservices (dùng dữ liệu demo; có thể tạo rồi dọn bản ghi kiểm thử)
cd ..\microservices
npm run test:smoke
```

## Tài khoản demo

Mật khẩu dữ liệu demo: `123456`.

| Vai trò | Số điện thoại | Tên |
| --- | --- | --- |
| Nhà tuyển dụng | `0795095042` | Nguyễn Văn Tài |
| Ứng viên | `0764188123` | Trần Thị My |
| Quản trị viên | `0795095049` | Nguyễn Tuấn Thiền |

## Bảo mật và vận hành

- Không commit `.env`, App Password Gmail, JWT secret, Cloudinary secret hoặc khóa AI.
- API Gateway xóa các header định danh từ client trước khi gắn identity đã xác thực.
- Các route ghi dữ liệu có rate limit; quyền truy cập pipeline được giới hạn theo công ty sở hữu hồ sơ.
- Notification Service tách ba kênh: lưu CSDL, realtime và email. Lỗi một kênh không chặn các kênh còn lại.
- Khi triển khai production, thay toàn bộ secret, đặt `CORS_ORIGIN` đúng domain và dùng tài khoản email chuyên dụng.

## Tài liệu chuyên sâu

- [Ma trận phân quyền và kiểm soát truy cập](docs/AUTHORIZATION.md)
- [Chi tiết kiến trúc microservices](microservices/README.md)
- [Mã nguồn template email kết quả](microservices/notification-service/src/templates.js)
- [Giao diện pipeline Kanban](frontend/src/container/system/Cv/KanbanBoard.js)
