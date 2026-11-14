<div align="center">

# 🚀 JobFind

### Nền tảng Tuyển dụng Thông minh tích hợp AI & Thanh toán Đa kênh

**Ứng viên · Nhà tuyển dụng · Quản trị viên** — tìm việc, tạo & chấm điểm CV bằng AI, mở khóa phân tích cạnh tranh, quản lý Kanban 6 bước, lên lịch phỏng vấn, trò chuyện realtime và thanh toán đa cổng trên cùng một hệ thống.

[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=111827)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude AI](https://img.shields.io/badge/AI-Anthropic_Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://www.anthropic.com)
[![Payments](https://img.shields.io/badge/Sandbox-VNPAY_·_ZaloPay_·_MoMo_·_PayPal-0058BE?style=for-the-badge)](#-thanh-toán-sandbox--thẻ-dùng-thử-miễn-phí)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

[![MariaDB](https://img.shields.io/badge/MariaDB%2FMySQL-003545?style=flat-square&logo=mariadb&logoColor=white)](https://mariadb.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-8.15-005571?style=flat-square&logo=elasticsearch&logoColor=white)](https://elastic.co)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-4-FF6600?style=flat-square&logo=rabbitmq&logoColor=white)](https://rabbitmq.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=flat-square&logo=socketdotio&logoColor=white)](https://socket.io)
[![Tests](https://img.shields.io/badge/Tests-6.500%2B_passing-2EA44F?style=flat-square&logo=jest&logoColor=white)](#-cicd--chất-lượng)
[![Mutation](https://img.shields.io/badge/Mutation_score-%3E91%25-8A2BE2?style=flat-square&logo=stryker&logoColor=white)](#-cicd--chất-lượng)

[![Microservices quality](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/microservices.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/microservices.yml)
[![Authentication and OIDC acceptance](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/authentication.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/authentication.yml)
[![Realtime integration](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/realtime.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/realtime.yml)
[![Mutation testing](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/mutation.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/mutation.yml)

[**⚡ Bắt đầu nhanh**](#-bắt-đầu-nhanh) · [**💳 Thẻ dùng thử**](#-thanh-toán-sandbox--thẻ-dùng-thử-miễn-phí) · [**👥 Tài khoản demo**](#-tài-khoản-demo) · [**🖼 Giao diện**](#-giao-diện-nổi-bật) · [**🤖 AI**](#-trợ-lý-ai-trong-jobfind) · [**📝 Bài test & Email**](#-bài-test-năng-lực--email-tự-động) · [**🧱 Kiến trúc**](#-kiến-trúc-hệ-thống) · [**🔁 CI/CD**](#-cicd--chất-lượng)

</div>

---

## 🌟 Tổng quan nhanh

JobFind kết hợp giao diện **React 18**, **Backend Express + Socket.IO** và hệ **API Gateway cùng 8 Microservice** giao tiếp qua **RabbitMQ**. Trí tuệ nhân tạo (**Anthropic Claude**) đóng vai trò trợ lý xuyên suốt từ bước chuẩn bị CV đến sàng lọc và mời nhận việc — trong khi **con người luôn nắm quyền quyết định cuối cùng**.

| 🧩 Kiến trúc dịch vụ | 🤖 Trợ lý AI | 💳 Thanh toán & Điểm thưởng | 🧪 Kiểm thử tự động |
| :---: | :---: | :---: | :---: |
| API Gateway + 8 Microservice + Backend | 8 tác vụ AI Worker + Chatbot đa mô hình | VNPAY · ZaloPay · MoMo · PayPal + Ví Điểm | 6.500+ test · 4 workflow CI · Mutation > 91% |

<table>
<tr>
<td width="33%" valign="top">

### 👤 Ứng viên
- Tìm việc đa bộ lọc (34 tỉnh/thành mới), lưu việc & theo dõi công ty.
- Tạo CV, đọc CV PDF, chấm độ hợp công việc (0–100) & viết thư ứng tuyển bằng AI.
- Làm **bài test năng lực** có đếm giờ, nhận **email bản sao bài làm** (kiểu Google Forms) để tự kiểm tra lại.
- Tích điểm hằng ngày, nạp Xu và mở khóa **Báo cáo phân tích cạnh tranh** từng tin tuyển dụng.
- Xem lịch phỏng vấn, theo dõi tiến trình, chat realtime với HR và hỏi **Chatbot AI**.

</td>
<td width="33%" valign="top">

### 🏢 Nhà tuyển dụng
- Đăng tin tuyển dụng (có AI kiểm duyệt tự động), quản lý nhân sự HR trong công ty.
- Mua gói đăng tin thường/nổi bật & gói tìm CV qua **VNPAY, ZaloPay, MoMo, PayPal**, tích lũy **Top Point** đổi quà.
- Quản lý ứng viên trên **Kanban 6 bước**, xem CV PDF & nhờ **AI phân tích / sàng lọc** tới 50 hồ sơ/lần.
- **AI tạo đề test** theo JD, **AI chấm bài** kèm nhận xét; gửi email mời phỏng vấn / nhận việc / cảm ơn.

</td>
<td width="33%" valign="top">

### 🛡 Quản trị viên
- Dashboard **Việc cần xử lý**, biểu đồ doanh thu, phễu tuyển dụng & KPI so sánh cùng kỳ.
- Duyệt/từ chối/khóa tin đăng và hồ sơ pháp lý công ty.
- Quản lý người dùng, danh mục hệ thống, các gói dịch vụ đăng tin & xem CV.
- Tiếp nhận và phản hồi yêu cầu hỗ trợ chuyển tiếp từ Chatbot AI.

</td>
</tr>
</table>

> [!NOTE]
> 🌐 **Đa ngôn ngữ**: chọn hơn 100 ngôn ngữ ngay trên thanh điều hướng (GTranslate). Nội dung động của React (bộ lọc, nút, thông báo, chatbot…) được dịch đồng bộ khi đổi ngôn ngữ và trả về đúng bản gốc khi quay lại Tiếng Việt — không tải lại trang, không dính bản dịch cũ.

---

## 🖼 Giao diện nổi bật

<table>
<tr>
<td width="50%">
  <img src="docs/images/readme/jobs.png" alt="Trang tìm việc với bộ lọc và danh sách việc làm">
  <br><sub><b>🔍 Tìm việc thông minh</b> — bộ lọc đa tiêu chí, gợi ý từ khóa tức thì, ưu tiên tin nổi bật</sub>
</td>
<td width="50%">
  <img src="docs/images/readme/job-detail.png" alt="Trang chi tiết việc làm">
  <br><sub><b>📄 Chi tiết việc làm</b> — mức lương, hạn nộp, nộp CV kèm AI chấm độ phù hợp & phân tích đối thủ</sub>
</td>
</tr>
<tr>
<td width="50%">
  <img src="docs/images/readme/kanban.png" alt="Kanban quản lý hồ sơ ứng tuyển">
  <br><sub><b>📋 Kanban tuyển dụng 6 bước</b> — kéo thả mượt, huy hiệu điểm AI 4 mức màu ngay trên thẻ</sub>
</td>
<td width="50%">
  <img src="docs/images/readme/interviews.png" alt="Lịch phỏng vấn theo tháng">
  <br><sub><b>📅 Lịch phỏng vấn</b> — chế độ lịch tháng & danh sách, mã màu trạng thái, xem trước thư mời</sub>
</td>
</tr>
<tr>
<td width="50%">
  <img src="docs/images/readme/admin-dashboard.png" alt="Dashboard quản trị">
  <br><sub><b>📊 Dashboard quản trị</b> — thẻ việc cần xử lý ngay, xu hướng doanh thu và phễu chuyển đổi</sub>
</td>
<td width="50%">
  <img src="docs/images/readme/login.png" alt="Trang đăng nhập">
  <br><sub><b>🔐 Đăng nhập hiện đại</b> — SĐT/Email hoặc SSO một chạm qua Google, GitHub, Facebook</sub>
</td>
</tr>
</table>

---

## 🎨 Nguyên tắc UI/UX

Giao diện xoay quanh 4 trụ cột: **Thao tác ít chạm · Phản hồi trạng thái tức thì · Không làm mất ngữ cảnh · AI minh bạch, dễ kiểm soát**.

| Nguyên tắc | Cách thể hiện trên sản phẩm |
| :--- | :--- |
| 👀 **Người dùng luôn kiểm soát** | Kết quả AI luôn mở trong khung gợi ý riêng với nút **Dùng nội dung này** / **Bỏ qua** — không bao giờ tự ghi đè hay tự gửi thư. |
| 🏷 **Nhận diện AI nhất quán** | Huy hiệu **AI** tông xanh ngọc đồng bộ ở mọi màn hình, nói rõ dữ liệu nào được dùng để phân tích. |
| ⏳ **Phản hồi trạng thái sống động** | Skeleton loading, trạng thái *"AI đang chấm…"*, nút **Dừng chờ**, điểm khớp trên thẻ Kanban tự nhảy realtime khi xong. |
| 💸 **Minh bạch khi thanh toán & dùng điểm** | Gợi ý sẵn **thẻ dùng thử miễn phí** kèm nút **Sao chép 1 chạm**, tính trước ưu đãi giảm giá và số Điểm / Top Point nhận thêm. |
| 🔁 **Bền vững khi mạng chập chờn** | Tự động gửi lại với cùng `Idempotency-Key` (không trừ tiền/tạo tác vụ trùng); tin nhắn chat lỗi giữ nguyên nội dung để thử lại. |
| ♿ **Đa thiết bị & Truy cập chuẩn (A11y)** | Tương thích Desktop / Tablet / Mobile, hỗ trợ bàn phím trên Kanban & Modal, đầy đủ `aria-label`, `role="status"`, `role="alert"`. |

---

## 💳 Thanh toán Sandbox & Thẻ dùng thử miễn phí

Dự án đã tích hợp chế độ **Merchant dùng thử (Sandbox)** cho cả 4 cổng thanh toán (**ZaloPay · VNPAY · MoMo · PayPal**), áp dụng cho:
1. **Ứng viên**: Nạp Điểm / Mua Xu mở khóa báo cáo cạnh tranh (`PointTopupModal`).
2. **Nhà tuyển dụng**: Mua gói lượt đăng bài thường/nổi bật (`/admin/buy-post`) và mua gói lượt tìm CV (`/admin/buy-cv`).

> [!TIP]
> Ngay trên giao diện thanh toán của ứng dụng cũng đã hiển thị sẵn khung **Thẻ dùng thử cấp sẵn miễn phí** kèm nút **Sao chép** để bạn dán nhanh khi kiểm thử.

### 🟢 Bảng thẻ dùng thử miễn phí (Giao dịch Thành công)

| Cổng thanh toán | Loại thẻ / Ngân hàng chọn trên cổng | Số thẻ dùng thử | Tên chủ thẻ | Ngày phát hành / Hết hạn | Mã OTP / CVV |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **ZaloPay** *(Merchant Trial V2)* | Thẻ ATM nội địa (NAPAS) | `9704540000000062` | `NGUYEN VAN A` | `10/18` *(Phát hành)* | `123456` *(hoặc theo màn hình)* |
| **ZaloPay** *(Thẻ phụ ATM)* | Thẻ ATM nội địa (NAPAS) | `9704540000000070` | `NGUYEN VAN A` | `10/18` *(Phát hành)* | `123456` |
| **ZaloPay** *(Quốc tế)* | Thẻ VISA / MasterCard | `4111111111111111` | `NGUYEN VAN A` | `01/28` *(Hết hạn)* | CVV `123` |
| **VNPAY** *(Sandbox)* | Ngân hàng Quốc Dân (**NCB**) | `9704198526191432198` | `NGUYEN VAN A` | `07/15` *(Phát hành)* | OTP `123456` |
| **VNPAY** *(NAPAS)* | Thẻ nội địa NAPAS / VietinBank | `9704000000000018` | `NGUYEN VAN A` | `03/07` *(Phát hành)* | OTP `otp` |
| **VNPAY** *(Quốc tế)* | Thẻ quốc tế VISA *(No 3DS)* | `4456530000001005` | `NGUYEN VAN A` | `12/26` *(Hết hạn)* | CVV `123` |
| **MoMo** *(Merchant Trial)* | Thẻ ATM nội địa (NAPAS) | `9704000000000018` | `NGUYEN VAN A` | `03/07` *(Phát hành)* | OTP `000000` *(hoặc `123456`)* |
| **MoMo** *(Quốc tế)* | Thẻ VISA / MasterCard | `4111111111111111` | `NGUYEN VAN A` | `12/28` *(Hết hạn)* | CVV `123` · OTP `000000` |
| **PayPal** *(Sandbox)* | PayPal Card / Tài khoản Buyer | `4032039935147760` | `NGUYEN VAN A` | `12/28` *(Hết hạn)* | CVV `123` |

<details>
<summary><b>🔴 Bảng thẻ test kịch bản lỗi & Mã giảm giá (Promo Codes) dùng khi test</b></summary>

#### 1. Thẻ kiểm thử giao dịch thất bại (Từ chối / Không đủ số dư / Thẻ khóa)

| Cổng thanh toán | Kịch bản kiểm thử | Số thẻ | Chủ thẻ | Ngày phát hành | OTP |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **VNPAY** | Tài khoản không đủ số dư *(Mã lỗi 51)* | `9704195798459170488` | `NGUYEN VAN A` | `07/15` | `123456` |
| **VNPAY** | Thẻ đang bị khóa / chưa kích hoạt | `9704193370791314` | `NGUYEN VAN A` | `07/15` | `123456` |
| **ZaloPay** | Tài khoản thẻ không đủ số dư | `9704540000000047` | `NGUYEN VAN A` | `10/18` | `123456` |

#### 2. Mã ưu đãi (Promo Codes) tích hợp sẵn

| Mã ưu đãi | Mức giảm | Đơn tối thiểu | Cổng áp dụng |
| :--- | :---: | :---: | :--- |
| `VNPAY5K` | `-5.000đ` | `20.000đ` | Chỉ VNPAY |
| `MOMO5K` | `-5.000đ` | `20.000đ` | Chỉ MoMo |
| `ZALOPAY5K` | `-5.000đ` | `20.000đ` | Chỉ ZaloPay |
| `ARCHITECT5K` | `-5.000đ` | `20.000đ` | Tất cả các cổng |
| `JOBFIND10K` | `-10.000đ` | `50.000đ` | Tất cả các cổng |

#### 3. Lưu ý cấu hình khóa Sandbox trong `backend/.env`
- **ZaloPay (`2554`)**, **MoMo (`MOMO`)** và **PayPal (`sandbox`)**: Đã điền sẵn khóa Merchant Trial chính thức — mở trực tiếp cổng thanh toán thật của nhà cung cấp.
- **VNPAY**: Do VNPAY cấp mã Terminal riêng theo từng email đăng ký, bạn có thể nhận miễn phí `VNP_TMN_CODE` & `VNP_HASH_SECRET` trong 1 phút tại https://sandbox.vnpayment.vn/devreg/ rồi điền vào `backend/.env`. Khi để trống ở môi trường dev, hệ thống tự động mở **Form nhập thẻ dùng thử VNPAY tích hợp sẵn** để bạn vẫn test trọn vẹn luồng cộng điểm & gói dịch vụ.

</details>

---

## 👥 Tài khoản demo

> [!WARNING]
> Các tài khoản dưới đây chỉ dùng cho môi trường phát triển & trình diễn local. Hãy đổi toàn bộ mật khẩu trước khi vận hành thực tế.

### 1. Bộ dữ liệu demo đầy đủ (`npm run seed:demo-data`) — Mật khẩu: `Demo@123456`

| Vai trò | Số điện thoại đăng nhập | Gợi ý trải nghiệm nhanh |
| :--- | :--- | :--- |
| 🏢 **Nhà tuyển dụng (Chủ công ty)** | `0918800001` → `0918800008` | `0918800001` *(Sao Khuê Digital)* — có sẵn Kanban đủ 6 bước, lịch phỏng vấn & hồ sơ để test **AI sàng lọc** |
| 👔 **Nhân viên tuyển dụng (HR)** | `0938800001` → `0938800008` | Thuộc cùng công ty tương ứng với chủ công ty bên trên |
| 👤 **Ứng viên** | `0928800001` → `0928800072` | `0928800001` *(Nguyễn Minh An)* — có sẵn CV, lịch sử ứng tuyển & ví điểm |

### 2. Tài khoản mặc định sẵn có — Mật khẩu: `123456`

| Vai trò | Số điện thoại |
| :--- | :--- |
| 🛡 **Quản trị viên (Admin)** | `0795095049` |
| 🏢 **Nhà tuyển dụng** | `0795095042` |
| 👤 **Ứng viên** | `0764188123` |

---

## 🤖 Trợ lý AI trong JobFind

AI chạy tách biệt trong **`ai-worker`** (không mở cổng HTTP) và nhận việc qua hàng đợi **RabbitMQ**, giúp lưu lượng gọi AI lớn không bao giờ làm nghẽn API chính.

| Tác vụ AI Worker | Sự kiện RabbitMQ | Đầu ra có cấu trúc (JSON Schema) |
| :--- | :--- | :--- |
| **Resume Parser** | `ai.parse_resume` | Bóc tách CV PDF thành hồ sơ JSON có cấu trúc |
| **CV Generator** | `ai.generate_cv` | Tạo bản nháp CV chuyên nghiệp từ thông tin ứng viên |
| **Smart Matching** | `ai.match_cv` | Chấm điểm 0–100, chỉ rõ kỹ năng khớp/thiếu & câu hỏi gợi ý khi phỏng vấn |
| **Content Moderation** | `ai.moderate_job` | Kiểm duyệt tin đăng mới, cảnh báo lừa đảo / thu phí / phân biệt đối xử |
| **Cover Letter** | `ai.cover_letter` | Soạn thư ứng tuyển cá nhân hóa (Tiếng Việt / Tiếng Anh) |
| **Writing Assistant** | `ai.write_assist` | Viết lời giới thiệu nộp đơn, soạn email kết quả & gợi ý trả lời chat |
| **Assessment Generator** | `ai.generate_assessment` | Tạo đề test năng lực theo JD (trắc nghiệm + tự luận, thang điểm, thời gian) |
| **Assessment Grader** | `ai.grade_assessment` | Chấm bài tự luận, chấm điểm từng câu & nhận xét điểm mạnh/điểm cần cải thiện |

```mermaid
sequenceDiagram
    autonumber
    participant U as Người dùng (React)
    participant G as API Gateway
    participant J as Job Core Service
    participant Q as RabbitMQ
    participant W as AI Worker
    participant C as Anthropic Claude
    U->>G: POST /api/ai/... (kèm Idempotency-Key)
    G->>J: Xác thực JWT + kiểm tra quyền
    J->>J: Lưu ai_tasks + outbox trong 1 transaction
    J-->>U: 202 Accepted + taskId
    J->>Q: Phát sự kiện tác vụ AI
    Q->>W: Nhận việc (kiểm tra ledger chống chạy trùng)
    W->>C: Gửi Prompt + JSON Schema
    C-->>W: Dữ liệu JSON chuẩn cấu trúc
    W->>Q: Phát sự kiện ai.result
    Q->>J: Cập nhật kết quả vào CSDL
    U->>G: GET /api/ai/tasks/:taskId
    G-->>U: Hiển thị bản nháp / điểm số để người dùng duyệt
```

> [!IMPORTANT]
> **Nguyên tắc an toàn & công bằng của AI**: AI không tự ý gửi email/tin nhắn hay loại ứng viên; không bịa đặt kinh nghiệm/mức lương ngoài hồ sơ; **tuyệt đối bỏ qua tuổi tác, giới tính, vùng miền, tôn giáo, tình trạng hôn nhân** khi chấm độ phù hợp CV.

**💬 Chatbot hỗ trợ AI** (`support-chat-service`): trả lời câu hỏi về việc làm, ví điểm, lịch phỏng vấn, bài test… bằng *tool-calling* trên dữ liệu thật của đúng người dùng (tuân thủ RBAC), hỗ trợ Claude / Gemini / OpenAI và chuyển tiếp sang nhân viên hỗ trợ khi cần.

---

## 📝 Bài test năng lực & Email tự động

```mermaid
flowchart LR
    A["Ứng viên nộp CV"] --> B["Kanban: Mới ứng tuyển"]
    B --> C["HR xem CV + AI phân tích"]
    C --> D["AI tạo đề test theo JD"]
    D --> E["Ứng viên làm bài (đếm giờ)"]
    E --> F["AI chấm + HR duyệt điểm"]
    E -.-> M1["📧 Bản sao bài làm"]
    F --> G["Mời phỏng vấn + lịch"]
    G -.-> M2["📧 Thư mời phỏng vấn"]
    G --> H["Nhận việc / Từ chối"]
    H -.-> M3["📧 Thư mời nhận việc / Cảm ơn"]
```

| Email gửi ứng viên | Sự kiện (Transactional Outbox → RabbitMQ) | Nội dung |
| :--- | :--- | :--- |
| 📝 **Bản sao bài test** | `application.assessment_submitted` | Toàn bộ câu hỏi, câu trả lời đã nộp, thời gian làm bài (giống bản sao Google Forms); HR có thể **gửi lại** bất cứ lúc nào |
| 📅 **Thư mời phỏng vấn** | `application.interview_invitation_requested` | Ngày giờ, hình thức (online/offline), địa điểm hoặc link họp, người liên hệ; đổi lịch sẽ gửi lại thư mới |
| 🎉 **Thư mời nhận việc** | `application.decision_email_requested` | Ngày giờ nhận việc, hình thức (onsite/remote/hybrid), địa điểm hoặc link, người liên hệ, hạn phản hồi — chờ ứng viên xác nhận, không tự đánh dấu đã nhận việc |
| 🙏 **Thư cảm ơn / không trúng tuyển** | `application.decision_email_requested` | Tự cảm ơn ứng viên đã tham gia phỏng vấn nếu hồ sơ từng ở bước phỏng vấn |

> [!TIP]
> Mọi thao tác gửi email đều có chế độ **xem trước (`?dryRun=true`)** dùng đúng mẫu HTML và người nhận của luồng gửi thật nhưng không lưu thay đổi. Khi chưa cấu hình `EMAIL_APP` / `EMAIL_APP_PASSWORD`, thông báo vẫn được lưu trong ứng dụng.

---

## 🧱 Kiến trúc hệ thống

```mermaid
flowchart LR
    subgraph Client["Giao diện"]
        UI["React 18 SPA (:3000)"]
    end

    subgraph Edge["Cửa ngõ API"]
        GW["API Gateway (:4000)"]
    end

    subgraph Services["Hệ thống Dịch vụ"]
        Legacy["Backend Express + Socket.IO (:5000)"]
        Identity["Identity (:4001)"]
        Job["Job Core (:4002)"]
        Search["Search (:4003)"]
        Apps["Application & Kanban (:4004)"]
        Notify["Notification (:4005)"]
        Admin["Admin & Reporting (:4006)"]
        Support["Support Chatbot (:4008)"]
        AI["AI Worker"]
    end

    subgraph Data["Kho dữ liệu"]
        MySQL[("MariaDB / MySQL")]
        Postgres[("PostgreSQL")]
        Mongo[("MongoDB")]
        ES[("Elasticsearch")]
        Redis[("Redis")]
    end

    MQ{{"RabbitMQ"}}
    Claude(["Anthropic Claude"])

    UI -->|"REST + Socket.IO"| GW
    GW --> Legacy & Identity & Job & Search & Apps & Admin & Support
    GW --> Redis
    Legacy & Job --> MySQL
    Apps --> Postgres
    Identity & Admin & AI --> Mongo
    Search --> ES
    Support --> MySQL & ES
    Notify --> MySQL
    Legacy & Job & Apps -->|Transactional Outbox| MQ
    MQ --> Search & AI & Notify & Admin & Apps
    MQ -->|ai.result| Job
    AI & Support --> Claude
```

| Dịch vụ | Cổng | Kho dữ liệu | Vai trò chính |
| :--- | ---: | :--- | :--- |
| `api-gateway` | `4000` | Redis | Cổng duy nhất frontend gọi: JWT, RBAC, rate limit, circuit breaker, proxy Socket.IO |
| `backend` | `5000` | MySQL | Đăng nhập/SSO, Socket.IO chat, nộp CV, Ví điểm & Thanh toán (VNPAY/ZaloPay/MoMo/PayPal), Web Push |
| `identity-service` | `4001` | MongoDB | Hồ sơ ứng viên, trình tạo CV Builder |
| `job-core-service` | `4002` | MySQL | Tin tuyển dụng, hạn mức gói tin, kiểm duyệt & điều phối tác vụ AI |
| `search-service` | `4003` | Elasticsearch | Tìm kiếm toàn văn (full-text), gợi ý từ khóa, bộ lọc facet đồng bộ CQRS |
| `application-service` | `4004` | PostgreSQL | Bảng Kanban 6 bước, ghi chú nội bộ, phễu tuyển dụng, lịch & thư phỏng vấn, bài test năng lực |
| `notification-service` | `4005` | MySQL | Lưu thông báo, gửi email HTML qua Gmail SMTP & đẩy thông báo realtime |
| `admin-service` | `4006` | MongoDB / SQL | Báo cáo thống kê, dữ liệu danh mục (master data), nhật ký kiểm toán |
| `support-chat-service` | `4008` | MySQL + ES | Chatbot hỗ trợ đa nhà cung cấp (Claude/Gemini/OpenAI), chuyển tiếp nhân viên hỗ trợ |
| `ai-worker` | — | MongoDB | Xử lý bất đồng bộ 8 tác vụ AI qua RabbitMQ (CV, matching, kiểm duyệt, bài test…) |

### 🛠 Công nghệ chủ đạo

| Tầng | Công nghệ sử dụng |
| :--- | :--- |
| **Frontend** | React 18.3, React Router 7, Ant Design 5, Reactstrap/SCSS, Axios, Socket.IO Client, Chart.js & Recharts, React-PDF & `pdf-lib`, `assistant-ui` |
| **Backend & Services** | Node.js ≥ 22.12, Express 5 / Express 4, Sequelize (`mysql2`), Mongoose, `pg`, `@elastic/elasticsearch`, `amqplib`, `openid-client` (OIDC/Auth0), `web-push` |
| **Thanh toán & AI** | VNPAY Pay v2.1.0 (HMAC-SHA512), ZaloPay API v2, MoMo Gateway v2, PayPal REST SDK · `@anthropic-ai/sdk`, Vercel AI SDK (`ai`), `pdfjs-dist` |
| **Hạ tầng & Kiểm thử** | MariaDB/MySQL, PostgreSQL 16, MongoDB 7, Elasticsearch 8.15, RabbitMQ 4, Redis 7, Docker Compose, Caddy 2 (Auto HTTPS) · Jest, Vitest, Playwright, Stryker |

---

## ⚡ Bắt đầu nhanh

### 1. Yêu cầu môi trường
- **Node.js** `>= 22.12`
- **Docker Desktop** (bật Compose V2, RAM khuyến nghị `>= 8 GB`)
- **XAMPP (MariaDB/MySQL)** tạo sẵn database `jobfindtest` (cổng `3333`)
- *(Tùy chọn)* `ANTHROPIC_API_KEY` để kích hoạt các tính năng AI

### 2. Tạo file cấu hình & Khởi chạy

Sao chép các file `.env.example` thành `.env` tại `backend/`, `microservices/` và `frontend/` (đảm bảo `JWT_SECRET` và `INTERNAL_SECRET` khớp nhau giữa `backend/.env` và `microservices/.env`), sau đó chạy từ thư mục gốc:

```powershell
npm start
```

Mở trình duyệt tại **http://localhost:3000**. Lệnh `npm start` tự động kiểm tra cấu hình, khởi động Docker, sao lưu DB vào `.local/backups`, dựng các microservice và bật đồng thời backend + frontend.

### 3. Các lệnh tiện ích thường dùng

```powershell
npm run seed:demo-data      # Nạp bộ công ty, ứng viên, Kanban & lịch phỏng vấn mẫu
npm run demo:show-jobs      # Hiển thị các tin tuyển dụng [Demo] (ẩn lại bằng demo:hide-jobs)
npm run dev:status          # Xem trạng thái toàn bộ cổng và dịch vụ đang chạy
npm run dev:stop            # Dừng toàn bộ ứng dụng (giữ nguyên dữ liệu)
npm run hooks:install       # Bật Git hook pre-push kiểm tra CI ngay trên máy (chạy 1 lần)
npm run verify:push         # Chạy nhanh các cổng CI chính trước khi push
npm run check               # Chạy toàn bộ lint + coverage + hợp đồng + audit + build như CI
```

---

## 🔁 CI/CD & Chất lượng

Mỗi lần `push` / `pull request`, **4 workflow GitHub Actions** chạy song song (lọc theo thư mục thay đổi) trên hạ tầng dùng-một-lần (MySQL, PostgreSQL, MongoDB, Redis, RabbitMQ, Elasticsearch) với **AI giả lập** — không gọi nhà cung cấp thật, không cần khóa bí mật.

```mermaid
flowchart LR
    Dev["💻 git push"] --> Hook["🪝 pre-push hook<br/>lint · exports · contracts · coverage"]
    Hook --> GH["GitHub Actions"]
    GH --> MS["Microservices quality<br/>verify + compose-background"]
    GH --> AU["Authentication & OIDC<br/>mysql-oidc-browser"]
    GH --> RT["Realtime integration<br/>mysql-redis"]
    GH --> MU["Mutation testing<br/>backend + microservices"]
    MS & AU & RT & MU --> OK["✅ 4 / 4 xanh"]
```

| Workflow | Job | Kiểm tra chính |
| :--- | :--- | :--- |
| [![Microservices quality](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/microservices.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/microservices.yml) | `verify` | Coverage Backend/Frontend/Microservices, ESLint, hợp đồng HTTP (OpenAPI) & Event (JSON Schema), runtime test, `npm audit`, build, Docker image, Playwright với MySQL/Redis/RabbitMQ/Elasticsearch, Prometheus rules |
| | `compose-background` | Dựng toàn bộ 8 dịch vụ bằng Docker Compose cô lập, chạy hành trình trình duyệt thật: AI CV → tìm việc → nộp CV → Kanban → restart dịch vụ, mất broker & phục hồi |
| [![Authentication and OIDC acceptance](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/authentication.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/authentication.yml) | `mysql-oidc-browser` | Phiên đăng nhập, refresh token xoay vòng, chữ ký OIDC/SSO và hành trình trình duyệt trên MySQL riêng |
| [![Realtime integration](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/realtime.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/realtime.yml) | `mysql-redis` | Toàn bộ test backend, chat realtime Socket.IO + Redis adapter, Web Push trên Chromium/Firefox/WebKit, kiểm thử hỗn loạn (chaos) |
| [![Mutation testing](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/mutation.yml/badge.svg?branch=main)](https://github.com/nguyentuanthien2384/DALN_JobFind/actions/workflows/mutation.yml) | `mutation` | Stryker đột biến mã bảo mật, hạn mức & thanh toán (chạy theo PR liên quan + hằng tuần) |

**Ngưỡng coverage bắt buộc** (CI đỏ nếu tụt dưới):

| Dự án | Statements | Branches | Functions | Lines |
| :--- | :---: | :---: | :---: | :---: |
| Backend (Jest) | 90% | 85% | 90% | 90% |
| Frontend (Jest + RTL) | 85% | 70% | 80% | 85% |
| Microservices (Vitest) | 80% | 75% | 80% | 80% |

> [!IMPORTANT]
> Chạy `npm run hooks:install` một lần sau khi clone. Từ đó mỗi lần `git push`, hook [`.githooks/pre-push`](.githooks/pre-push) tự chạy `npm run verify:push` (ESLint, kiểm tra named export, hợp đồng API/Event, runtime test và coverage của cả 3 dự án) và **chặn push nếu có lỗi**, giúp commit lên GitHub luôn xanh. Đặt `JOBFIND_FULL_CHECK=1` để chạy toàn bộ `npm run check`.

**Bảo mật mặc định**: Access token ngắn hạn + Refresh token `HttpOnly` xoay vòng; API Gateway tự xóa header định danh giả mạo; phân quyền theo công ty ở từng request; thanh toán đối chiếu chữ ký HMAC-SHA256 / HMAC-SHA512 và số tiền trước khi cộng quyền lợi; file `.env` chứa khóa API luôn nằm ngoài Git.

### 🚀 Triển khai 1 VPS (Docker + Caddy HTTPS tự động)

```powershell
npm run vps:env -- ten-mien-cua-ban.com   # Sinh deploy/.env kèm mật khẩu mới & chép cấu hình Sandbox/AI/SSO
npm run vps:export-data                   # Xuất dữ liệu hiện tại để nạp lên VPS
```

Hướng dẫn chi tiết: [deploy/README.md](deploy/README.md) · [Kiểm thử](docs/testing.md) · [Microservices](microservices/README.md).

---

<div align="center">

**JobFind** — Tuyển dụng nhanh hơn, minh bạch hơn, với AI đồng hành cùng con người.

[⬆ Về đầu trang](#-jobfind)

</div>
