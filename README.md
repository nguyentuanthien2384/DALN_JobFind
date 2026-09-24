<div align="center">

# 🚀 JobFind

### Nền tảng tuyển dụng thông minh — Kết nối Ứng viên, Nhà tuyển dụng & Quản trị viên

[![React](https://img.shields.io/badge/Frontend-React_18-61DAFB?style=for-the-badge&logo=react&logoColor=111827)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Backend-Node.js_22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![MySQL](https://img.shields.io/badge/Database-MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)](https://mysql.com)
[![RabbitMQ](https://img.shields.io/badge/Events-RabbitMQ-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)](https://rabbitmq.com)
[![Elasticsearch](https://img.shields.io/badge/Search-Elasticsearch-005571?style=for-the-badge&logo=elasticsearch&logoColor=white)](https://elastic.co)

</div>

---

## 📋 Mục lục

- [Tổng quan](#-tổng-quan)
- [Trải nghiệm sản phẩm](#-trải-nghiệm-sản-phẩm)
- [UI/UX](#-uiux)
- [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
- [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
- [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [Điều kiện chạy](#-điều-kiện-chạy)
- [Cài đặt và khởi chạy](#-cài-đặt-và-khởi-chạy)
- [Các cổng sử dụng](#-các-cổng-sử-dụng)
- [Kiểm tra và kiểm thử](#-kiểm-tra-và-kiểm-thử)
- [CI/CD](#-cicd)
- [Triển khai và vận hành](#-triển-khai-và-vận-hành)
- [Tài khoản demo](#-tài-khoản-demo)
- [Bảo mật và vận hành](#-bảo-mật-và-vận-hành)
- [Tài liệu chuyên sâu](#-tài-liệu-chuyên-sâu)

---

## 🌟 Tổng quan

JobFind là nền tảng tuyển dụng toàn diện, kết hợp trải nghiệm tìm việc trên web, quản lý quy trình tuyển dụng bằng **Kanban**, thông báo thời gian thực, chatbot AI hỗ trợ và kiến trúc **microservices** có thể mở rộng. Hệ thống phục vụ ba nhóm người dùng: **Ứng viên**, **Nhà tuyển dụng** và **Quản trị viên**.

### ✨ Tính năng nổi bật

| Tính năng | Mô tả |
| --- | --- |
| 🔍 **Tìm kiếm Elasticsearch** | Tìm kiếm full-text, bộ lọc đa chiều (ngành, lương, địa điểm, hình thức) |
| 📋 **Kanban Pipeline** | Bảng kéo thả 6 trạng thái quản lý hồ sơ ứng viên |
| 🤖 **Chatbot AI đa nhà cung cấp** | Claude / OpenAI / Gemini / Ollama, tra cứu cá nhân, chuyển nhân viên hỗ trợ |
| 🔔 **Realtime & Web Push** | Socket.IO + Web Push Notifications cho thông báo tức thì |
| 📄 **Prepared CV PDF** | Xuất CV chuẩn bị từ hệ thống với pdf-lib, fontkit |
| ✉️ **Email thư mời nhận việc** | Template card hiện đại, CSS inline tương thích Gmail/Outlook/mobile |
| 🔐 **HttpOnly Session & Google SSO** | Cookie bảo mật, tự gia hạn, OIDC Google, quản lý phiên |
| 📊 **Dashboard & Báo cáo** | Chart.js/Recharts, phễu tuyển dụng, chuỗi thời gian, audit log |
| 💳 **Thanh toán PayPal** | Gói đăng tin, gói xem CV qua PayPal Sandbox |
| 🐇 **Event-Driven Architecture** | RabbitMQ pub/sub giữa các service, circuit breaker, outbox pattern |

---

## 🎯 Trải nghiệm sản phẩm

### 👤 Ứng viên

- **Khám phá việc làm**: Tìm kiếm và lọc theo từ khóa, ngành nghề, địa điểm, mức lương, hình thức làm việc. Kết quả được đánh chỉ mục Elasticsearch cho phản hồi nhanh.
- **Trang chi tiết việc làm**: Xem đầy đủ thông tin công ty, yêu cầu, quyền lợi; lưu việc làm yêu thích và theo dõi công ty quan tâm.
- **Hồ sơ & CV**: Tạo/cập nhật hồ sơ cá nhân, quản lý nhiều CV, xuất **Prepared CV PDF** chuẩn bị sẵn; nộp đơn trực tiếp và theo dõi lịch sử ứng tuyển.
- **Nhắn tin trực tiếp**: Chat realtime với nhà tuyển dụng qua Socket.IO, đồng bộ trạng thái đã đọc.
- **Chuông thông báo**: Header hiển thị thông báo chưa đọc, cập nhật tức thì bằng Socket.IO; hỗ trợ **Web Push Notifications** trên trình duyệt.
- **Chatbot AI hỗ trợ**: Trợ lý dùng assistant-ui — hỏi đáp, tìm tin tuyển dụng công khai, tra cứu theo tài khoản, phản hồi trực tiếp, sửa câu hỏi, quản lý lịch sử phiên. Chuyển hội thoại cho nhân viên hỗ trợ khi cần. Xem [cấu hình chatbot](CHATBOT_SETUP.md).
- **Email kết quả tuyển dụng**: Nhận email trúng tuyển hoặc không trúng tuyển với bố cục thẻ hiện đại, nút trả lời gửi trực tiếp đến HR.
- **Đánh giá công ty**: Xem và viết đánh giá công ty.

### 🏢 Nhà tuyển dụng

- **Quản lý công ty**: Cập nhật thông tin, logo, mô tả; quản lý nhân sự tuyển dụng thuộc công ty.
- **Tin tuyển dụng**: Đăng tin mới, chỉnh sửa, đăng lại; quản lý gói đăng tin và lượt xem CV. Hỗ trợ AI gợi ý nội dung (tùy chọn).
- **Tìm ứng viên phù hợp** tại `/admin/list-candiate/`: lọc theo từ khóa tên/kỹ năng, ngành nghề, địa điểm, kinh nghiệm và mức lương; lấy tiêu chí từ tin của công ty, khớp một/tất cả kỹ năng, lọc theo điểm và xếp hạng trên toàn bộ kết quả. Điểm có giải thích kỹ năng khớp/còn thiếu, dựa trên hồ sơ khai báo. Xem [hướng dẫn lọc CV](docs/candidate-search.md).
- **Pipeline Kanban**: Xem hồ sơ ứng viên trên bảng 6 cột trạng thái:

  | Trạng thái | Mô tả |
  | --- | --- |
  | 🆕 Mới ứng tuyển | Hồ sơ vừa nộp |
  | 🔍 Đang xem xét | HR đang đánh giá |
  | 🎤 Phỏng vấn | Đã lên lịch phỏng vấn |
  | 📨 Đề nghị | Đã gửi thư mời nhận việc |
  | ✅ Đã nhận việc | Ứng viên xác nhận |
  | ❌ Từ chối | Không phù hợp |

- **Kéo thả hồ sơ** giữa các cột, chấm sao đánh giá, ghi chú nội bộ, xem lịch sử xử lý, lưu ứng viên vào talent pool.
- **Thư mời nhận việc**: Soạn thư mời với ngày giờ (giờ VN), địa điểm hoặc link trực tuyến, người liên hệ HR, hạn phản hồi; bổ sung lương, thử việc, phúc lợi, giấy tờ và hướng dẫn ngày đầu. Xem trước trước khi gửi. Thông báo không trúng tuyển kèm lời nhắn tùy chọn.
- **Thống kê pipeline**: Xem số lượng hồ sơ theo từng giai đoạn và tỷ lệ tuyển thành công ngay trên bảng.

### 🛡️ Quản trị viên

- **Quản lý tổng thể**: Người dùng, công ty, tin đăng, danh mục công việc, kỹ năng, cấp bậc, mức lương, hình thức làm việc.
- **Duyệt tin tuyển dụng**: Phê duyệt, từ chối tin đăng; quản lý gói dịch vụ và lịch sử giao dịch.
- **Dashboard tổng quan**: Biểu đồ phân bố dữ liệu, phễu tuyển dụng, chuỗi số liệu theo thời gian, nhật ký hoạt động (audit log).
- **Hỗ trợ chatbot**: Tiếp nhận yêu cầu hỗ trợ từ chatbot, xem bản chụp hội thoại, mở Tin nhắn và đánh dấu đã xử lý tại `/admin/support`.

---

## 🎨 UI/UX

Giao diện ưu tiên **thao tác nhanh**, **trạng thái rõ ràng** và **trải nghiệm mượt mà**:

| Khu vực | Quyết định UX |
| --- | --- |
| 🏠 **Trang chủ** | Banner slider nổi bật, danh mục ngành nghề trực quan, việc làm nổi bật và gợi ý cho ứng viên. |
| 🔍 **Tìm việc** | Bộ lọc dễ quét bên trái, thẻ việc làm ngắn gọn bên phải, lưu lịch sử tìm kiếm, cuộn giữ vị trí khi quay lại; dẫn thẳng tới chi tiết và hành động ứng tuyển. |
| 📄 **Chi tiết việc làm** | Layout 2 cột: thông tin chi tiết bên trái, thông tin công ty + nút ứng tuyển bên phải; hiển thị yêu cầu, quyền lợi, mô tả đầy đủ. |
| 📱 **Header** | Logo, navigation, ô tìm kiếm nhanh; chuông thông báo và tin nhắn chưa đọc cập nhật realtime bằng Socket.IO. |
| 🔧 **Khu quản trị** | Sidebar accordion theo vai trò (Admin/Employer), chỉ mở một nhóm menu, đánh dấu trang hiện hành; header riêng với thông báo. |
| 📋 **Pipeline Kanban** | Mã màu riêng từng giai đoạn, phản hồi cập nhật ngay khi kéo thả, modal chi tiết không mất ngữ cảnh bảng, counter theo cột. |
| 📨 **Kết quả tuyển dụng** | Hai nút hành động phân biệt xanh (trúng)/đỏ (không trúng), dialog xác nhận trước khi gửi, ô lời nhắn tùy chọn; form xem trước thư mời. |
| ✉️ **Email** | Bố cục card, nhãn trạng thái, màu ngữ cảnh xanh/đỏ; CSS inline tương thích Gmail/Outlook/mobile. Nút trả lời gửi trực tiếp đến HR. |
| 💬 **Chat** | Giao diện messenger 2 panel: danh sách hội thoại + cửa sổ chat; avatar, trạng thái đã đọc, đang gõ, đồng bộ tin nhắn đáng tin cậy. |
| 🤖 **Chatbot hỗ trợ** | Widget nổi góc phải, hỗ trợ Markdown, lịch sử hội thoại, tra cứu cá nhân, chuyển nhân viên, chế độ dự phòng khi chưa có AI. |
| 📊 **Dashboard** | Biểu đồ tròn, biểu đồ cột, biểu đồ đường bằng Chart.js/Recharts; báo cáo tổng quan và chi tiết theo bộ lọc. |
| 🔐 **Đăng nhập** | Form đăng nhập/đăng ký/quên mật khẩu; hỗ trợ Google SSO; quản lý phiên bảo mật tại `/account/security`. |
| 📱 **Responsive** | Thiết kế responsive hoạt động trên desktop, tablet và mobile; menu hamburger trên màn hình nhỏ. |

---

## 🏗️ Kiến trúc hệ thống

```mermaid
flowchart LR
    subgraph Client
        UI["React UI\n:3000"]
    end

    subgraph Gateway
        GW["API Gateway\n:4000"]
    end

    subgraph Services
        Legacy["Backend Legacy\n:5000"]
        Identity["Identity Service\n:4001"]
        Job["Job Core Service\n:4002"]
        Search["Search Service\n:4003"]
        Apps["Application Service\n:4004"]
        Notify["Notification Service\n:4005"]
        Admin["Admin & Reporting\n:4006"]
        Support["Support Chat\n:4008"]
    end

    subgraph Workers
        AI["AI Worker"]
    end

    subgraph Data
        MySQL[("MySQL / XAMPP")]
        Postgres[("PostgreSQL")]
        Mongo[("MongoDB")]
        ES[("Elasticsearch")]
        Redis[("Redis")]
    end

    subgraph Messaging
        MQ{"RabbitMQ"}
    end

    UI -->|"REST / JWT / Socket.IO"| GW
    GW --> Legacy
    GW --> Identity
    GW --> Job
    GW --> Search
    GW --> Apps
    GW --> Notify
    GW --> Admin
    GW --> Support

    Legacy --> MySQL
    Job --> MySQL
    Apps --> Postgres
    Identity --> Mongo
    Admin --> Mongo
    Search --> ES
    Support --> MySQL
    Support --> ES
    Notify --> MySQL
    GW --> Redis

    Legacy --> MQ
    Job --> MQ
    Apps --> MQ
    MQ --> Search
    MQ --> AI
    MQ --> Notify
    MQ --> Admin
    AI --> Mongo
```

### 📦 Các service chi tiết

| Service | Cổng | Trách nhiệm |
| --- | ---: | --- |
| `api-gateway` | 4000 | Cổng API duy nhất, xác thực JWT, RBAC, rate limit Redis, circuit breaker, proxy Socket.IO, CORS. |
| `identity-service` | 4001 | Hồ sơ cá nhân, CV Builder, dữ liệu dạng tài liệu (MongoDB). |
| `job-core-service` | 4002 | Ghi/cập nhật tin tuyển dụng, kiểm tra quota gói tin, tác vụ AI và phát sự kiện. |
| `search-service` | 4003 | Đánh chỉ mục Elasticsearch, tìm kiếm full-text, bộ lọc đa chiều, đồng bộ CQRS. |
| `application-service` | 4004 | Pipeline ứng tuyển (Kanban), ghi chú, chấm điểm, talent pool, funnel, thư mời/từ chối. |
| `notification-service` | 4005 | Lưu thông báo CSDL, gửi email (Nodemailer/Gmail), đẩy realtime qua backend legacy. |
| `admin-service` | 4006 | Báo cáo tổng hợp, master data mở rộng, audit log, nhật ký sự kiện. |
| `support-chat-service` | 4008 | Chatbot AI đa provider, kho kiến thức, quản lý hội thoại, chuyển nhân viên hỗ trợ. |
| `ai-worker` | — | Worker không HTTP, xử lý tác vụ parse CV, matching, moderation, cover letter qua hàng đợi RabbitMQ. |
| `backend` (legacy) | 5000 | API gốc, Socket.IO realtime hub, Sequelize/MySQL, xác thực session, Web Push, chatbot bridge. |

### 🔄 Luồng thông báo kết quả tuyển dụng

1. Nhà tuyển dụng mở hồ sơ tại `/admin/pipeline`.
2. Chọn **Gửi trúng tuyển** → điền thông tin → **Xem trước thư mời** → **Xác nhận gửi thư mời**; hoặc chọn **Gửi không trúng tuyển** kèm lời nhắn.
3. `application-service` kiểm tra quyền theo công ty, cập nhật trạng thái (`de_nghi` cho thư mời, giữ `nhan_viec` nếu đã xác nhận), lưu nội dung vào lịch sử.
4. Service phát sự kiện `application.decision_email_requested` qua RabbitMQ.
5. `notification-service` lưu thông báo trong ứng dụng, gửi realtime nếu online, gửi email kết quả. Thư mời có `Reply-To` gửi về HR.

> 📌 Email dùng địa chỉ lưu trong hồ sơ tại thời điểm ứng tuyển — ứng viên thay đổi hồ sơ sau đó không ảnh hưởng dữ liệu tuyển dụng lịch sử.

Chi tiết: [Thư mời nhận việc](docs/recruitment-offer-email.md)

---

## 💻 Công nghệ sử dụng

| Lớp | Công nghệ |
| --- | --- |
| **Frontend** | React 18, React Router 7, Axios, SCSS/CSS, Ant Design, Reactstrap, React Toastify, Socket.IO Client, Chart.js, Recharts, Victory Pie, React Slick, React Select, React Datepicker, assistant-ui, pdf-lib, markdown-it, xlsx |
| **Backend Legacy** | Node.js 22, Express 5, Sequelize, MySQL, Socket.IO, JWT, Nodemailer, bcryptjs, web-push, Cloudinary, PayPal SDK, openid-client, Redis Streams Adapter, AJV |
| **Microservices** | Node.js 22, Express, Docker Compose, RabbitMQ 4, Redis 7, Vitest |
| **Databases** | MySQL 8 (XAMPP), PostgreSQL 16, MongoDB 7, Elasticsearch 8.15 |
| **AI & ML** | Anthropic Claude (AI Worker and Support Chat), OpenAI GPT-4.1 / Gemini 2.5 / Ollama (Support Chat) |
| **DevOps** | Docker Compose, GitHub Actions CI, Nginx (production), Prometheus alerts |
| **Tích hợp** | Gmail App Password, Cloudinary, PayPal Sandbox, Google OIDC SSO |
| **Testing** | Jest 30, Vitest 4, React Testing Library, Playwright (browser tests) |

---

## 📁 Cấu trúc thư mục

```text
job_find/
├── 📂 backend/                     # API legacy, Socket.IO hub, Sequelize/MySQL
│   ├── src/
│   │   ├── config/                 # Kết nối DB, Socket.IO, Redis adapter, view engine
│   │   ├── controllers/            # 16 controller: auth, user, post, cv, chat, company,
│   │   │                           #   notification, package, webPush, supportBridge...
│   │   ├── middlewares/            # JWT verify, authorize (RBAC), rate limit, auth headers
│   │   ├── models/                 # 30 model Sequelize: user, post, company, cv, chat,
│   │   │                           #   notification, payment, auth session, web push...
│   │   ├── routes/                 # Định tuyến API tập trung (web.js)
│   │   ├── services/               # 21 service: user, post, cv, chat, company, auth,
│   │   │                           #   payment, supportChat, webPush, OIDC...
│   │   ├── migrations/             # Sequelize migrations
│   │   ├── seeders/                # Dữ liệu mẫu
│   │   └── utils/                  # Cloudinary, helpers
│   ├── scripts/                    # Khôi phục dữ liệu, tạo tài khoản test, kiểm thử
│   └── tests/                      # Jest unit + integration tests
│
├── 📂 frontend/                    # React 18 UI
│   ├── public/                     # Assets, favicon, PWA manifest, push service worker
│   └── src/
│       ├── auth/                   # RouteGuard, accessControl (RBAC), authClient,
│       │                           #   SecuritySettings, SessionContext, sessionExpiry
│       ├── container/              # Các trang theo nhóm chức năng
│       │   ├── home/               # Trang chủ: banner, danh mục, việc làm nổi bật
│       │   ├── JobPage/            # Tìm việc: bộ lọc + danh sách, lưu lịch sử tìm kiếm
│       │   ├── JobDetail/          # Chi tiết việc làm + mô tả + ứng tuyển
│       │   ├── Company/            # Danh sách & chi tiết công ty, đánh giá
│       │   ├── Chat/               # Tin nhắn trực tiếp: ChatPage, avatar, đồng bộ
│       │   ├── Candidate/          # Khu ứng viên: hồ sơ, CV, AI, lịch sử, lưu việc,
│       │   │                       #   cài đặt tài khoản
│       │   ├── login/              # Đăng nhập, đăng ký, quên mật khẩu
│       │   ├── system/             # Khu quản trị (Admin/Employer)
│       │   │   ├── Chart/          # Biểu đồ CV, biểu đồ tin đăng
│       │   │   ├── Company/        # Quản lý công ty, nhân sự tuyển dụng
│       │   │   ├── Cv/             # KanbanBoard, OfferLetterForm, FilterCv, UserCv
│       │   │   ├── Post/           # Đăng tin, quản lý tin, ghi chú, mua gói tin
│       │   │   ├── User/           # Quản lý người dùng, thêm/sửa, đổi mật khẩu
│       │   │   ├── Report/         # ReportDashboard — báo cáo tổng hợp
│       │   │   ├── PackagePost/    # Quản lý gói đăng tin
│       │   │   ├── PackageCv/      # Quản lý gói xem CV, mua gói
│       │   │   ├── HistoryTrade/   # Lịch sử giao dịch tin/CV
│       │   │   ├── JobType/        # Danh mục ngành nghề
│       │   │   ├── JobLevel/       # Cấp bậc công việc
│       │   │   ├── JobSkill/       # Kỹ năng
│       │   │   ├── SalaryType/     # Mức lương
│       │   │   ├── WorkType/       # Hình thức làm việc
│       │   │   └── ExpType/        # Kinh nghiệm
│       │   ├── header/             # Header navigation + thông báo realtime
│       │   ├── footer/             # Footer
│       │   ├── About/              # Giới thiệu
│       │   ├── Contact/            # Liên hệ
│       │   ├── Forbidden/          # Trang 403
│       │   └── NotFound/           # Trang 404
│       ├── components/
│       │   ├── Job/                # Thẻ việc làm tái sử dụng
│       │   ├── home/               # Categories, FeatureJob, RecommendedJobs
│       │   ├── input/              # Input components tái sử dụng
│       │   ├── modal/              # SendCvModal, NoteModal, PreparedCvPicker, ReupPost
│       │   └── support/            # SupportChat widget, SupportInbox (admin), Markdown
│       ├── service/                # 38 service modules: API calls, form adapters,
│       │                           #   polling, error handling, workspace services
│       ├── push/                   # Web Push: PushSettings, webPush client
│       ├── css/                    # Global styles, SCSS
│       └── util/                   # CommonUtils, Validation, fetch, storage, locale,
│                                   #   useAutoRefresh hook, firebase, KeyCode
│
├── 📂 microservices/               # Docker Compose & 9 services
│   ├── docker-compose.yml          # 15 containers: 9 services + 6 infrastructure
│   ├── compose.local.yml           # Override cho local dev + monitoring
│   ├── Dockerfile                  # Production multi-stage build
│   ├── api-gateway/                # Proxy, JWT, RBAC, rate limit, routing
│   ├── identity-service/           # Hồ sơ & CV (MongoDB)
│   ├── job-core-service/           # CRUD tin tuyển dụng, AI tasks (MySQL)
│   ├── search-service/             # Elasticsearch indexing & query
│   ├── application-service/        # Pipeline Kanban, thư mời (PostgreSQL)
│   ├── notification-service/       # Email + realtime notifications
│   ├── admin-service/              # Reporting & audit (MongoDB)
│   ├── support-chat-service/       # Chatbot AI multi-provider
│   ├── ai-worker/                  # Background AI tasks (RabbitMQ consumer)
│   ├── shared/                     # RabbitMQ client, events, logger, access control,
│   │                               #   contracts, security config, service runtime
│   ├── contracts/                  # HTTP & event contract definitions
│   ├── ops/                        # Prometheus alerts, monitoring config
│   ├── scripts/                    # Smoke tests, integration tests, contract tooling
│   ├── docs/                       # 26 tài liệu kỹ thuật: rollout, contracts, sync...
│   └── tests/                      # 68 test files: unit + integration (Vitest)
│
├── 📂 database/                    # Dữ liệu mẫu MySQL
│   ├── jobfindtest.sql             # Full dump (~19MB) với dữ liệu tiếng Việt
│   └── README_DATA.md              # Hướng dẫn chi tiết về dữ liệu
│
├── 📂 docs/                        # Tài liệu dự án
│   ├── AUTHENTICATION_SSO_INTEGRATION.md
│   ├── AUTHORIZATION.md
│   ├── AUTH_REPORT_ACCEPTANCE.md
│   ├── web-push.md
│   ├── websocket-upgrade.md
│   ├── chatbot-pdf-implementation.md
│   ├── chatbot-validation.md
│   ├── recruitment-offer-email.md
│   ├── recruitment-offer-live-test.md
│   ├── run-with-real-data.md
│   ├── job-detail-page.md
│   └── job-navigation-vietnamese.md
│
├── 📂 postman/                     # Postman collection & environment cho API testing
├── 📂 scripts/                     # 30 scripts vận hành: dev, release, deploy, backup,
│   │                               #   restore, health check, migration
│   └── release/                    # Dockerfiles, Nginx config, release verification
│
├── 📂 .github/workflows/          # GitHub Actions CI
│   ├── authentication.yml          # CI cho authentication module
│   ├── microservices.yml           # CI cho microservices
│   └── realtime.yml                # CI cho realtime/Socket.IO
│
├── package.json                    # Root scripts: start, test, deploy, release
├── CHATBOT_SETUP.md                # Hướng dẫn cấu hình chatbot AI
└── CHATBOT_TOOLS_UPGRADE.md        # Legacy chatbot migration notes
```

---

## ⚙️ Điều kiện chạy

| Yêu cầu | Chi tiết |
| --- | --- |
| **Node.js** | 22.12 trở lên |
| **Docker Desktop** | Phiên bản mới nhất, hỗ trợ Compose V2 |
| **XAMPP / MySQL** | Database `jobfindtest`, mặc định cổng `3333` |
| **RAM** | Tối thiểu 8GB (Elasticsearch cần 512MB–1GB) |

> ⚠️ MySQL legacy chạy ở cổng `3333` theo cấu hình mặc định. Nếu máy dùng cổng khác, cập nhật đồng thời `backend/.env` và `microservices/.env`.

---

## 🚀 Cài đặt và khởi chạy

### 🔐 Xác thực và Google SSO

Hệ thống hỗ trợ phiên đăng nhập bằng **cookie HttpOnly**, tự gia hạn, thu hồi phiên khi đổi mật khẩu/khóa tài khoản và quản lý phiên tại `/account/security`. Quyền truy cập được kiểm tra theo tài khoản/công ty hiện tại trong database.

Sau khi cập nhật mã nguồn, chạy migration xác thực:

```powershell
npm run auth:migrate
```

Lệnh này sao lưu MySQL và áp dụng riêng các bảng xác thực. Google SSO đang tắt cho đến khi có OAuth Client; xem [hướng dẫn cấu hình SSO](docs/AUTHENTICATION_SSO_INTEGRATION.md).

Đã bổ sung lịch sử bảo mật, thông tin thiết bị và kiểm thử OIDC với chữ ký/JWKS qua HTTP và trình duyệt thật. Xem [đối chiếu tiêu chí báo cáo](docs/AUTH_REPORT_ACCEPTANCE.md).

---

### ⚡ Khởi chạy nhanh (Unified Launcher)

Từ thư mục gốc `D:\job_find`:

```powershell
npm start
```

Mở **http://localhost:3001** khi `npm run dev:status` báo `running`.

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev:status` | Xem tiến độ và trạng thái chạy |
| `npm run dev:check` | Đối chiếu dữ liệu API với MySQL thật, không tạo tin/CV |
| `npm run dev:stop` | Dừng ứng dụng, giữ cơ sở dữ liệu |

Trình khởi chạy sẽ:
- Sử dụng `backend/.env` và `microservices/.env` hiện có
- Sao lưu MySQL/PostgreSQL/MongoDB vào `.local/backups`
- Khởi động các kho dữ liệu đã cấu hình
- Dựng dịch vụ từ mã nguồn hiện tại
- Chạy backend và frontend trên cổng 3001

> 📖 Chi tiết điều kiện chạy và dữ liệu: [Chạy với dữ liệu thật](docs/run-with-real-data.md). Các bước thủ công bên dưới vẫn dùng được nếu không chạy trình khởi chạy chung.

---

### 1️⃣ Cấu hình Backend Legacy

Tạo/cập nhật `backend/.env`:

```env
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3333
DB_NAME=jobfindtest
DB_USER=root
DB_PASSWORD=
# Bắt buộc: sinh ngẫu nhiên tối thiểu 32 ký tự, dùng cùng giá trị ở hai file .env
JWT_SECRET=
URL_REACT=http://localhost:3000
RABBITMQ_URL=amqp://jobportal:MAT_KHAU_NGAU_NHIEN@localhost:5673
INTERNAL_SECRET=
```

Khởi chạy XAMPP/MySQL, nạp database mẫu nếu cần, rồi chạy backend:

```powershell
cd backend
npm install
npm start
```

Backend và Socket.IO lắng nghe tại `http://localhost:5000`.

---

### 2️⃣ Cấu hình Microservices

Sao chép `microservices/.env.example` thành `microservices/.env`, sau đó điền các giá trị:

```env
MYSQL_HOST=host.docker.internal
MYSQL_PORT=3333
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=jobfindtest
JWT_SECRET=
RABBITMQ_USER=jobportal
RABBITMQ_PASSWORD=
POSTGRES_USER=jobportal
POSTGRES_PASSWORD=
LEGACY_URL=http://host.docker.internal:5000
INTERNAL_SECRET=
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Bắt buộc nếu muốn gửi email kết quả thật
NODE_ENV=development
EMAIL_APP=your-address@gmail.com
EMAIL_APP_PASSWORD=gmail-app-password-16-characters

# Tùy chọn: hộp thư nhận toàn bộ email của dữ liệu demo
EMAIL_DEMO_RECIPIENT=your-address@gmail.com

# Tùy chọn: AI features
ANTHROPIC_BASE_URL=https://1gw.gwai.cloud
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-opus-5

# Tùy chọn: Support Chat AI providers. ANTHROPIC_API_KEY ở trên cũng bật Claude cho chatbot.
SUPPORT_CLAUDE_MODEL=claude-haiku-4-5
OPENAI_API_KEY=
GEMINI_API_KEY=
```

> 📧 **Email demo**: Ở development, Notification Service chuyển địa chỉ mẫu tới `EMAIL_DEMO_RECIPIENT`; trống thì dùng `EMAIL_APP`. Production chặn địa chỉ mẫu để tránh gửi nhầm.

> 🌐 `FRONTEND_URL` là địa chỉ frontend gắn trong email; khi triển khai thay localhost bằng domain thật.

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

---

### 3️⃣ Chạy Frontend

`frontend/.env` trỏ frontend qua Gateway:

```env
REACT_APP_BACKEND_URL=http://localhost:4000
```

Khởi chạy:

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

---

## 🔌 Các cổng sử dụng

| Thành phần | Cổng | Ghi chú |
| --- | ---: | --- |
| Frontend React | 3000 | Dev server (3001 qua Unified Launcher) |
| Backend Legacy + Socket.IO | 5000 | API gốc + realtime hub |
| API Gateway | 4000 | Cổng duy nhất cho frontend |
| Identity Service | 4001 | Nội bộ Docker |
| Job Core Service | 4002 | Nội bộ Docker |
| Search Service | 4003 | Nội bộ Docker |
| Application Service | 4004 | Nội bộ Docker |
| Notification Service | 4005 | Nội bộ Docker |
| Admin Service | 4006 | Nội bộ Docker |
| Support Chat Service | 4008 | Nội bộ Docker |
| MySQL / XAMPP | 3333 | Host machine |
| PostgreSQL | 5435 | Mapped từ Docker |
| MongoDB | 27019 | Mapped từ Docker |
| Elasticsearch | 9201 | Mapped từ Docker |
| RabbitMQ AMQP | 5673 | Mapped từ Docker |
| RabbitMQ Management | 15673 | Web UI quản lý hàng đợi |
| Redis | 6380 | Mapped từ Docker |

---

## 🧪 Kiểm tra và kiểm thử

### Trước khi push

Từ thư mục gốc, chạy `npm run check`. Lệnh này dừng ngay ở bước bị lỗi và lần lượt kiểm tra lint mã giao diện, toàn bộ unit test, test công cụ vận hành, bản build, HTTP/event contracts và audit thư viện production của microservices:

```powershell
npm run check
```

Cũng có thể chạy riêng `npm run lint`, `npm test` và `npm run build` ngay tại thư mục gốc. Lint áp dụng cho mã ứng dụng trong `frontend/src`; các file `*.test.js` được kiểm tra bằng test runner. Lệnh `check` không thay thế các bài integration/browser dùng Docker trong GitHub Actions.

Frontend dùng `frontend/.npmrc` để cài đúng cây thư viện đã khóa: một số thư viện giao diện cũ chưa khai báo React 18 trong peer dependencies. Dùng `npm --prefix frontend ci --ignore-scripts` để cài lại nhất quán trên máy mới và CI.

### Unit Test

Từ thư mục gốc, chạy toàn bộ unit test (backend + frontend + microservices):

```powershell
npm test
```

Chạy kèm báo cáo coverage:

```powershell
npm run test:coverage
```

`npm test` chạy test, còn `npm run test:coverage` vừa chạy test vừa kiểm tra ngưỡng bao phủ trong cấu hình Jest/Vitest. Job `verify` của GitHub Actions chạy coverage cho cả ba phần. Báo cáo HTML nằm trong thư mục `coverage` của từng phần; tỷ lệ chỉ áp dụng cho các file được cấu hình thu thập, không có nghĩa mọi hành vi thực tế đã được kiểm chứng.

Chạy riêng từng phần:

- `npm run test:backend`: test backend bằng Jest.
- `npm run test:frontend`: test giao diện bằng React Testing Library/Jest.
- `npm run test:microservices`: test microservices bằng Vitest.

> ✅ Các unit test **mock toàn bộ** dịch vụ ngoài (DB, RabbitMQ, Redis, ES, SMTP, AI) — không cần khởi động Docker/XAMPP.

### Đọc kết quả trong terminal

- `npm test` chạy backend, frontend rồi microservices. Cần xem cả ba phần tổng kết `Test Suites` / `Test Files` và `Tests`; dòng tổng kết cuối chỉ thuộc microservices.
- Lệnh thành công khi kết thúc với mã thoát `0`. Trong PowerShell, xem `$LASTEXITCODE` ngay sau mỗi lệnh; `npm run check` tự dừng khi một bước thất bại.
- Các bài kiểm tra tình huống mất kết nối, lỗi DB hoặc gửi email thất bại có thể chủ động in `stderr`, `level: error` hoặc `warn`. Đối chiếu tên bài test và tổng kết; màu đỏ của dòng log chưa đủ để kết luận test thất bại.
- `FAIL`, `failed`, lỗi assertion, lỗi coverage threshold hoặc mã thoát khác `0` cần được xử lý. Cảnh báo React `not wrapped in act(...)` cũng cần sửa bước chờ của test; không tắt console để che cảnh báo.
- Cảnh báo `DeprecationWarning` như `util._extend` từ thư viện proxy hoặc `fs.F_OK` trong công cụ build cần được theo dõi khi nâng cấp thư viện. Chúng không đồng nghĩa test/build thất bại. CI dùng Node.js 22; dùng cùng dòng Node khi đối chiếu kết quả máy cá nhân với CI.
- `Compiled successfully` xác nhận tạo được bản build. Để xác nhận luồng hoạt động qua DB, hàng đợi và trình duyệt thật, chạy các bài integration/browser tương ứng bên dưới.

### Smoke Test & Build

```powershell
# Gateway và tình trạng mọi service
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/status

# Kiểm tra frontend build
cd frontend
npm run build

# Smoke test microservices (dùng dữ liệu demo; tạo rồi dọn bản ghi kiểm thử)
cd ..\microservices
npm run test:smoke
```

### Integration & Browser Tests

```powershell
# Authentication
npm run test:auth:integration
npm run test:auth:browser

# Support Chat
npm --prefix microservices run test:support:browser
npm --prefix microservices run test:support:live

# Application sync, admin audit, search projection...
npm --prefix microservices run test:application-sync:integration
npm --prefix microservices run test:admin-audit:integration
npm --prefix microservices run test:compose-browser:integration
```

### Contract Tests

```powershell
# Kiểm tra HTTP & event contracts
npm --prefix microservices run contracts:check
```

---

## 🔄 CI/CD

Dự án sử dụng **GitHub Actions** với 3 workflow:

| Workflow | File | Phạm vi |
| --- | --- | --- |
| Authentication | `authentication.yml` | Kiểm thử module xác thực, session, OIDC |
| Microservices | `microservices.yml` | Unit test, contract check, build validation |
| Realtime | `realtime.yml` | Socket.IO, Redis adapter, chat infrastructure |

---

## 🚢 Triển khai và vận hành

### Release & Deploy

| Lệnh | Mô tả |
| --- | --- |
| `npm run release:prepare` | Chuẩn bị bản release, đóng gói |
| `npm run test:release` | Kiểm thử bản release |
| `npm run deploy:activate` | Kích hoạt phiên bản mới |
| `npm run deploy:status` | Xem trạng thái triển khai |
| `npm run deploy:verify` | Xác minh sau khi kích hoạt |
| `npm run deploy:rollback` | Quay lại phiên bản trước |
| `npm run deploy:observe` | Theo dõi sau triển khai |
| `npm run deploy:resume` | Tiếp tục triển khai bị gián đoạn |

### Backup & Restore

```powershell
# Kiểm thử quy trình backup/restore
npm run test:restore
```

Trình khởi chạy tự động sao lưu MySQL/PostgreSQL/MongoDB vào `.local/backups` mỗi lần khởi động.

### Production Checklist

- Thay toàn bộ secret (JWT_SECRET, INTERNAL_SECRET, mật khẩu DB)
- Đặt `CORS_ORIGIN` đúng domain production
- Dùng tài khoản email chuyên dụng
- Đặt `SUPPORT_AUTO_MIGRATE=false`, chạy migration riêng
- Cấu hình Nginx reverse proxy (xem `scripts/release/nginx.conf`)
- Bật Prometheus alerts (xem `microservices/ops/`)

Chi tiết: [Bộ triển khai và quay lui](microservices/docs/release-preparation.md)

---

## 👥 Tài khoản demo

> Mật khẩu dữ liệu demo: **`123456`**

| Vai trò | Số điện thoại | Tên | Ghi chú |
| --- | --- | --- | --- |
| 🏢 Nhà tuyển dụng | `0795095042` | Nguyễn Văn Tài | Có công ty, gói tin |
| 👤 Ứng viên | `0764188123` | Trần Thị My | Có CV, lịch sử |
| 🛡️ Quản trị viên | `0795095049` | Nguyễn Tuấn Thiền | Full quyền admin |

**Tài khoản kiểm thử bổ sung** (tạo bằng `npm --prefix backend run seed:test-accounts`):

| Vai trò | Số điện thoại |
| --- | --- |
| Admin | `0900000001` |
| Company | `0900000002` |
| Candidate | `0900000003` |

---

## 🔒 Bảo mật và vận hành

- 🔑 **Không commit** `.env`, App Password Gmail, JWT secret, Cloudinary secret hoặc khóa AI.
- 🛡️ API Gateway **xóa header định danh** từ client trước khi gắn identity đã xác thực.
- ⚡ Các route ghi dữ liệu có **rate limit**; quyền pipeline giới hạn theo công ty sở hữu.
- 🔐 Phiên đăng nhập dùng **HttpOnly cookie**, tự gia hạn, thu hồi khi đổi mật khẩu/khóa tài khoản.
- 📡 Notification Service tách **ba kênh** (CSDL, realtime, email) — lỗi một kênh không chặn kênh khác.
- 🤖 Chatbot chỉ lưu sự kiện và token count, **không log nội dung tin nhắn**. Redis giới hạn lượt AI.
- 🔒 Web Push chỉ gửi khi user opt-in; khóa VAPID sinh riêng từng dự án.
- 📊 Prometheus alerts cấu hình sẵn cho monitoring (xem `microservices/ops/`).

---

## 📚 Tài liệu chuyên sâu

### Kiến trúc & Thiết kế

- [Chi tiết kiến trúc microservices](microservices/README.md)
- [Ma trận phân quyền và kiểm soát truy cập](docs/AUTHORIZATION.md)
- [HTTP & Event Contracts](microservices/docs/event-contracts.md)

### Tính năng

- [Cấu hình chatbot AI hỗ trợ](CHATBOT_SETUP.md)
- [Đối chiếu PDF chatbot](docs/chatbot-pdf-implementation.md)
- [Thư mời nhận việc & email](docs/recruitment-offer-email.md)
- [Web Push Notifications](docs/web-push.md)
- [WebSocket & Realtime upgrade](docs/websocket-upgrade.md)
- [Gửi CV/PDF và chia sẻ công việc trong chat](docs/chat-documents.md)
- [Xem trước CV và tài liệu PDF trong toàn hệ thống](docs/document-preview.md)
- [Trang chi tiết việc làm](docs/job-detail-page.md)

### Xác thực & Bảo mật

- [Hướng dẫn SSO & Google OIDC](docs/AUTHENTICATION_SSO_INTEGRATION.md)
- [Đối chiếu tiêu chí báo cáo xác thực](docs/AUTH_REPORT_ACCEPTANCE.md)

### Vận hành & Triển khai

- [Chạy với dữ liệu thật](docs/run-with-real-data.md)
- [Bộ triển khai và quay lui](microservices/docs/release-preparation.md)
- [Kiểm thử kết quả tuyển dụng thật](docs/recruitment-offer-live-test.md)

### Source code tham khảo

- [Template email kết quả](microservices/notification-service/src/templates.js)
- [Giao diện Kanban pipeline](frontend/src/container/system/Cv/KanbanBoard.js)
- [Form thư mời nhận việc](frontend/src/container/system/Cv/OfferLetterForm.js)
- [Support Chat widget](frontend/src/components/support/SupportChat.jsx)
- [Kho kiến thức chatbot](microservices/support-chat-service/src/knowledge.js)
- [API Gateway routing](microservices/api-gateway/src/app.js)
- [Postman Collection](postman/)

---

<div align="center">

**Made with ❤️ by JobFind Team**

</div>
