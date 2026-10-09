<div align="center">

# 🚀 JobFind

### Nền tảng tuyển dụng thông minh tích hợp AI
**Kết nối Ứng viên · Nhà tuyển dụng · Quản trị viên** — tìm việc, nộp CV, sàng lọc hồ sơ, phỏng vấn, gửi kết quả và trò chuyện trên cùng một hệ thống.

[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=111827)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude](https://img.shields.io/badge/AI-Anthropic_Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://www.anthropic.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?style=flat-square&logo=mysql&logoColor=white)](https://mysql.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-8.15-005571?style=flat-square&logo=elasticsearch&logoColor=white)](https://elastic.co)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-4-FF6600?style=flat-square&logo=rabbitmq&logoColor=white)](https://rabbitmq.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=flat-square&logo=socketdotio&logoColor=white)](https://socket.io)
[![Tests](https://img.shields.io/badge/Tests-Jest_·_Vitest_·_Playwright-C21325?style=flat-square&logo=jest&logoColor=white)](#-kiểm-thử)

[**⚡ Bắt đầu nhanh**](#-bắt-đầu-nhanh) · [**✨ Có gì mới**](#-có-gì-mới) · [**🤖 AI**](#-ai-trong-jobfind) · [**🎨 UI/UX**](#-uiux) · [**🧱 Kiến trúc**](#-kiến-trúc-hệ-thống) · [**📚 Tài liệu**](#-tài-liệu-chuyên-sâu)

</div>

---

## 📋 Mục lục

| Sản phẩm | Kỹ thuật | Vận hành |
| --- | --- | --- |
| [✨ Có gì mới](#-có-gì-mới) | [🧱 Kiến trúc hệ thống](#-kiến-trúc-hệ-thống) | [⚡ Bắt đầu nhanh](#-bắt-đầu-nhanh) |
| [🌟 Tổng quan](#-tổng-quan) | [💻 Công nghệ sử dụng](#-công-nghệ-sử-dụng) | [🔧 Cấu hình chi tiết](#-cấu-hình-chi-tiết) |
| [🤖 AI trong JobFind](#-ai-trong-jobfind) | [📁 Cấu trúc thư mục](#-cấu-trúc-thư-mục) | [🔌 Các cổng sử dụng](#-các-cổng-sử-dụng) |
| [🎯 Trải nghiệm theo vai trò](#-trải-nghiệm-theo-vai-trò) | [🔗 API AI](#-api-ai) | [🧪 Kiểm thử](#-kiểm-thử) |
| [🎨 UI/UX](#-uiux) | [🔄 Luồng tuyển dụng](#-luồng-tuyển-dụng-đầu-cuối) | [🚢 Triển khai và vận hành](#-triển-khai-và-vận-hành) |
| [👥 Tài khoản demo](#-tài-khoản-demo) | [🔒 Bảo mật](#-bảo-mật-và-quyền-riêng-tư) | [📚 Tài liệu chuyên sâu](#-tài-liệu-chuyên-sâu) |

---

## ✨ Có gì mới


| Mới | Ai dùng | Điểm nổi bật |
| --- | --- | --- |
| ✍️ **AI viết lời giới thiệu khi nộp CV** | Ứng viên | 2 phương án ≤ 255 ký tự lấy từ CV đang chọn; bấm **Dùng lời giới thiệu này** để điền |
| 🎯 **Kiểm tra độ phù hợp trước khi nộp** | Ứng viên | Điểm 0–100, kỹ năng khớp và kỹ năng chưa thấy trong CV |
| 🧠 **AI sàng lọc hồ sơ trên Kanban** | Nhà tuyển dụng | Chấm cả tin (tối đa 50 hồ sơ/lần), điểm hiện trên thẻ, **Sắp xếp theo điểm AI**, kết quả được lưu |
| 📝 **AI soạn lời nhắn email** | Nhà tuyển dụng | Thư mời phỏng vấn, trúng tuyển, không trúng tuyển; gõ vài ý chính → AI viết đoạn hoàn chỉnh |
| 💬 **Trợ lý AI trong chat** | Cả hai bên | **Gợi ý trả lời** (đồng ý / hỏi thêm / xin đổi lịch) và **Viết lại lịch sự hơn** |
| 🗺️ **Danh mục 34 tỉnh/thành, 12 cấp bậc** | Tất cả | Theo đơn vị hành chính có hiệu lực từ 01/07/2025 |
| ✅ **Tin có nguồn đối chiếu** | Ứng viên | Tin từ trang tuyển dụng chính thức, có liên kết bài gốc, ngày kiểm tra, phủ 34 tỉnh/thành |
| 🔔 **Thông báo từ công ty đang theo dõi** | Ứng viên | Trang `/candidate/notifications`, việc làm từ công ty theo dõi và việc làm gợi ý |
| 📎 **CV/PDF và thẻ tin trong chat** | Cả hai bên | Đính kèm PDF ≤ 5 MB, xem trước ngay trong chat, chia sẻ tin tuyển dụng |

Chi tiết từng chức năng AI: [docs/ai-recruitment.md](docs/ai-recruitment.md) · [docs/ai-cv.md](docs/ai-cv.md)

### 📅 Lịch phỏng vấn

Nhà tuyển dụng mở **Quản lý ứng viên → Lịch phỏng vấn** (`/admin/interviews`); ứng viên mở **Lịch phỏng vấn** trong menu tài khoản (`/candidate/interviews`). Trang lịch sử dụng thư mời đã lưu, hỗ trợ xem theo tháng hoặc danh sách, tìm kiếm và lọc theo hình thức, trạng thái, xem chi tiết và tải tệp `.ics` để thêm vào ứng dụng lịch.

Nhà tuyển dụng có thể chọn hồ sơ để tạo lịch, xem trước thư mời rồi gửi; đổi lịch sử dụng cùng luồng thư mời hiện có trong Kanban. Mỗi hồ sơ hiển thị thư mời gần nhất nên ngày hẹn cũ không xuất hiện lại sau khi đổi lịch. Ngày giờ được tính theo giờ Việt Nam (UTC+7). “Đã qua” chỉ cho biết giờ hẹn đã qua; “Không còn hiệu lực” cho biết hồ sơ đã rời bước phỏng vấn. Ứng viên xác nhận hoặc trao đổi qua email HR được ghi trong thư mời.

API: `GET /api/applications/interviews` giới hạn theo công ty (quản trị viên có quyền xem toàn hệ thống); `GET /api/my-interviews` chỉ trả về lịch của tài khoản đang đăng nhập. Cả hai nhận bộ lọc ngày `from`, `to`; API nhà tuyển dụng còn nhận `jobId`. Dữ liệu lấy từ `application_events.decision_snapshot`, không cần thêm bảng hay chạy migration. Kiểm thử giao diện: `npm run test:interviews:browser`.

---

## 🌟 Tổng quan

JobFind là nền tảng tuyển dụng gồm website React, backend Node.js và **9 microservice** giao tiếp qua RabbitMQ. Hệ thống phục vụ ba nhóm người dùng với khu vực riêng, phân quyền theo vai trò và theo công ty.

<table>
<tr>
<td width="33%" valign="top">

### 👤 Ứng viên
Tìm việc bằng Elasticsearch, lưu việc, theo dõi công ty, tạo CV bằng AI, nộp hồ sơ, theo dõi tiến trình, nhận email phỏng vấn/kết quả và nhắn tin với nhà tuyển dụng.

</td>
<td width="33%" valign="top">

### 🏢 Nhà tuyển dụng
Đăng tin (AI kiểm duyệt), tìm ứng viên, quản lý hồ sơ trên Kanban 6 cột, AI sàng lọc CV, gửi thư mời phỏng vấn/nhận việc, chat và quản lý nhân sự công ty.

</td>
<td width="33%" valign="top">

### 🛡 Quản trị viên
Quản lý người dùng, công ty, tin đăng, danh mục, gói dịch vụ; duyệt tin; dashboard báo cáo, audit log và tiếp nhận yêu cầu hỗ trợ từ chatbot.

</td>
</tr>
</table>

### 🌈 Tính năng nổi bật

| Nhóm | Tính năng | Mô tả |
| --- | --- | --- |
| 🤖 AI | **AI cho CV** | Tạo bản nháp CV, đọc CV PDF, đánh giá độ phù hợp, viết thư ứng tuyển — [hướng dẫn](docs/ai-cv.md) |
| 🤖 AI | **AI trong tuyển dụng** | Lời giới thiệu khi nộp CV, sàng lọc CV trên Kanban, soạn lời nhắn email, trợ lý chat — [hướng dẫn](docs/ai-recruitment.md) |
| 🤖 AI | **Kiểm duyệt tin bằng AI** | Phát hiện lừa đảo, đa cấp, thu phí ứng viên, phân biệt đối xử trước khi tin hiển thị |
| 🤖 AI | **Chatbot hỗ trợ đa nhà cung cấp** | Claude / OpenAI / Gemini / Ollama, tra cứu theo tài khoản, chuyển nhân viên hỗ trợ — [cấu hình](CHATBOT_SETUP.md) |
| 🔍 Tìm kiếm | **Elasticsearch** | Full-text, gợi ý khi gõ, bộ lọc nhiều lựa chọn (lương, cấp bậc, hình thức, kinh nghiệm) |
| 🔍 Tìm kiếm | **Tìm ứng viên phù hợp** | Lọc theo kỹ năng/ngành/địa điểm, chấm điểm có giải thích — [hướng dẫn](docs/candidate-search.md) |
| 📋 Tuyển dụng | **Kanban Pipeline** | Kéo thả 6 trạng thái, chấm sao, ghi chú nội bộ, lịch sử, talent pool, phễu tuyển dụng |
| ✉️ Email | **Email tuyển dụng** | Thư mời phỏng vấn (Google Calendar), thư mời nhận việc, thư cảm ơn sau phỏng vấn; `Reply-To` về HR |
| 💬 Realtime | **Chat & thông báo** | Socket.IO, đang gõ, đã đọc, gửi tin đáng tin cậy, đính kèm PDF, Web Push cho tin nhắn mới |
| 📄 Tài liệu | **Xem trước PDF thống nhất** | Một trình xem PDF dùng chung: chuyển trang, phóng to, tải bản gốc — [chi tiết](docs/document-preview.md) |
| 🔐 Bảo mật | **HttpOnly Session & Google SSO** | Cookie bảo mật, tự gia hạn, thu hồi phiên, lịch sử bảo mật, OIDC |
| 📊 Báo cáo | **Dashboard & Audit** | Chart.js/Recharts, chuỗi thời gian, phân bố, phễu, nhật ký hoạt động |
| 💳 Thanh toán | **PayPal Sandbox** | Gói đăng tin và gói xem CV |
| 🐇 Kiến trúc | **Event-driven** | RabbitMQ, outbox cùng giao dịch, hợp đồng HTTP/sự kiện có phiên bản, circuit breaker |

---

## 🤖 AI trong JobFind

AI chạy trong **AI Worker** (không mở cổng HTTP) và nhận việc qua RabbitMQ, nên một đợt yêu cầu lớn chỉ làm hàng đợi dài ra chứ không làm nghẽn API. Khóa API chỉ nằm ở máy chủ (`microservices/.env`), không bao giờ ở frontend.

### 🗺 AI theo hành trình người dùng

| Bước | Ứng viên | Nhà tuyển dụng |
| --- | --- | --- |
| 📝 **Chuẩn bị** | Tạo CV từ thông tin tự nhập, đọc CV PDF thành dữ liệu có cấu trúc, viết thư ứng tuyển (`/candidate/ai-cv`) | Tin đăng mới được AI kiểm duyệt trước khi hiển thị |
| 📨 **Nộp hồ sơ** | Viết lời giới thiệu ≤ 255 ký tự, kiểm tra độ phù hợp với tin | — |
| 🔎 **Sàng lọc** | — | Đối chiếu CV ở trang tìm ứng viên; **AI sàng lọc hồ sơ** đã nộp trên Kanban, xếp theo điểm |
| ✉️ **Thông báo kết quả** | Nhận email có lời nhắn cá nhân | **AI soạn lời nhắn** cho thư mời phỏng vấn / trúng tuyển / từ chối |
| 💬 **Trao đổi** | Gợi ý trả lời, viết lại tin nhắn | Gợi ý trả lời, viết lại tin nhắn |
| 🆘 **Hỗ trợ** | Chatbot hỏi đáp, tìm việc, tra cứu hồ sơ | Chatbot hỏi đáp, tra cứu tin của công ty |

### 🧩 Tác vụ AI Worker

| Tác vụ | Sự kiện RabbitMQ | Kết quả |
| --- | --- | --- |
| Resume Parser | `ai.parse_resume` | CV PDF → JSON có cấu trúc |
| CV Generator | `ai.generate_cv` | Bản nháp CV từ thông tin ứng viên |
| Smart Matching | `ai.match_cv` | Điểm 0–100, kết luận, kỹ năng khớp/thiếu, điểm mạnh, nội dung cần trao đổi |
| Content Moderation | `ai.moderate_job` | Duyệt / chặn tin, mức rủi ro, loại vi phạm |
| Cover Letter | `ai.cover_letter` | Thư ứng tuyển tiếng Việt hoặc tiếng Anh |
| **Writing Assistant** 🆕 | `ai.write_assist` | Bản nháp ngắn: lời giới thiệu, lời nhắn email, gợi ý/viết lại tin nhắn chat |

### ⚙️ Cách một yêu cầu AI được xử lý

```mermaid
sequenceDiagram
    autonumber
    participant U as 🧑 Người dùng (React)
    participant G as API Gateway
    participant J as Job Core Service
    participant Q as RabbitMQ
    participant W as AI Worker
    participant C as Claude
    U->>G: POST /api/ai/... + Idempotency-Key
    G->>J: JWT hợp lệ + kiểm tra quyền
    J->>J: Lưu ai_tasks + outbox trong 1 giao dịch
    J-->>U: 202 Accepted + taskId
    J->>Q: Phát sự kiện tác vụ
    Q->>W: Nhận việc (ledger MongoDB chống chạy trùng)
    W->>C: Prompt + JSON Schema
    C-->>W: Kết quả có cấu trúc
    W->>Q: ai.result
    Q->>J: Lưu kết quả vào ai_tasks
    U->>G: GET /api/ai/tasks/:taskId (hỏi định kỳ)
    G-->>U: Bản nháp / điểm để người dùng xem và sửa
```

> [!IMPORTANT]
> **Nguyên tắc an toàn của AI**
> - AI **không tự gửi** email/tin nhắn, **không tự chuyển bước** hay loại ứng viên.
> - Chỉ dùng sự thật có trong CV/hội thoại; không bịa kinh nghiệm, lương, ngày giờ hay cam kết.
> - Khi chấm CV, AI **bỏ qua tuổi, giới tính, vùng miền, tôn giáo, tình trạng hôn nhân, sức khỏe**.
> - Nội dung người dùng được coi là dữ liệu không đáng tin, không phải chỉ dẫn (chống prompt injection).
> - Mỗi lần bấm là một lượt gọi AI; gửi lại do lỗi mạng dùng **cùng Idempotency-Key** nên không bị tính hai lần.

---

## 🎯 Trải nghiệm theo vai trò

### 👤 Ứng viên

- **Khám phá việc làm** (`/job`): tìm theo từ khóa có gợi ý khi gõ, lọc ngành nghề, 34 tỉnh/thành, mức lương, cấp bậc, hình thức, kinh nghiệm (chọn nhiều giá trị). Trang lưu bộ lọc, trang kết quả và vị trí cuộn khi quay lại.
- **Tin có nguồn đối chiếu** (`/external-job/:id`): tin từ trang tuyển dụng chính thức, có liên kết bài gốc, ngày kiểm tra và hạn nộp — [chi tiết](docs/verified-jobs.md).
- **Chi tiết việc làm** (`/detail-job/:id`): thông tin công ty, yêu cầu, quyền lợi; lưu việc, theo dõi công ty, nhắn tin cho nhà tuyển dụng, nút **Chuẩn bị CV / thư với AI**.
- **Nộp CV** 🆕: chọn tệp PDF, CV online hoặc CV đã chuẩn bị; xem trước PDF; **Trợ lý AI ứng tuyển** viết lời giới thiệu và kiểm tra độ phù hợp.
- **Không gian AI** (`/candidate/ai-cv`): tạo CV bằng AI, đọc CV từ PDF, đánh giá độ phù hợp, soạn thư ứng tuyển; lưu CV và xuất PDF.
- **Công việc đã nộp** (`/candidate/cv-post`): tiến trình từng hồ sơ theo các bước tuyển dụng.
- **Thông báo** (`/candidate/notifications`): lịch sử thông báo, đánh dấu đã đọc; **việc làm từ công ty đang theo dõi** (`/candidate/followed-jobs`) và **việc làm gợi ý** (`/candidate/recommended-jobs`) — [chi tiết](docs/company-follow-notifications.md).
- **Việc làm đã lưu**, **cài đặt tài khoản** (CV online, tùy chọn nhận email gợi ý việc làm), **bảo mật** (`/account/security`).
- **Tin nhắn** (`/chat`): chat realtime, gửi CV/PDF, chia sẻ tin tuyển dụng, **gợi ý trả lời và viết lại bằng AI** 🆕.
- **Email tuyển dụng**: thư mời phỏng vấn (thêm vào Google Calendar), thư mời nhận việc, thư cảm ơn sau phỏng vấn; trả lời email là gửi thẳng tới HR.
- **Chatbot hỗ trợ**: hỏi đáp, tìm tin công khai, tra cứu hồ sơ của mình, lịch sử hội thoại, chuyển nhân viên hỗ trợ.

### 🏢 Nhà tuyển dụng

- **Quản lý công ty**: thông tin, logo, giấy tờ PDF; chủ công ty quản lý nhân viên tuyển dụng (`EMPLOYER`).
- **Tin tuyển dụng**: đăng mới, sửa (chống ghi đè bằng `editRevision`), đăng lại tin hết hạn; tin mới chờ **AI kiểm duyệt**; quản lý gói đăng tin.
- **Tìm ứng viên phù hợp** (`/admin/list-candiate/`): bắt đầu từ tin của công ty, khớp một/tất cả kỹ năng, điểm có giải thích; mở hồ sơ để **đối chiếu CV bằng AI** — [hướng dẫn](docs/candidate-search.md).
- **Pipeline Kanban** (`/admin/pipeline`):

  | Trạng thái | Ý nghĩa |
  | --- | --- |
  | 🆕 Mới ứng tuyển | Hồ sơ vừa nộp |
  | 🔍 Đang xem xét | HR đang đánh giá |
  | 🎤 Phỏng vấn | Đã gửi thư mời phỏng vấn |
  | 📨 Đề nghị nhận việc | Đã gửi thư mời nhận việc, chờ phản hồi |
  | ✅ Đã nhận việc | Ứng viên xác nhận |
  | ❌ Từ chối | Không phù hợp |

  - Kéo thả giữa các cột, chấm sao, ghi chú nội bộ (ứng viên không thấy), lịch sử xử lý, lưu vào kho ứng viên, phễu và tỷ lệ tuyển thành công.
  - **AI sàng lọc hồ sơ** 🆕: chọn một tin → AI chấm các hồ sơ chưa có kết quả (bỏ qua hồ sơ đã từ chối/đã nhận việc), điểm hiện trên thẻ, bật **Sắp xếp theo điểm AI**.
  - **Đánh giá CV so với tin tuyển dụng** 🆕 trong chi tiết hồ sơ: điểm, kết luận, kỹ năng phù hợp/còn thiếu, điểm mạnh, nội dung cần trao đổi; chấm lại khi cần.
  - **Thư mời phỏng vấn**: ngày giờ (giờ Việt Nam), trực tiếp/trực tuyến/điện thoại, địa điểm hoặc link, người phỏng vấn, hạn xác nhận; xem trước rồi gửi; gửi lại khi đổi lịch — [hướng dẫn](docs/recruitment-interview-email.md).
  - **Thư mời nhận việc**: ngày giờ, địa điểm/link, người liên hệ, hạn phản hồi, lương, thử việc, phúc lợi, giấy tờ, hướng dẫn ngày đầu — [hướng dẫn](docs/recruitment-offer-email.md).
  - **AI soạn lời nhắn** 🆕 cho cả ba loại thư; nhà tuyển dụng duyệt và sửa trước khi gửi.
- **Tin nhắn** (`/admin/chat`): trao đổi với ứng viên, xem CV ứng viên gửi, chia sẻ tin, trợ lý AI soạn tin 🆕.

### 🛡 Quản trị viên

- Quản lý người dùng, công ty, tin đăng, danh mục (ngành nghề, kỹ năng, cấp bậc, mức lương, hình thức, kinh nghiệm), gói dịch vụ và lịch sử giao dịch.
- Duyệt/từ chối/chặn tin với ghi chú; người theo dõi công ty nhận thông báo khi tin được duyệt.
- **Báo cáo** (`/admin/reports`): tổng quan, chuỗi thời gian, phân bố, phễu tuyển dụng, nhật ký hoạt động.
- **Hỗ trợ** (`/admin/support`): tiếp nhận yêu cầu từ chatbot, xem hội thoại, nhận xử lý và đánh dấu hoàn tất.

---

## 🎨 UI/UX

Giao diện ưu tiên **thao tác nhanh**, **trạng thái rõ ràng**, **không mất ngữ cảnh** và **AI luôn ở vai trò trợ lý**.

### 🧭 Nguyên tắc thiết kế

| Nguyên tắc | Cách áp dụng |
| --- | --- |
| 👀 **Người dùng luôn kiểm soát** | Kết quả AI hiện trong khung gợi ý riêng với nút **Dùng nội dung này** / **Bỏ qua**; không tự điền đè, không tự gửi |
| 🏷 **AI dễ nhận biết** | Nhãn **AI** màu xanh ngọc, nút và khung gợi ý cùng tông màu, ghi rõ dữ liệu nào được gửi tới dịch vụ AI |
| ⏳ **Trạng thái rõ ràng** | "AI đang viết…", "AI đang chấm…", nút **Dừng chờ**; điểm trên thẻ Kanban tự cập nhật khi có kết quả |
| 💸 **Xác nhận trước thao tác tốn phí** | Hộp xác nhận số hồ sơ trước khi sàng lọc hàng loạt và trước khi chấm lại |
| 🔁 **An toàn khi mất mạng** | Gửi lại dùng cùng mã yêu cầu; tin nhắn chưa xác nhận giữ nguyên nội dung kèm nút gửi lại |
| ♿ **Truy cập được** | Nhãn `aria-label`, `role="status"`/`role="alert"` cho thông báo, thao tác bằng bàn phím trên Kanban và menu |

### 🖼 Theo từng khu vực

| Khu vực | Trải nghiệm |
| --- | --- |
| 🏠 **Trang chủ** | Banner gọn, danh mục ngành nghề, việc làm nổi bật và việc làm gợi ý cho ứng viên |
| 🔍 **Tìm việc** | Bộ lọc bên trái, thẻ việc làm bên phải, gợi ý khi gõ, giữ bộ lọc và vị trí cuộn khi quay lại; định dạng thời gian tiếng Việt |
| 📄 **Chi tiết việc làm** | Bố cục 2 cột: nội dung tin bên trái; thẻ công ty, nút **Nộp CV ngay**, chuẩn bị CV với AI và nhắn tin bên phải |
| 📨 **Nộp CV** 🆕 | Chọn nguồn CV, xem trước PDF, khung **Trợ lý AI ứng tuyển** với 2 phương án lời giới thiệu và thẻ điểm phù hợp |
| 📱 **Header** | Logo, điều hướng, tìm kiếm nhanh; chuông thông báo và tin nhắn chưa đọc cập nhật realtime |
| 🔧 **Khu quản trị** | Sidebar accordion theo vai trò, chỉ mở một nhóm, đánh dấu trang hiện tại, sidebar dài cuộn riêng |
| 📋 **Kanban** 🆕 | Mã màu từng giai đoạn, kéo thả phản hồi ngay, modal chi tiết giữ ngữ cảnh bảng; thanh công cụ **AI sàng lọc hồ sơ** + **Sắp xếp theo điểm AI**; huy hiệu điểm 4 mức màu (xanh lá ≥ rất phù hợp, xanh dương phù hợp, vàng cần cân nhắc, đỏ chưa phù hợp) |
| ✉️ **Gửi kết quả** 🆕 | Ba nút tím (mời phỏng vấn) / xanh (trúng tuyển) / đỏ (không trúng tuyển), hộp xác nhận người nhận; ô lời nhắn có thanh **AI soạn lời nhắn** chọn loại thư; lịch sử hiện nội dung thư đã gửi |
| 📧 **Email** | Bố cục thẻ, nhãn trạng thái, màu theo ngữ cảnh; CSS inline tương thích Gmail/Outlook/mobile |
| 💬 **Chat** 🆕 | Messenger 2 panel, avatar, đang gõ, đã đọc, đính kèm PDF, thẻ tin tuyển dụng; hàng nút AI gọn phía trên ô soạn, gợi ý dạng thẻ bấm để điền |
| 🤖 **Chatbot hỗ trợ** | Widget nổi góc phải, Markdown, lịch sử theo tài khoản, chỉ đóng khi bấm ×, giữ bản nháp |
| 📊 **Dashboard** | Biểu đồ tròn/cột/đường (Chart.js, Recharts), bộ lọc khoảng thời gian |
| 🔐 **Đăng nhập** | Đăng nhập bằng email hoặc số điện thoại, ghi nhớ 14 ngày, cảnh báo Caps Lock, Google SSO (khi cấu hình) |
| 📱 **Responsive** | Desktop/tablet/mobile, menu hamburger, khoảng cách và chiều cao danh sách co theo nội dung — [kiểm tra bố cục](docs/layout-spacing-validation.md) |

---

## 🧱 Kiến trúc hệ thống

```mermaid
flowchart LR
    subgraph Client["🖥 Client"]
        UI["React 18 SPA<br/>:3000"]
    end

    subgraph Edge["🚪 Gateway"]
        GW["API Gateway :4000<br/>JWT · RBAC · rate limit · contracts"]
    end

    subgraph Services["⚙ Services"]
        Legacy["Backend legacy :5000<br/>Socket.IO hub"]
        Identity["Identity :4001"]
        Job["Job Core :4002<br/>tin · tác vụ AI"]
        Search["Search :4003"]
        Apps["Application :4004<br/>Kanban"]
        Notify["Notification :4005"]
        Admin["Admin & Reporting :4006"]
        Support["Support Chat :4008"]
        AI["🤖 AI Worker"]
    end

    subgraph Data["🗄 Data"]
        MySQL[("MySQL / XAMPP")]
        Postgres[("PostgreSQL")]
        Mongo[("MongoDB")]
        ES[("Elasticsearch")]
        Redis[("Redis")]
    end

    MQ{{"🐇 RabbitMQ"}}
    Claude(["Anthropic Claude"])
    Mail(["Gmail SMTP"])

    UI -->|"REST · Socket.IO"| GW
    GW --> Legacy & Identity & Job & Search & Apps & Admin & Support
    Legacy --> MySQL
    Job --> MySQL
    Apps --> Postgres
    Identity --> Mongo
    Admin --> Mongo
    Search --> ES
    Support --> MySQL & ES
    Notify --> MySQL
    GW --> Redis
    Legacy & Job & Apps -->|outbox| MQ
    MQ --> Search & AI & Notify & Admin & Apps
    MQ -->|ai.result| Job
    AI --> Mongo
    AI --> Claude
    Support --> Claude
    Notify --> Mail
    Notify --> Legacy
```

### 📦 Các service

| Service | Cổng | Kho dữ liệu | Trách nhiệm |
| --- | ---: | --- | --- |
| `api-gateway` | 4000 | Redis | Cổng API duy nhất: JWT, RBAC, xóa header định danh giả, rate limit, kiểm tra hợp đồng, proxy Socket.IO |
| `identity-service` | 4001 | MongoDB | Hồ sơ cá nhân, CV Builder |
| `job-core-service` | 4002 | MySQL | Ghi tin tuyển dụng, quota gói tin, kiểm duyệt, **tạo tác vụ AI và lưu kết quả**, lưu kết quả sàng lọc CV |
| `search-service` | 4003 | Elasticsearch | Đánh chỉ mục, tìm kiếm full-text, gợi ý, đồng bộ CQRS |
| `application-service` | 4004 | PostgreSQL | Pipeline Kanban, ghi chú, chấm sao, talent pool, phễu, thư mời/kết quả |
| `notification-service` | 4005 | MySQL | Lưu thông báo, gửi email (Nodemailer/Gmail), đẩy realtime qua backend |
| `admin-service` | 4006 | MongoDB | Báo cáo, master data, audit log sự kiện và thao tác |
| `support-chat-service` | 4008 | MySQL, Elasticsearch | Chatbot đa nhà cung cấp, kho kiến thức, hội thoại, chuyển nhân viên |
| `ai-worker` | — | MongoDB (ledger) | Xử lý 6 loại tác vụ AI qua RabbitMQ, không mở cổng HTTP |
| `backend` (legacy) | 5000 | MySQL | API gốc, Socket.IO, phiên đăng nhập, chat, CV đã nộp, Web Push, lịch gửi email gợi ý việc làm |

> [!TIP]
> Hợp đồng HTTP (OpenAPI 3.1) và sự kiện (JSON Schema) được **sinh từ một nguồn** trong `microservices/shared/contracts` và kiểm tra trong CI bằng `npm --prefix microservices run contracts:check`. Gateway tự đăng ký mọi API `/api/ai/*` từ danh sách hợp đồng.

---

## 🔄 Luồng tuyển dụng đầu cuối

```mermaid
flowchart LR
    A["🔍 Ứng viên tìm việc"] --> B["📨 Nộp CV<br/>✨ AI viết lời giới thiệu<br/>✨ kiểm tra độ phù hợp"]
    B --> C["🆕 Kanban: Mới ứng tuyển"]
    C --> D["🧠 AI sàng lọc<br/>điểm trên thẻ"]
    D --> E["🎤 Mời phỏng vấn<br/>✨ AI soạn lời nhắn"]
    E --> F{"Kết quả"}
    F -->|Trúng tuyển| G["📨 Thư mời nhận việc"]
    F -->|Chưa phù hợp| H["💌 Thư cảm ơn / từ chối"]
    G --> I["✅ Đã nhận việc"]
    C -.-> J["💬 Chat realtime<br/>✨ gợi ý trả lời"]
```

1. Ứng viên nộp CV qua backend legacy; sự kiện `application.submitted` tạo hồ sơ trong `application-service`.
2. Nhà tuyển dụng mở `/admin/pipeline`, chọn tin và bấm **AI sàng lọc hồ sơ**; `job-core-service` đọc CV đã nộp ngay tại máy chủ, chỉ với CV thuộc tin của chính công ty.
3. **Mời phỏng vấn** (hoặc kéo thẻ vào cột Phỏng vấn) → điền lịch → **AI soạn lời nhắn** (tùy chọn) → xem trước → gửi.
4. Sau phỏng vấn: **Gửi trúng tuyển** (thư mời nhận việc) hoặc **Gửi không trúng tuyển** (ứng viên đã phỏng vấn nhận thư cảm ơn).
5. `application-service` cập nhật bước, lưu nội dung thư vào lịch sử và phát `application.interview_invitation_requested` / `application.decision_email_requested` qua outbox cùng giao dịch.
6. `notification-service` lưu thông báo trong ứng dụng, đẩy realtime nếu ứng viên đang online và gửi email có `Reply-To` về HR.

> [!NOTE]
> Email dùng địa chỉ lưu trong hồ sơ tại thời điểm ứng tuyển; ứng viên đổi hồ sơ sau đó không làm thay đổi dữ liệu tuyển dụng đã ghi.

---

## 🔗 API AI

Mọi API ghi trả `202` cùng `taskId`; đọc kết quả bằng `GET /api/ai/tasks/:taskId`. Hỗ trợ header `Idempotency-Key`.

| API | Quyền | Đầu vào chính | Kết quả |
| --- | --- | --- | --- |
| `POST /api/ai/parse-resume` | Ứng viên | `fileBase64` (PDF ≤ 5 MiB) | CV có cấu trúc |
| `POST /api/ai/generate-cv` | Ứng viên | `sourceText`, `language`, `jobId?` | Bản nháp CV |
| `POST /api/ai/match-cv` | Ứng viên, NTD | `jobId` + `resumeText` hoặc `fileBase64` | Điểm và nhận xét |
| `POST /api/ai/cover-letter` | Ứng viên | `resumeText`, `jobId`, `language` | Thư ứng tuyển |
| `POST /api/ai/application-intro` 🆕 | Ứng viên | `jobId`, `fileBase64`, `language?` | ≤ 2 lời giới thiệu (≤ 255 ký tự) |
| `POST /api/ai/candidate-message` 🆕 | COMPANY / EMPLOYER | `jobId`, `emailType`, `candidateName?`, `recruiterNotes?`, `interviewed?` | 1 lời nhắn email |
| `POST /api/ai/chat-assist` 🆕 | Ứng viên, NTD | `mode: suggest` + `messages`, hoặc `mode: polish` + `draft` | 3 gợi ý / 1 bản viết lại |
| `POST /api/ai/screen-application` 🆕 | COMPANY / EMPLOYER | `cvId` (CV nộp vào tin của công ty) | Tác vụ `match_cv` |
| `GET /api/ai/jobs/:id/screenings` 🆕 | COMPANY / EMPLOYER | — | Kết quả mới nhất theo từng CV của tin |
| `GET /api/ai/tasks/:taskId` | Người tạo tác vụ | — | `pending` / `done` / `failed` + kết quả |

Đặc tả đầy đủ: [`microservices/contracts/http/gateway.openapi.json`](microservices/contracts/http/gateway.openapi.json)

---

## 💻 Công nghệ sử dụng

| Lớp | Công nghệ |
| --- | --- |
| 🖥 **Frontend** | React 18.3, React Router 7, Create React App 5, Axios, SCSS, Ant Design 5, Reactstrap, React Toastify, Socket.IO Client 4.8, Chart.js 4, Recharts 2, assistant-ui, pdf-lib, PDF.js / React-PDF, markdown-it |
| 🧩 **Backend legacy** | Node.js ≥ 22.12, Express 5, Sequelize 6, MySQL, Socket.IO 4.8 (Redis Streams adapter), JWT, Nodemailer, node-schedule, bcryptjs, web-push, openid-client, Cloudinary, PayPal SDK, AJV |
| 🐳 **Microservices** | Node.js 22, Express 4, Docker Compose, RabbitMQ 4, Redis 7, Ajv 2020 contracts, Prometheus |
| 🗄 **Cơ sở dữ liệu** | MySQL 8 (XAMPP), PostgreSQL 16, MongoDB 7, Elasticsearch 8.15 |
| 🤖 **AI** | Anthropic Claude qua `@anthropic-ai/sdk` (AI Worker, structured outputs + JSON Schema), Vercel AI SDK cho chatbot (Claude, OpenAI, Gemini, Ollama), pdfjs-dist trích chữ PDF |
| 🔗 **Tích hợp** | Gmail App Password, Cloudinary, PayPal Sandbox, Google OIDC SSO, Web Push (VAPID) |
| 🧪 **Kiểm thử** | Jest 30, Vitest 4, React Testing Library, Playwright 1.62 |
| 🚀 **DevOps** | GitHub Actions, Docker multi-stage build, Nginx (production), Prometheus alerts |

---

## 📁 Cấu trúc thư mục

<details>
<summary><b>Xem cây thư mục</b></summary>

```text
job_find/
├── 📂 backend/                       # API legacy, Socket.IO hub, Sequelize/MySQL
│   ├── src/
│   │   ├── config/                   # DB, Socket.IO, Redis adapter
│   │   ├── controllers/              # auth, user, post, cv, chat, chatMedia, company, notification,
│   │   │                             #   package, webPush, supportBridge, supportChat...
│   │   ├── middlewares/              # JWT, RBAC, rate limit, quyền chat hỗ trợ
│   │   ├── models/                   # Sequelize: user, post, company, cv, chat, notification,
│   │   │                             #   payment, auth session, web push...
│   │   ├── routes/web.js             # Định tuyến API tập trung
│   │   ├── services/                 # Nghiệp vụ: chat, cv, candidate search, auth session, OIDC...
│   │   ├── contracts/                # Bản sao hợp đồng sự kiện (sinh tự động)
│   │   ├── migrations/ · seeders/
│   │   └── utils/                    # schedule (email gợi ý việc làm), skillMatch, outbox...
│   ├── scripts/                      # Seed demo, kiểm thử tích hợp/trình duyệt, công cụ dữ liệu
│   └── tests/                        # Jest
│
├── 📂 frontend/                      # React 18 SPA
│   └── src/
│       ├── auth/                     # RouteGuard, RBAC, authClient, phiên đăng nhập
│       ├── container/
│       │   ├── home/ · JobPage/ · JobDetail/ · Company/
│       │   ├── Candidate/            # Hồ sơ, CandidateAi, thông báo, việc đã lưu/nộp
│       │   ├── Chat/                 # ChatPage, gửi tin đáng tin cậy, đồng bộ hội thoại
│       │   └── system/               # Khu quản trị
│       │       └── Cv/               # KanbanBoard, KanbanAi 🆕, OfferLetterForm,
│       │                             #   InterviewInvitationForm, RecruiterAiReview, FilterCv
│       ├── components/
│       │   ├── chat/                 # ChatAiAssist 🆕, đính kèm PDF, thẻ tin
│       │   ├── modal/                # SendCvModal, ApplicationAiHelper 🆕, PreparedCvPicker
│       │   ├── documents/            # Trình xem PDF dùng chung
│       │   └── support/              # Widget chatbot, hộp hỗ trợ admin
│       ├── data/                     # verifiedJobs.json, verifiedJobDetails.json
│       └── service/                  # aiSearchService, aiAssist 🆕, aiTaskPolling,
│                                     #   applicationService, candidateWorkspace...
│
├── 📂 microservices/
│   ├── docker-compose.yml            # 9 service + MongoDB, Elasticsearch, PostgreSQL, Redis, RabbitMQ
│   ├── compose.local.yml · compose.runtime.yml   # Local dev, monitoring (Prometheus)
│   ├── api-gateway/                  # Proxy, JWT, RBAC, rate limit, routing theo hợp đồng
│   ├── job-core-service/             # Tin tuyển dụng + aiController, aiAssistController 🆕
│   ├── ai-worker/
│   │   └── src/jobs/                 # resumeParser, cvGenerator, smartMatching, moderation,
│   │                                 #   coverLetter, writeAssist 🆕
│   ├── application-service/ · notification-service/ · search-service/
│   ├── identity-service/ · admin-service/ · support-chat-service/
│   ├── shared/                       # events, contracts (operations, schemas, eventCatalog),
│   │                                 #   accessControl, outbox, rabbitmq, logger
│   ├── contracts/                    # OpenAPI + JSON Schema đã sinh
│   ├── ops/                          # prometheus.yml, alerts.yml
│   ├── scripts/ · docs/ · tests/     # Công cụ, tài liệu kỹ thuật, Vitest
│
├── 📂 docs/                          # Hướng dẫn tính năng và vận hành (xem mục Tài liệu)
├── 📂 database/                      # Dump MySQL mẫu + README_DATA.md
├── 📂 scripts/                       # dev launcher, backup/restore, release, tin có nguồn
├── 📂 postman/                       # Collection & environment
├── 📂 .github/workflows/             # authentication, microservices, realtime
├── package.json                      # Lệnh gốc: start, check, test, deploy...
└── CHATBOT_SETUP.md                  # Cấu hình chatbot AI
```

</details>

---

## ⚡ Bắt đầu nhanh

### ✅ Điều kiện

| Yêu cầu | Chi tiết |
| --- | --- |
| **Node.js** | 22.12 trở lên |
| **Docker Desktop** | Compose V2 |
| **XAMPP / MySQL** | Database `jobfindtest`, cổng `3333` |
| **RAM** | Tối thiểu 8 GB (Elasticsearch dùng 512 MB–1 GB) |
| **Khóa AI** (tùy chọn) | `ANTHROPIC_API_KEY` trong `microservices/.env` để bật các chức năng AI |

### 🚀 Một lệnh khởi chạy

```powershell
# Từ thư mục gốc D:\job_find
npm start
```

Mở **http://localhost:3000** — trong lúc khởi động, trang hiển thị tiến độ rồi tự vào ứng dụng khi sẵn sàng. Lệnh in `Ứng dụng sẵn sàng: http://localhost:3000` khi hoàn tất.

Trình khởi chạy sẽ:
1. Đọc `backend/.env` và `microservices/.env`, kiểm tra `JWT_SECRET`/`INTERNAL_SECRET` khớp nhau.
2. Mở Docker Desktop nếu chưa chạy; chờ và nhắc bật MySQL (XAMPP) thay vì dừng.
3. Sao lưu MySQL, PostgreSQL, MongoDB vào `.local/backups`.
4. Dựng các service từ mã nguồn hiện tại, chạy backend và frontend.
5. Chỉ bật AI Worker khi đã có `ANTHROPIC_API_KEY`.

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev:status` | Tiến độ, trạng thái, kênh email (`gmail`/`off`) |
| `npm run dev:check` | Đối chiếu dữ liệu API với MySQL thật, không tạo dữ liệu |
| `npm run dev:stop` | Dừng ứng dụng, giữ nguyên dữ liệu |
| `npm run seed:demo-data` | Bổ sung bộ dữ liệu demo (thêm `-- --dry-run` để xem trước) |
| `npm run demo:hide-jobs` / `demo:show-jobs` | Ẩn/hiện các tin `[Demo]` |
| `npm run auth:migrate` · `chat:migrate` · `catalog:migrate` | Migration xác thực, đính kèm chat, danh mục 34 tỉnh |
| `npm run jobs:verify` · `jobs:sync` · `jobs:discover` | Kiểm tra/đồng bộ/tìm tin có nguồn đối chiếu |

> [!TIP]
> Đã sửa mã microservices? Chạy lại `npm start` để dựng lại image — chỉ tải lại trình duyệt không cập nhật mã trong container. Xem thêm [Chạy với dữ liệu thật](docs/run-with-real-data.md).

---

## 🔧 Cấu hình chi tiết

<details>
<summary><b>1️⃣ Backend legacy — <code>backend/.env</code></b></summary>

```env
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3333
DB_NAME=jobfindtest
DB_USER=root
DB_PASSWORD=
# Bắt buộc: chuỗi ngẫu nhiên ≥ 32 ký tự, dùng cùng giá trị ở microservices/.env
JWT_SECRET=
INTERNAL_SECRET=
URL_REACT=http://localhost:3000
RABBITMQ_URL=amqp://jobportal:MAT_KHAU_NGAU_NHIEN@localhost:5673
# Tùy chọn: chuyển đường chat cũ sang chatbot ở Gateway (không cần sao chép API key)
SUPPORT_CHAT_GATEWAY_URL=http://localhost:4000/api/support-chat
```

Chạy thủ công:

```powershell
cd backend
npm install
npm start          # http://localhost:5000 (API + Socket.IO)
```

</details>

<details>
<summary><b>2️⃣ Microservices — <code>microservices/.env</code></b></summary>

Sao chép `microservices/.env.example` thành `microservices/.env`:

```env
MYSQL_HOST=host.docker.internal
MYSQL_PORT=3333
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=jobfindtest
JWT_SECRET=
INTERNAL_SECRET=
RABBITMQ_USER=jobportal
RABBITMQ_PASSWORD=
POSTGRES_USER=jobportal
POSTGRES_PASSWORD=
LEGACY_URL=http://host.docker.internal:5000
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Email kết quả tuyển dụng
NODE_ENV=development
EMAIL_APP=your-address@gmail.com
EMAIL_APP_PASSWORD=gmail-app-password-16-characters
EMAIL_DEMO_RECIPIENT=your-address@gmail.com   # hộp thư nhận email của dữ liệu demo
LOCAL_EMAIL_DELIVERY=true                     # npm start mới gửi email thật khi bật

# AI (AI Worker + chatbot). URL gốc của nhà cung cấp tương thích Anthropic, không thêm /v1/messages
ANTHROPIC_BASE_URL=https://1gw.gwai.cloud
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-opus-5
SUPPORT_CLAUDE_MODEL=claude-sonnet-5

# Chatbot: nhà cung cấp bổ sung (tùy chọn)
OPENAI_API_KEY=
GEMINI_API_KEY=            # cần thêm SUPPORT_GEMINI_PAID=true
SUPPORT_OLLAMA_URL=
SUPPORT_OLLAMA_MODEL=
```

- Khóa AI chỉ đặt ở **`microservices/.env` trên máy chạy dịch vụ** (Git bỏ qua file này), không bao giờ ở `frontend/.env`.
- Với gateway tùy chỉnh (`ANTHROPIC_BASE_URL`), CV PDF được trích chữ tại máy chủ rồi gửi cho `claude-sonnet-5`; các bản nháp ngắn (lời giới thiệu, lời nhắn, chat) cũng dùng mô hình này. PDF chỉ có ảnh quét cần OCR trước.
- Ở development, email gửi tới địa chỉ mẫu được chuyển về `EMAIL_DEMO_RECIPIENT` (trống thì `EMAIL_APP`); production chặn địa chỉ mẫu.
- `FRONTEND_URL` là địa chỉ gắn trong email; khi triển khai thay bằng domain thật.

Chạy thủ công:

```powershell
cd microservices
npm install
npm run up
npm run ps
Invoke-RestMethod http://localhost:4000/status
```

</details>

<details>
<summary><b>3️⃣ Frontend — <code>frontend/.env</code></b></summary>

```env
REACT_APP_BACKEND_URL=http://localhost:4000
# Bật không gian AI ứng viên và trợ lý AI trong form nộp CV
REACT_APP_CANDIDATE_AI_ENABLED=true
# Đăng/sửa/đăng lại tin qua Job Core (AI kiểm duyệt)
REACT_APP_JOB_CREATE_MODE=core
REACT_APP_JOB_EDIT_MODE=core
REACT_APP_JOB_REPOST_MODE=core
# Tiến trình hồ sơ tại "Công việc đã nộp"
REACT_APP_APPLICATION_PROGRESS_ENABLED=true
# Tùy chọn: nộp bằng PDF tạo từ CV đã chuẩn bị
REACT_APP_PREPARED_CV_APPLICATION_ENABLED=false
```

Chạy thủ công:

```powershell
cd frontend
npm install
npm start          # http://localhost:3000
npm run build      # bản build production
```

</details>

<details>
<summary><b>🔐 Xác thực và Google SSO</b></summary>

Phiên đăng nhập dùng **cookie HttpOnly**, tự gia hạn, thu hồi khi đổi mật khẩu/khóa tài khoản và quản lý tại `/account/security`. Quyền được kiểm tra theo tài khoản/công ty hiện tại trong CSDL.

```powershell
npm run auth:migrate   # sao lưu MySQL rồi áp dụng bảng xác thực
```

Google SSO tắt cho đến khi có OAuth Client — xem [hướng dẫn SSO](docs/AUTHENTICATION_SSO_INTEGRATION.md) và [đối chiếu tiêu chí](docs/AUTH_REPORT_ACCEPTANCE.md).

</details>

---

## 🔌 Các cổng sử dụng

| Thành phần | Cổng | Ghi chú |
| --- | ---: | --- |
| 🖥 Frontend React | **3000** | `npm start` (đổi bằng `JOBFIND_WEB_PORT`) |
| 🚪 API Gateway | **4000** | Cổng duy nhất frontend gọi |
| 🧩 Backend legacy + Socket.IO | 5000 | API gốc + realtime hub |
| ⚙ Identity · Job Core · Search · Application | 4001 · 4002 · 4003 · 4004 | Nội bộ Docker |
| ⚙ Notification · Admin · Support Chat | 4005 · 4006 · 4008 | Nội bộ Docker |
| 🗄 MySQL / XAMPP | 3333 | Máy host |
| 🗄 PostgreSQL · MongoDB | 5435 · 27019 | `127.0.0.1` |
| 🔍 Elasticsearch | 9201 | `127.0.0.1` |
| 🐇 RabbitMQ AMQP · Management | 5673 · 15673 | Web UI quản lý hàng đợi |
| ⚡ Redis | 6380 | `127.0.0.1` |
| 📈 Prometheus | 9091 | Profile `monitoring` |

---

## 🧪 Kiểm thử

### Trước khi push

```powershell
npm run check
```

`check` dừng ngay ở bước lỗi và lần lượt chạy: lint frontend → kiểm thử cả ba phần với ngưỡng coverage → test công cụ vận hành → kiểm tra hợp đồng HTTP/sự kiện → build → `npm audit` mức high cho backend, frontend, microservices. Xem [hướng dẫn kiểm thử](docs/testing.md) để chuẩn bị môi trường và chọn bộ tích hợp.

| Lệnh | Phạm vi |
| --- | --- |
| `npm test` · `npm run test:all` | Unit test backend + frontend + microservices, sau đó test công cụ vận hành |
| `npm run test:unit` | Chỉ unit test cả ba phần |
| `npm run test:coverage` | Kèm ngưỡng coverage cho cả ba phần |
| `npm run test:ci` | Coverage cả ba phần + runtime + hợp đồng HTTP/sự kiện; không cần Docker |
| `npm run test:backend` · `test:frontend` · `test:microservices` | Chạy riêng từng phần |
| `npm run lint` | ESLint `frontend/src`, không cho phép cảnh báo |
| `npm --prefix microservices run contracts:check` | Hợp đồng đã sinh khớp với mã nguồn |

**Lần chạy gần nhất (09/10/2026, máy phát triển):**

| Phần | Kết quả |
| --- | --- |
| Backend (Jest) | ✅ 90 bộ · 2.489 test |
| Frontend (Jest + RTL) | ✅ 122 bộ · 2.225 test |
| Microservices (Vitest) | ✅ 75 tệp · 1.818 test |

Độ phủ statements lần lượt **96,83% / 90,76% / 95,90%**; tất cả đạt ngưỡng đã cấu hình. Runtime đạt 62 ca, bỏ qua 1 ca MySQL tùy chọn. Build và lint đạt. `npm audit` còn cảnh báo high/critical, nên chưa xác nhận `npm run check` hoặc CI đạt hoàn toàn; chi tiết và giới hạn trong [hướng dẫn kiểm thử](docs/testing.md).

> [!NOTE]
> Unit test **mock toàn bộ** dịch vụ ngoài (DB, RabbitMQ, Redis, Elasticsearch, SMTP, AI) nên không cần Docker/XAMPP. Thành phần AI có test chạy trong `React.StrictMode` để bắt lỗi chỉ xuất hiện ở chế độ dev.

<details>
<summary><b>Integration, browser và kiểm thử AI thật</b></summary>

```powershell
# Gateway và tình trạng service
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/status

# Smoke test microservices (tạo rồi dọn dữ liệu kiểm thử)
npm --prefix microservices run test:smoke

# Xác thực
npm run test:auth:integration
npm run test:auth:browser

# Chatbot
npm --prefix microservices run test:support:browser
npm --prefix microservices run test:support:live        # gọi AI thật

# Đồng bộ hồ sơ, audit, Compose + trình duyệt
npm --prefix microservices run test:application-sync:integration
npm --prefix microservices run test:admin-audit:integration
npm --prefix microservices run test:compose-browser:integration

# AI Worker với Claude thật (tối đa 7 lượt gọi, dữ liệu giả, container riêng)
npm --prefix microservices run test:ai:live -- --live
```

</details>

<details>
<summary><b>Đọc kết quả trong terminal</b></summary>

- `npm test` chạy backend → frontend → microservices → runtime; xem đủ ba dòng tổng kết `Test Suites` / `Test Files`, `Tests` và tổng kết Node test runner.
- Thành công khi mã thoát là `0` (PowerShell: `$LASTEXITCODE`).
- Các bài test tình huống lỗi (mất kết nối, lỗi DB, gửi email thất bại) có thể chủ động in `stderr`/`level: error` — đối chiếu tổng kết thay vì chỉ nhìn màu đỏ.
- `FAIL`, assertion lỗi, không đạt ngưỡng coverage hoặc mã thoát khác `0` cần xử lý. Cảnh báo `not wrapped in act(...)` cần sửa bước chờ của test.
- `DeprecationWarning` (`util._extend`, `fs.F_OK`) đến từ thư viện, không phải test thất bại. CI dùng Node.js 22.

</details>

---

## 🚢 Triển khai và vận hành

### 🔄 CI/CD — GitHub Actions

| Workflow | File | Kiểm tra |
| --- | --- | --- |
| 🔐 Authentication and OIDC acceptance | `authentication.yml` | Build frontend thật, phiên đăng nhập, chữ ký OIDC và hành trình trình duyệt trên MySQL tạm |
| 🐳 Microservices quality | `microservices.yml` | Unit test + coverage, kiểm tra hợp đồng, `npm audit`, ghi tin trên MySQL tạm, hành trình nhà tuyển dụng/ứng viên bằng Playwright, cấu hình Compose, build image, gateway không mạng ngoài, hợp đồng sự kiện trên broker riêng, hành trình Compose với AI giả lập |
| ⚡ Realtime integration | `realtime.yml` | Socket.IO, Redis adapter, chat và Web Push có mã hóa trên MySQL/Redis tạm |

### 📦 Release & Deploy

| Lệnh | Mô tả |
| --- | --- |
| `npm run release:prepare` · `test:release` | Chuẩn bị và kiểm thử bản release |
| `npm run deploy:activate` · `deploy:verify` | Kích hoạt và xác minh phiên bản mới |
| `npm run deploy:status` · `deploy:observe` | Trạng thái và theo dõi sau triển khai |
| `npm run deploy:rollback` · `deploy:resume` · `deploy:reactivate` | Quay lui, tiếp tục, kích hoạt lại |
| `npm run test:restore` | Diễn tập sao lưu/khôi phục |

### ✅ Production checklist

- [ ] Thay toàn bộ secret (`JWT_SECRET`, `INTERNAL_SECRET`, mật khẩu DB, khóa AI)
- [ ] Đặt `CORS_ORIGIN` và `FRONTEND_URL` theo domain thật
- [ ] Dùng tài khoản email chuyên dụng
- [ ] Đặt `SUPPORT_AUTO_MIGRATE=false`, chạy migration riêng
- [ ] Cấu hình Nginx reverse proxy (`scripts/release/nginx.conf`)
- [ ] Bật Prometheus alerts (`microservices/ops/`), theo dõi hàng đợi `ai-worker.jobs` và số tác vụ AI `pending`

Chi tiết: [Bộ triển khai và quay lui](microservices/docs/release-preparation.md)

**Triển khai lên VPS bằng Docker** (HTTPS tự động, chuyển dữ liệu từ máy dev, sao lưu định kỳ): [deploy/README.md](deploy/README.md)

---

## 👥 Tài khoản demo

> [!WARNING]
> Chỉ dùng cho môi trường local/demo. Đổi toàn bộ mật khẩu trước khi đưa lên môi trường thật.

**Bộ dữ liệu demo đầy đủ** (`npm run seed:demo-data`) — mật khẩu **`Demo@123456`**:

| Vai trò | Số điện thoại | Gợi ý |
| --- | --- | --- |
| 🏢 Nhà tuyển dụng (chủ công ty) | `0918800001` → `0918800008` | `0918800001` — Sao Khuê Digital: Kanban đủ 6 cột, thử **AI sàng lọc hồ sơ** |
| 👔 Nhân viên tuyển dụng | `0938800001` → `0938800008` | Cùng công ty với chủ tài khoản tương ứng |
| 👤 Ứng viên | `0928800001` → `0928800072` | `0928800001` — Nguyễn Minh An |

**Tài khoản sẵn có** — mật khẩu **`123456`**:

| Vai trò | Số điện thoại | Tên |
| --- | --- | --- |
| 🛡 Quản trị viên | `0795095049` | Nguyễn Tuấn Thiền |
| 🏢 Nhà tuyển dụng | `0795095042` | Nguyễn Văn Tài |
| 👤 Ứng viên | `0764188123` | Trần Thị My |
| 🛡 Admin / 🏢 Company / 👤 Candidate | `0900000001` / `0900000002` / `0900000003` | Tạo bằng `npm --prefix backend run seed:test-accounts` |

Kịch bản trình diễn và số lượng dữ liệu: [docs/demo-data.md](docs/demo-data.md)

---

## 🔒 Bảo mật và quyền riêng tư

- 🔑 **Không commit** `.env`, App Password Gmail, JWT secret, Cloudinary secret hoặc khóa AI.
- 🛡 Gateway **xóa header định danh** do client gửi trước khi gắn danh tính đã xác thực; service chỉ nhận request đã ký bằng khóa nội bộ.
- 🏢 Quyền theo công ty được đọc lại từ CSDL ở mỗi yêu cầu: nhà tuyển dụng chỉ thấy hồ sơ, CV và kết quả AI của công ty mình; đổi công ty là mất quyền xem kết quả cũ.
- 🤖 **AI và dữ liệu cá nhân**: chỉ gửi dữ liệu khi người dùng bấm nút AI; nội dung chat không lưu trong bảng tác vụ AI; trình duyệt không lưu PDF hay kết quả AI; lỗi từ nhà cung cấp AI không lộ ra người dùng.
- ⚡ Rate limit cho route ghi và route AI; RabbitMQ + outbox bảo đảm không mất sự kiện khi service tạm ngừng.
- 🔐 Phiên đăng nhập HttpOnly, tự gia hạn, thu hồi khi đổi mật khẩu/khóa tài khoản.
- 📡 Notification Service tách ba kênh (CSDL, realtime, email) — lỗi một kênh không chặn kênh khác.
- 💬 Chatbot chỉ lưu sự kiện và số token, **không log nội dung tin nhắn**.
- 🔔 Web Push chỉ báo "Bạn có tin nhắn mới", không chứa nội dung hay tên người gửi.

---

## 📚 Tài liệu chuyên sâu

<table>
<tr>
<td valign="top" width="50%">

#### 🤖 AI
- [AI trong quy trình tuyển dụng](docs/ai-recruitment.md) 🆕
- [Tạo CV và đối chiếu CV bằng AI](docs/ai-cv.md)
- [Tìm ứng viên và lọc CV](docs/candidate-search.md)
- [Cấu hình chatbot AI](CHATBOT_SETUP.md)
- [Chatbot: lịch sử và kiểm thử](docs/chatbot-widget-history.md)
- [Kiểm chứng chatbot](docs/chatbot-validation.md)
- [Đối chiếu PDF chatbot](docs/chatbot-pdf-implementation.md)
- [Kiểm thử API key thật](docs/api-key-demo-validation.md)

#### 📋 Tuyển dụng
- [Thư mời phỏng vấn](docs/recruitment-interview-email.md)
- [Thư mời nhận việc](docs/recruitment-offer-email.md)
- [Kiểm thử kết quả tuyển dụng thật](docs/recruitment-offer-live-test.md)
- [Danh mục cấp bậc và 34 tỉnh/thành](docs/recruitment-catalog.md)
- [Tin có nguồn đối chiếu](docs/verified-jobs.md) · [nguồn](docs/verified-jobs-sources.md)

</td>
<td valign="top" width="50%">

#### 💬 Trải nghiệm & Realtime
- [CV/PDF và tin tuyển dụng trong chat](docs/chat-documents.md)
- [Xem trước PDF](docs/document-preview.md)
- [Thông báo từ công ty đang theo dõi](docs/company-follow-notifications.md)
- [Điều hướng từ thông báo](docs/notification-navigation.md)
- [Trang chi tiết việc làm](docs/job-detail-page.md)
- [Điều hướng và nội dung tiếng Việt](docs/job-navigation-vietnamese.md)
- [Web Push](docs/web-push.md) · [WebSocket](docs/websocket-upgrade.md)

#### 🧱 Kiến trúc & Vận hành
- [Kiến trúc microservices](microservices/README.md)
- [Phân quyền](docs/AUTHORIZATION.md) · [SSO](docs/AUTHENTICATION_SSO_INTEGRATION.md)
- [HTTP contracts](microservices/docs/http-contracts.md) · [Event contracts](microservices/docs/event-contracts.md)
- [Chạy với dữ liệu thật](docs/run-with-real-data.md) · [Dữ liệu demo](docs/demo-data.md)
- [Triển khai và quay lui](microservices/docs/release-preparation.md)
- [Kiểm tra hồi quy 29–30/09](docs/qa-2026-09-29.md) · [Bố cục](docs/layout-spacing-validation.md)

</td>
</tr>
</table>

#### 🧭 Mã nguồn tham khảo

| Chủ đề | File |
| --- | --- |
| Kanban + AI sàng lọc | [`KanbanBoard.js`](frontend/src/container/system/Cv/KanbanBoard.js) · [`KanbanAi.js`](frontend/src/container/system/Cv/KanbanAi.js) |
| Trợ lý AI nộp CV / chat | [`ApplicationAiHelper.js`](frontend/src/components/modal/ApplicationAiHelper.js) · [`ChatAiAssist.js`](frontend/src/components/chat/ChatAiAssist.js) |
| Prompt các tác vụ AI | [`ai-worker/src/jobs/`](microservices/ai-worker/src/jobs/) |
| API AI | [`aiController.js`](microservices/job-core-service/src/controllers/aiController.js) · [`aiAssistController.js`](microservices/job-core-service/src/controllers/aiAssistController.js) |
| Hợp đồng API | [`operations.js`](microservices/shared/contracts/operations.js) · [`schemas.js`](microservices/shared/contracts/schemas.js) |
| Template email | [`templates.js`](microservices/notification-service/src/templates.js) |
| Chatbot | [`SupportChat.jsx`](frontend/src/components/support/SupportChat.jsx) · [`knowledge.js`](microservices/support-chat-service/src/knowledge.js) |
| Gateway | [`api-gateway/src/app.js`](microservices/api-gateway/src/app.js) |
| Postman | [`postman/`](postman/) |

---

<div align="center">

**JobFind** — tuyển dụng nhanh hơn, công bằng hơn, với AI đứng sau hỗ trợ con người.

Made with ❤️ by JobFind Team · [⬆ Về đầu trang](#-jobfind)

</div>
