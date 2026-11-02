# -*- coding: utf-8 -*-
"""
Script xây dựng tài liệu Word: BÁO CÁO THUYẾT TRÌNH VÀ KỊCH BẢN DEMO TOÀN DIỆN DỰ ÁN JOBFIND
Tích hợp chuyên sâu:
- Phân tích 3 tầng: Frontend xử lý, Backend & DB xử lý, Microservices & Message Queue điều phối.
- Chuyên đề chi tiết: Gửi mail thật (Transactional Outbox + Nodemailer + RabbitMQ).
- Chuyên đề chi tiết: Chatbot AI (Vercel AI SDK, Streaming SSE, Prompt Caching, Hedging, Function Calling, Human Handoff).
- Chuyên đề chi tiết: Dashboard Recharts (Polyglot Data Aggregation).
- Kịch bản demo 5 Hồi thực chiến: Thao tác UI từng bước, lời thoại thuyết minh, code minh họa và sơ đồ hoạt động.
"""

import os
import shutil
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx_helpers import (
    set_cell_background, set_cell_margins, set_table_borders,
    add_callout, add_diagram, add_code_snippet, add_tech_integration_box,
    add_three_tier_box, add_custom_heading, add_body_p, add_bullet_p, create_table
)

def build_ultimate_demo_document():
    doc = docx.Document()
    
    # Thiết lập lề trang A4
    for section in doc.sections:
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.8)
        section.right_margin = Inches(0.8)
        section.page_width = Inches(8.27)
        section.page_height = Inches(11.69)

    # =========================================================================
    # TRANG BÌA (COVER PAGE)
    # =========================================================================
    p_org = doc.add_paragraph()
    p_org.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_org = p_org.add_run("BỘ GIÁO DỤC VÀ ĐÀO TẠO — TRƯỜNG ĐẠI HỌC CÔNG NGHỆ\nKHOA CÔNG NGHỆ THÔNG TIN & TRUYỀN THÔNG\n" + "—" * 28)
    r_org.font.name = "Segoe UI"
    r_org.font.size = Pt(11)
    r_org.font.bold = True
    r_org.font.color.rgb = RGBColor(75, 85, 99)

    doc.add_paragraph().paragraph_format.space_after = Pt(24)

    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_sub = p_title.add_run("TÀI LIỆU BÁO CÁO KỸ THUẬT & KỊCH BẢN THUYẾT TRÌNH BẢO VỆ ĐỀ ÁN\n")
    r_sub.font.name = "Segoe UI"
    r_sub.font.size = Pt(12)
    r_sub.font.bold = True
    r_sub.font.color.rgb = RGBColor(15, 118, 110)

    r_main = p_title.add_run("BÁO CÁO KIẾN TRÚC ĐA TẦNG &\nKỊCH BẢN DEMO TOÀN DIỆN HỆ THỐNG JOBFIND\n")
    r_main.font.name = "Segoe UI"
    r_main.font.size = Pt(21)
    r_main.font.bold = True
    r_main.font.color.rgb = RGBColor(30, 58, 138)

    r_desc = p_title.add_run("Phân Tích Chi Tiết 3 Tầng: Frontend (React 18) — Backend & Database — Microservices (RabbitMQ, Polyglot DBs)\nChuyên Đề Sâu: Chatbot AI Streaming SSE & Gửi Email Thật Transactional Outbox Nodemailer")
    r_desc.font.name = "Segoe UI"
    r_desc.font.size = Pt(10)
    r_desc.font.italic = True
    r_desc.font.color.rgb = RGBColor(107, 114, 128)

    doc.add_paragraph().paragraph_format.space_after = Pt(26)

    # Bảng thông tin đề án
    info_tbl = doc.add_table(rows=6, cols=2)
    info_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(info_tbl, color="E5E7EB", sz="2")
    
    meta_info = [
        ("Tên đề tài / Hệ thống:", "JobFind — Intelligent Recruitment Platform with AI Microservices"),
        ("Kiến trúc hệ thống:", "Microservices Polyglot (API Gateway + 8 Microservices + AI Worker + RabbitMQ)"),
        ("Công nghệ Frontend:", "React 18 SPA, Redux, Context API, Dedicated SSE Fetch Reader, Socket.IO Client, Recharts, Bootstrap 5"),
        ("Công nghệ Backend & DB:", "Node.js 20, Express 5, PostgreSQL 16 JSONB, MySQL 8, MongoDB Mongoose, Elasticsearch 8.15, Redis 7, Nodemailer"),
        ("Mô hình AI tích hợp:", "Anthropic Claude 3.5 Sonnet (AI Worker CV/JD), Claude 3.5 Haiku (Chatbot), Vercel AI SDK, Prompt Caching"),
        ("Phiên bản phát hành:", "Release v2.8 (Cập nhật Tháng 11/2026 — Đầy đủ Code mẫu & Sơ đồ luồng)")
    ]
    for idx, (k, v) in enumerate(meta_info):
        row = info_tbl.rows[idx]
        c0, c1 = row.cells[0], row.cells[1]
        c0.width = Inches(2.3)
        c1.width = Inches(4.4)
        set_cell_background(c0, "F8FAFC")
        set_cell_background(c1, "FFFFFF")
        set_cell_margins(c0, 60, 60, 100, 100)
        set_cell_margins(c1, 60, 60, 100, 100)
        
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(k)
        r0.font.name = "Segoe UI"
        r0.font.size = Pt(9.5)
        r0.font.bold = True
        r0.font.color.rgb = RGBColor(30, 58, 138)
        
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(v)
        r1.font.name = "Segoe UI"
        r1.font.size = Pt(9.5)
        r1.font.color.rgb = RGBColor(31, 41, 55)

    doc.add_paragraph().paragraph_format.space_after = Pt(36)

    p_bot = doc.add_paragraph()
    p_bot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_bot = p_bot.add_run("Hà Nội — Năm 2026")
    r_bot.font.name = "Segoe UI"
    r_bot.font.size = Pt(10)
    r_bot.font.bold = True
    r_bot.font.color.rgb = RGBColor(107, 114, 128)

    doc.add_page_break()

    # =========================================================================
    # PHẦN I: TỔNG QUAN HỆ THỐNG & CHUẨN BỊ BUỔI BÁO CÁO
    # =========================================================================
    add_custom_heading(doc, "PHẦN I: TỔNG QUAN HỆ THỐNG & CHUẨN BỊ TRƯỚC BUỔI DEMO", level=1)
    
    add_custom_heading(doc, "1.1 Mục Tiêu & Cấu Trúc Trình Diễn Của Buổi Báo Cáo", level=2)
    add_body_p(doc, "Tài liệu kịch bản này được biên soạn để phục vụ toàn diện cho buổi thuyết trình và bảo vệ đề án. Mỗi tính năng được giải trình rõ ràng qua 5 tầng thông tin liền mạch:")
    add_bullet_p(doc, "Từng thao tác click chuột, phím bấm, nhập liệu và kết quả kỳ vọng trên màn hình.", bold_prefix="1. Kịch bản thao tác UI chi tiết:")
    add_bullet_p(doc, "Đoạn văn phát biểu mẫu giúp người nói tự tin, mạch lạc, làm nổi bật giá trị cốt lõi.", bold_prefix="2. Lời thoại thuyết minh sắc bén:")
    add_bullet_p(doc, "Mô hình hóa trực quan dòng chảy dữ liệu giữa Frontend -> Gateway -> Microservices -> RabbitMQ -> Database.", bold_prefix="3. Sơ đồ hoạt động luồng dữ liệu (Data Flow Diagram):")
    add_bullet_p(doc, "Trích dẫn các hàm cốt lõi từ mã nguồn dự án để chứng minh giải pháp kỹ thuật hoạt động thực tế 100%.", bold_prefix="4. Code minh họa triển khai thực tế (Implementation Code):")
    add_bullet_p(doc, "Bóc tách cụ thể: Frontend xử lý ra sao, Backend xử lý nghiệp vụ & CSDL thế nào, Microservices điều phối bất đồng bộ ra sao.", bold_prefix="5. Phân tích kiến trúc 3 tầng (Frontend - Backend - Microservices):")

    add_custom_heading(doc, "1.2 Danh Sách Tài Khoản Demo Chuẩn Bị Sẵn", level=2)
    acc_headers = ["Vai Trò (Role)", "Tài Khoản Đăng Nhập", "Mật Khẩu", "Mục Đích Sử Dụng Khi Demo"]
    acc_data = [
        ["🏢 Doanh nghiệp (Chủ cty)", "0918800001 (Sao Khuê Digital)", "Demo@123456", "Mở ở Cửa sổ Incognito 1: Demo Kanban, AI Bulk Screening, mua gói PayPal, gửi Offer."],
        ["👔 Nhân viên tuyển dụng", "0938800001 (HR Sao Khuê)", "Demo@123456", "Minh họa phân quyền nội bộ công ty (cùng xử lý hồ sơ ứng viên)."],
        ["👤 Ứng viên chính (Candidate)", "0928800001 (Nguyễn Minh An)", "Demo@123456", "Mở ở Cửa sổ Thường: Tìm việc, Không gian AI CV, nộp hồ sơ, chat realtime và chatbot."],
        ["👤 Ứng viên phụ / Test", "0764188123", "123456", "Dùng để nộp thử hồ sơ mới kiểm tra luồng nhận thông báo."],
        ["🛡️ Quản trị viên (Admin)", "0795095049", "123456", "Mở ở Cửa sổ Incognito 2: Dashboard, kiểm duyệt tin AI Moderation, xử lý ticket Chatbot."]
    ]
    create_table(doc, acc_headers, acc_data, [1.5, 1.8, 1.1, 2.3])

    doc.add_page_break()

    # =========================================================================
    # PHẦN II: CHUYÊN ĐỀ KIẾN TRÚC ĐA TẦNG (FRONTEND — BACKEND — MICROSERVICES)
    # =========================================================================
    add_custom_heading(doc, "PHẦN II: KIẾN TRÚC TOÀN CẢNH ĐA TẦNG (FRONTEND — BACKEND — MICROSERVICES)", level=1)
    
    add_custom_heading(doc, "2.1 Mô Hình Phân Lớp 3 Tầng Toàn Diện Của Hệ Thống", level=2)
    add_body_p(doc, "Hệ thống JobFind được thiết kế tách lớp nghiêm ngặt nhằm đảm bảo tính sẵn sàng cao, dễ mở rộng độc lập và chịu tải lớn:")
    
    add_bullet_p(doc, "Xây dựng bằng React 18 SPA. Quản lý trạng thái bằng Context API và LocalStorage/SessionStorage. Tích hợp Dedicated Fetch Client (thay vì Axios) cho Server-Sent Events (SSE) để stream câu trả lời AI theo thời gian thực; Socket.IO client cho giao tiếp song công; Recharts cho biểu đồ trực quan; và cơ chế Optimistic UI Updates cho bảng Kanban mượt mà.", bold_prefix="🖥️ Tầng 1 — Frontend (Client): ")
    add_bullet_p(doc, "Xử lý logic nghiệp vụ, xác thực dữ liệu (Zod/Joi validation), kiểm soát quyền (RBAC), quản lý phiên giao dịch cục bộ ACID (PostgreSQL withTransaction, Sequelize Transaction), và cơ chế chống ghi trùng Idempotency. Áp dụng Polyglot Persistence: MySQL cho giao dịch tài chính/user, PostgreSQL 16 JSONB cho pipeline ứng tuyển, MongoDB cho hồ sơ CV & audit log, Redis cho cache/session.", bold_prefix="⚙️ Tầng 2 — Backend & Database Logic: ")
    add_bullet_p(doc, "Bao gồm API Gateway (:4000) đón tiếp và định tuyến qua Reverse Proxy, RabbitMQ Message Broker (AMQP 0-9-1) làm trục xương sống điều phối sự kiện bất đồng bộ, Transactional Outbox Relay giải quyết bài toán Dual-Write, và mạng lưới 8 Microservices chuyên biệt: Identity (:4001), Job Core (:4002), Search (:4003), Application (:4004), Notification (:4005), Admin (:4006), AI Worker, và Support Chat (:4008).", bold_prefix="🌐 Tầng 3 — Microservices & Infrastructure: ")

    add_diagram(doc,
"""┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND CLIENT (REACT 18 SPA)                            │
│   ├── Dedicated SSE Fetch Client (Chatbot)  ├── Socket.IO Client (Chat 1-1 / Handoff)  │
│   ├── Axios Interceptor (JWT Bearer)       ├── Recharts & Chart.js Data Visualizer     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP / WebSocket (Port 4000)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   API GATEWAY (:4000)                                  │
│   ├── Reverse Proxy Routing      ├── JWT Authentication & RBAC Verification            │
│   ├── Rate Limiting (Token Bucket)├── Internal Secret Injection (x-internal-secret)     │
└───────┬──────────────┬──────────────┬─────────────┬──────────────┬──────────────┬──────┘
        │              │              │             │              │              │
        ▼              ▼              ▼             ▼              ▼              ▼
┌──────────────┐┌──────────────┐┌────────────┐┌────────────┐┌────────────┐┌────────────┐
│Identity :4001││Job Core :4002││Search :4003││App Svc :4004││Admin :4006 ││Chatbot:4008│
│ Auth / OAuth ││ Posts / Quota││ ES 8.15 DSL││Postgres 16 ││ Polyglot   ││Claude Haiku│
│ Mongo Profile││ MySQL Core   ││ icu_filter ││Outbox Relay││ Aggregation││SSE Stream  │
└───────┬──────┘└──────┬───────┘└────────────┘└─────┬──────┘└────────────┘└────────────┘
        │              │                            │
        │              ▼ (ai.tasks)                 ▼ (application.stage_changed)
        │       ┌─────────────────────────────────────────────────────────┐
        │       │                 RABBITMQ MESSAGE BROKER                 │
        │       └──────────────┬───────────────────────────┬──────────────┘
        │                      │                           │
        │                      ▼                           ▼
        │               ┌──────────────┐            ┌──────────────┐
        │               │  AI Worker   │            │ Notification │
        │               │pdfjs extract │            │ Service :4005│
        │               │Claude Sonnet │            │Nodemailer SSL│
        │               │Mongo Ledgers │            │Gmail SMTP 465│
        │               └──────────────┘            └──────────────┘
        ▼                                                  │
┌─────────────────┐                                        ▼
│ REDIS 7 CLUSTER │                       ┌──────────────────────────────────┐
│Socket.IO Streams│                       │ REAL INBOX GMAIL CỦA ỨNG VIÊN    │
│Answer Cache TTL │                       │ Thư mời PV / Offer kèm Calendar  │
└─────────────────┘                       └──────────────────────────────────┘
""",
        title="SƠ ĐỒ 2.1: KIẾN TRÚC TOÀN CẢNH HỆ THỐNG MICROSERVICES & HẠ TẦNG SỰ KIỆN JOBFIND"
    )

    # -------------------------------------------------------------------------
    # CHUYÊN ĐỀ SÂU 1: GỬI EMAIL THẬT
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "2.2 Chuyên Đề Phân Tích Sâu: Cơ Chế Gửi Email Thật & Transactional Outbox Pattern", level=2)
    add_body_p(doc, "Một trong những tính năng thực tế và khắt khe nhất của JobFind là việc gửi email mời phỏng vấn và email trúng tuyển (Offer Letter) trực tiếp về hòm thư Gmail thật của ứng viên. Dưới đây là phân tích chi tiết dòng chảy kỹ thuật qua cả 3 tầng:")

    add_three_tier_box(
        doc,
        feature_name="Gửi Thư Mời Phỏng Vấn & Offer Letter Về Gmail Thật",
        frontend_logic="""• Giao diện Kanban: HR mở modal 'Mời phỏng vấn' hoặc 'Gửi trúng tuyển' -> Nhập thời gian, link Google Meet hoặc mức lương offer.
• Tích hợp AI soạn thảo: HR bấm 'AI soạn lời nhắn' -> Nhận nội dung cá nhân hóa -> Bấm 'Xem trước email' (Nguyên tắc Human-in-the-loop).
• Gọi API: Frontend đóng gói payload và gửi POST /api/applications/:id/invite-interview qua Axios có kèm JWT Bearer Token.
• Giao diện nhận phản hồi: Hiển thị Toast thông báo thành công và tự động chuyển thẻ ứng viên sang cột mới trên Kanban mà không cần reload trang.""",
        backend_logic="""• Controller & Service: application-service tiếp nhận yêu cầu, xác thực HR có quyền đối với tin tuyển dụng đó.
• Giải quyết bài toán Dual-Write bằng PostgreSQL Transaction:
  1. UPDATE applications SET stage = 'phong_van', updated_at = NOW() WHERE id = appId.
  2. INSERT INTO application_events (lưu lịch sử và snapshot JSONB chi tiết cuộc hẹn/offer).
  3. INSERT INTO outbox_events (lưu payload sự kiện gồm aggregateId, eventType='application.stage_changed', payload JSONB).
• Cả 3 thao tác đều nằm trong cùng 1 withTransaction(client). Nếu server gặp sự cố giữa chừng, toàn bộ rollback; không bao giờ có chuyện lưu dữ liệu mà mất email hoặc gửi email mà không lưu CSDL.
• Outbox Relay Poller: Một tiến trình chạy ngầm mỗi 1 giây (runOutboxOnce), truy vấn bảng outbox_events với cơ chế SELECT ... FOR UPDATE OF e SKIP LOCKED (cho phép nhiều instance chạy song song không tranh chấp) để lấy các sự kiện chưa gửi (published_at IS NULL).""",
        microservice_logic="""• RabbitMQ điều phối: Outbox Relay phát sự kiện lên RabbitMQ exchange với Publisher Confirm. Khi broker xác nhận đã nhận, Relay mới cập nhật published_at = NOW().
• Notification Service tiêu thụ: Consumer notificationConsumer.js lắng nghe hàng đợi 'notification-service.events'.
• Kiểm tra Deduplication: Kiểm tra eventId trong deliveryStore để đảm bảo tính Idempotency, loại bỏ nguy cơ gửi email trùng lặp.
• Truy xuất thông tin người nhận: Truy vấn MySQL lấy email thật và họ tên của ứng viên (users table).
• Biên dịch HTML Email Responsive: Dùng template applicationEventTemplate, tự động tạo đường dẫn Google Calendar 1-click (URL mã hóa thời gian, phòng họp Google Meet).
• Cấu hình Reply-To chuyên nghiệp: Thiết lập replyTo là email của chính HR. Khi ứng viên nhận thư trong Gmail và bấm Reply, thư phản hồi sẽ gửi thẳng tới HR mà không bị kẹt ở no-reply bot.
• Vận chuyển qua Gmail SMTP: Sử dụng Nodemailer kết nối smtp.gmail.com:465 (SSL/TLS), xác thực bằng App Password 16 ký tự an toàn. Thư được gửi tới Inbox thật của ứng viên trong vòng 1-2 giây."""
    )

    add_code_snippet(doc,
"""// 1. [Backend] application-service: Transactional Outbox lưu dữ liệu an toàn tuyệt đối
export const inviteInterview = async (applicationId, hrUser, interviewData) => {
  return await withTransaction(async (client) => {
    // Thao tác 1: Cập nhật bước phỏng vấn
    await client.query(
      'UPDATE applications SET stage = $1, updated_at = NOW() WHERE id = $2',
      ['phong_van', applicationId]
    );

    // Thao tác 2: Lưu snapshot cuộc hẹn dạng JSONB
    await client.query(
      `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, decision_snapshot)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [applicationId, 'reviewing', 'phong_van', hrUser.id, JSON.stringify(interviewData)]
    );

    // Thao tác 3: Ghi vào bảng outbox_events TRONG CÙNG 1 TRANSACTION CƠ SỞ DỮ LIỆU
    await enqueueOutboxEvent(client, {
      aggregateId: applicationId,
      eventType: 'application.stage_changed',
      payload: {
        applicationId,
        candidateEmail: interviewData.candidateEmail,
        hrEmail: hrUser.email,
        interview: interviewData
      }
    });
  });
};

// 2. [Microservice] notification-service: Nodemailer gửi Gmail thật với Reply-To
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail', // smtp.gmail.com:465
  connectionTimeout: 15000,
  auth: {
    user: process.env.EMAIL_APP,          // Email tổng gửi thông báo
    pass: process.env.EMAIL_APP_PASSWORD // App Password 16 ký tự bảo mật Google
  }
});

export const sendInterviewEmail = async ({ candidateEmail, hrEmail, interview }) => {
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Phỏng vấn: ' + interview.jobTitle)}&dates=${interview.startIso}/${interview.endIso}&details=${encodeURIComponent(interview.meetUrl)}`;

  await transporter.sendMail({
    from: `"JobFind Tuyển Dụng" <${process.env.EMAIL_APP}>`,
    to: candidateEmail, // Gửi tới hộp thư thật của ứng viên
    replyTo: hrEmail,   // Ứng viên bấm Reply là phản hồi thẳng tới HR công ty!
    subject: `[JobFind] Thư mời phỏng vấn vị trí ${interview.jobTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">THƯ MỜI PHỎNG VẤN ỨNG VIÊN</h2>
        <p>Xin chào <b>${interview.candidateName}</b>,</p>
        <p>Công ty trân trọng mời bạn tham dự buổi phỏng vấn vị trí <b>${interview.jobTitle}</b>:</p>
        <ul>
          <li><b>Thời gian:</b> ${interview.timeString}</li>
          <li><b>Hình thức:</b> Online qua Google Meet</li>
          <li><b>Phòng họp:</b> <a href="${interview.meetUrl}">${interview.meetUrl}</a></li>
        </ul>
        <div style="margin: 20px 0;">
          <a href="${googleCalendarUrl}" style="background-color: #0f766e; color: #fff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            📅 Thêm vào Google Calendar của tôi
          </a>
        </div>
        <p style="color: #64748b; font-size: 13px;">Bạn chỉ cần bấm <b>Reply</b> trực tiếp email này để trao đổi với HR.</p>
      </div>`
  });
};""",
        title="CODE MINH HỌA 2.2: TRANSACTIONAL OUTBOX POSTGRESQL VÀ GỬI GMAIL VỚI NODEMAILER"
    )

    # -------------------------------------------------------------------------
    # CHUYÊN ĐỀ SÂU 2: CHATBOT AI
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "2.3 Chuyên Đề Phân Tích Sâu: Kiến Trúc Trợ Lý AI Chatbot, Function Calling & Human Handoff", level=2)
    add_body_p(doc, "Chatbot AI của JobFind không phải là một widget hỏi-đáp tĩnh thông thường, mà là một hệ thống đàm thoại thông minh đa tác vụ, kết nối dữ liệu thời gian thực và hỗ trợ bàn giao người thật (Human Handoff):")

    add_three_tier_box(
        doc,
        feature_name="Trợ Lý AI Chatbot 24/7, Function Calling & Chuyển Giao Người Thật",
        frontend_logic="""• Giao diện SupportChat.jsx: Nút nổi ở góc phải màn hình, có huy hiệu tin chưa đọc và lời chào chủ động (Proactive teaser) sau 6 giây duyệt web.
• Dedicated Fetch Client: Không dùng Axios thông thường (vì Axios đệm toàn bộ body, không hỗ trợ đọc stream), frontend triển khai hàm streamSupportReply() dùng native fetch() với Header 'Accept: text/event-stream'.
• Xử lý luồng SSE: Sử dụng response.body.getReader() và TextDecoder đọc từng chunk nhị phân:
  - event: token: Cộng dồn chữ tạo hiệu ứng máy chữ (typing streaming) mượt mà.
  - event: state: Hiển thị thông báo trạng thái ('Đang tìm việc làm phù hợp...').
  - event: tool: Hiển thị kết quả tra cứu việc làm dạng Carousel thẻ đẹp mắt (logo, hạn nộp, link chuẩn /detail-job/:id).
  - event: suggestions: Hiển thị các nút gợi ý câu hỏi tiếp theo (Quick reply chips).
• Chuyển người thật (Human Handoff): Người dùng bấm 'Gặp nhân viên hỗ trợ' -> Gọi POST /api/support/conversations/:id/handoff kèm cờ đồng ý chia sẻ lịch sử chat.""",
        backend_logic="""• Support Chat Service (:4008): Tiếp nhận request tại endpoint /api/support/turn qua Gateway.
• Answer Cache: Nếu câu hỏi mở đầu giống hệt trong vòng 10 phút (SUPPORT_ANSWER_CACHE_TTL_MS), trả về ngay từ bộ nhớ RAM (độ trễ 0ms, không tốn token).
• Kỹ thuật Hedging: Nếu sau 4000ms (SUPPORT_HEDGE_MS) máy chủ AI chưa trả token đầu tiên, dịch vụ tự động phát song song một request thứ hai giống hệt. Request nào về trước thì sử dụng và hủy request còn lại, giúp giảm thời gian chờ từ 17.5s xuống 9.4s.
• Anthropic Prompt Caching: Đánh dấu cache các quy tắc ứng xử (System Prompt) và danh sách Tool definitions tại Anthropic, giúp giảm 75% chi phí token và tăng 50% tốc độ xử lý.
• Vercel AI SDK: Sử dụng hàm streamText() kết nối mô hình Claude 3.5 Haiku, tự động điều phối vòng lặp gọi Tool (maxSteps: 3).""",
        microservice_logic="""• Phân quyền và gọi Tools: Dịch vụ chia làm 2 nhóm công cụ:
  1. Công cụ công khai (search_jobs, job_market_overview): Gọi sang Search Service và Elasticsearch để lấy việc làm đang tuyển.
  2. Công cụ riêng tư (getMyApplications, getMyProfileSummary, getMySavedJobs, getMyCompanyJobs, getSubscriptionStatus): Xác thực quyền người dùng qua JWT/x-user-id và gọi sang Application Service hoặc truy vấn CSDL. Dữ liệu cá nhân tuyệt đối không được gửi bừa bãi cho mô hình AI.
• Quy trình Human Handoff sang Admin:
  - Khi ứng viên yêu cầu chuyển nhân viên, dịch vụ tạo một ticket trong MySQL (support_tickets) với trạng thái 'waiting', lưu toàn bộ transcript hội thoại.
  - Bắn sự kiện Socket.IO sang bàn làm việc Admin (SupportInbox.jsx tại /admin/support).
  - Admin nhận thông báo realtime, đọc lịch sử trò chuyện, bấm 'Tiếp nhận' (Claim) để chuyển sang chat 1-1 trực tiếp với ứng viên."""
    )

    add_code_snippet(doc,
"""// 1. [Frontend] supportChatService.js: Đọc luồng Server-Sent Events (SSE) từng chunk
export const streamSupportReply = async (messages, { onText, onState, onTool, onSuggestions, turn }) => {
  // Bắt buộc dùng Fetch API thay vì Axios để đọc Stream trực tiếp
  const response = await fetch('http://localhost:4000/api/support/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(turn)
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let answer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    
    // Giải mã từng khung dữ liệu SSE
    const frame = decoder.decode(value, { stream: true });
    const lines = frame.split('\\n');
    const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\\n');

    if (event === 'token') {
      const payload = JSON.parse(data);
      answer += payload.text;
      onText(answer); // Cập nhật chữ bay bổng trên giao diện
    } else if (event === 'state') {
      onState(JSON.parse(data)); // Cập nhật trạng thái đang xử lý
    }
  }
};

// 2. [Backend] support-chat-service: Vercel AI SDK kết nối Claude và Function Calling
import { streamText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function handleChatTurn({ messages, user, toolsProvider }) {
  const result = await streamText({
    model: anthropic('claude-3-5-haiku-20241022'),
    system: 'Bạn là trợ lý JobFind. Hỗ trợ tìm việc và giải đáp chính sách tuyển dụng.',
    messages,
    tools: {
      search_jobs: tool({
        description: 'Tìm kiếm danh sách việc làm công khai đang mở',
        parameters: z.object({
          keyword: z.string().optional(),
          location: z.string().optional(),
          minSalary: z.number().optional()
        }),
        execute: async (args) => await toolsProvider.publicTool('search_jobs', args)
      }),
      getMyApplications: tool({
        description: 'Tra cứu danh sách đơn ứng tuyển của người dùng đang đăng nhập',
        parameters: z.object({}),
        execute: async () => await toolsProvider.privateTool('getMyApplications', user)
      })
    },
    maxSteps: 3
  });

  return result.toDataStreamResponse(); // Trả về Server-Sent Events trực tiếp
}""",
        title="CODE MINH HỌA 2.3: FRONTEND ĐỌC STREAM SSE VÀ BACKEND STREAMTEXT TOOL CALLING"
    )

    # -------------------------------------------------------------------------
    # CHUYÊN ĐỀ SÂU 3: DASHBOARD RECHARTS
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "2.4 Chuyên Đề Phân Tích Sâu: Bảng Điều Khiển Dashboard & Tổng Hợp Đa Cơ Sở Dữ Liệu (Polyglot Aggregation)", level=2)
    add_body_p(doc, "Để cung cấp góc nhìn toàn diện cho Quản trị viên (Admin) và Doanh nghiệp, JobFind triển khai cơ chế tổng hợp số liệu đa CSDL không gây nghẽn:")

    add_three_tier_box(
        doc,
        feature_name="Admin Dashboard & Biểu Đồ Recharts Co Giãn Đa Kích Thước",
        frontend_logic="""• Component TrendChart: Xây dựng bằng thư viện Recharts (ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip).
• Giao diện thích ứng: Tự động co giãn theo độ phân giải màn hình mà không vỡ layout; sử dụng thẻ <defs> <linearGradient> tạo hiệu ứng chuyển sắc đổ bóng mượt mà.
• Bộ lọc chu kỳ linh hoạt: Cho phép chọn nhanh 7 ngày, 30 ngày, quý, năm; tự động gọi API và chuyển đổi dữ liệu mượt mà bằng hiệu ứng animation.
• Khối Action Items: Liệt kê các việc cần xử lý ngay (tin chờ duyệt, công ty chờ duyệt, ticket hỗ trợ chưa tiếp nhận).""",
        backend_logic="""• Admin Service (:4006): Xử lý tại reportController.js, tiếp nhận khoảng thời gian fromDate, toDate theo múi giờ Việt Nam (UTC+7, VN_OFFSET_MS = 7*3600*1000).
• Polyglot Aggregation (Tổng hợp dữ liệu song song từ 3 CSDL khác nhau):
  1. MySQL Pool: Đếm tổng user hoạt động, công ty, tin tuyển dụng, và doanh thu bán gói (SUM(currentPrice * amount)).
  2. PostgreSQL Pool: Đếm số lượng hồ sơ ứng tuyển theo từng ngày từ bảng applications của Application Service.
  3. MongoDB Mongoose: Đếm số lượng hồ sơ CV hoàn thiện và thống kê nhật ký Audit Logs.
• Tính toán chỉ số: Gom nhóm dữ liệu theo ngày (GROUP BY calendar day), tự động bù đắp các ngày không có dữ liệu (zero-fill), và tính phần trăm tăng trưởng so với kỳ trước (percentChange).""",
        microservice_logic="""• Không phụ thuộc trực tiếp: Admin Service đọc bản sao read-only hoặc kết nối trực tiếp vào các CSDL chuyên biệt bằng Connection Pool giới hạn (connectionLimit: 5), không chọc qua HTTP của các service khác giúp tăng tốc độ truy vấn gấp 5 lần.
• Caching: Các số liệu tổng quan được cache ngắn hạn (TTL 60 giây) tại Redis để giảm tải cho CSDL khi nhiều Admin cùng truy cập.
• Xuất báo cáo Excel: Dữ liệu thống kê doanh thu được xuất ra định dạng file Excel (.xlsx) chuẩn hóa tải trực tiếp về máy tính."""
    )

    doc.add_page_break()

    # =========================================================================
    # PHẦN III: KỊCH BẢN THAO TÁC DEMO THỰC CHIẾN 5 HỒI
    # =========================================================================
    add_custom_heading(doc, "PHẦN III: KỊCH BẢN THAO TÁC DEMO THỰC CHIẾN 5 HỒI", level=1)

    # -------------------------------------------------------------------------
    # HỒI 1: ỨNG VIÊN
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "HỒI 1: TRẢI NGHIỆM ỨNG VIÊN — TÌM VIỆC & KHÔNG GIAN CV AI ĐỘT PHÁ", level=2)

    # Màn 1.1: Tìm kiếm Elasticsearch
    add_custom_heading(doc, "Màn 1.1: Tìm Kiếm Việc Làm Siêu Tốc Elasticsearch & 34 Tỉnh Thành (/job)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Vào menu 'Việc làm' (/job).")
    add_bullet_p(doc, "Gõ từ khóa 'React': Gợi ý tự động (Auto-suggest) hiện ra ngay dưới ô tìm kiếm sau 30ms.")
    add_bullet_p(doc, "Bên cột bộ lọc: Chọn Địa điểm 'Hà Nội' (theo danh mục 34 tỉnh/thành mới từ 01/07/2025), Ngành nghề 'Công nghệ thông tin', Mức lương '20 - 30 triệu' -> Bấm 'Tìm kiếm'.")
    add_bullet_p(doc, "Kết quả hiện ngay lập tức: Tin '[Demo] Frontend Developer React / TypeScript' đứng đầu kèm nhãn Verified Job.")

    add_callout(doc, "Kính thưa Hội đồng, hệ thống tìm kiếm việc làm của JobFind không dùng câu lệnh LIKE trong SQL thông thường vốn rất chậm khi dữ liệu lớn, mà được xây dựng trên nền tảng Elasticsearch 8.15. Khi em gõ 'React', tính năng Auto-suggest phản hồi sau chưa đầy 30ms. Bộ phân tích tiếng Việt chuyên sâu giúp nhận diện chính xác kể cả khi người dùng gõ có dấu hay không dấu. Đồng thời, toàn bộ danh mục địa phương đã được chuẩn hóa theo mô hình 34 tỉnh thành mới nhất.", title="LỜI THOẠI THUYẾT MINH MÀN 1.1")

    # Màn 1.2: Không gian AI CV
    add_custom_heading(doc, "Màn 1.2: Không Gian CV & 5 Chức Năng AI Vượt Trội (/candidate/ai-cv)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Vào menu người dùng -> Chọn 'CV và trợ lý AI' (/candidate/ai-cv).")
    add_bullet_p(doc, "Chức năng 1 'Tạo CV bằng AI': Nhập kinh nghiệm sơ sài -> Bấm 'Gửi yêu cầu AI' -> AI sinh bản nháp CV chuẩn ATS.")
    add_bullet_p(doc, "Chức năng 2 'Đọc CV từ PDF': Tải tệp PDF CV có sẵn -> AI đọc và bóc tách thành dữ liệu JSON cấu trúc điền vào CV Builder.")
    add_bullet_p(doc, "Chức năng 3 'Đánh giá độ phù hợp': Chọn tin Frontend Developer -> AI chấm 88/100, chỉ rõ kỹ năng khớp và thiếu.")
    add_bullet_p(doc, "Chức năng 4 'Soạn thư ứng tuyển' & Chức năng 5 'Xuất file PDF' bản in chất lượng cao.")

    add_three_tier_box(
        doc,
        feature_name="Bóc Tách CV PDF Bằng AI & Chấm Điểm Độ Phù Hợp ATS",
        frontend_logic="""• Giao diện /candidate/ai-cv: Cho phép upload file PDF CV.
• Hook useAiTask: Polling trạng thái GET /api/ai/tasks/:taskId mỗi 1.5 giây.
• Tự động điền: Khi task báo COMPLETED, toàn bộ học vấn, kinh nghiệm, kỹ năng bóc tách từ PDF tự động điền vào form CV Builder.""",
        backend_logic="""• Job Core Service (:4002): Tiếp nhận file PDF, lưu bản ghi ai_tasks với trạng thái 'PENDING' vào MySQL.
• Bắn thông điệp bất đồng bộ: Đẩy task vào hàng đợi 'ai.tasks' trong RabbitMQ kèm correlationId.""",
        microservice_logic="""• AI Worker Service tiêu thụ: Nhận task ngầm từ RabbitMQ, xử lý hoàn toàn tách biệt khỏi Web Gateway để không gây nghẽn HTTP.
• pdfjs-dist: Bóc tách text thô từ các trang của file PDF nhị phân.
• MongoDB ai_ledgers: Tính mã băm SHA-256 của nội dung CV. Nếu ứng viên từng tải CV này lên, lấy lại kết quả cũ trong 5ms mà không cần gọi lại AI, tiết kiệm 100% token.
• Anthropic Claude 3.5 Sonnet: Ép mô hình trả về cấu trúc JSON Schema (Structured Output), cập nhật kết quả vào MySQL."""
    )

    # Màn 1.3: Nộp hồ sơ thông minh
    add_custom_heading(doc, "Màn 1.3: Quy Trình Nộp Hồ Sơ Có AI Viết Lời Giới Thiệu (SendCvModal)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Tại chi tiết tin Frontend Developer: Bấm 'Nộp CV ngay'.")
    add_bullet_p(doc, "Tải tệp PDF -> Bấm 'Xem trước CV' (PdfPreviewButton) mở trực tiếp trang PDF kiểm tra.")
    add_bullet_p(doc, "Bấm 'Viết lời giới thiệu bằng AI': AI sinh 2 lời mở đầu súc tích (<= 255 ký tự) -> Bấm 'Dùng lời giới thiệu này'.")
    add_bullet_p(doc, "Bấm 'Gửi hồ sơ' -> Thông báo thành công tức thì. Vào /candidate/cv-post kiểm tra.")

    doc.add_page_break()

    # -------------------------------------------------------------------------
    # HỒI 2: DOANH NGHIỆP TUYỂN DỤNG
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "HỒI 2: DOANH NGHIỆP TUYỂN DỤNG & SỨC MẠNH TỰ ĐỘNG HÓA AI", level=2)

    # Màn 2.1: Đăng tin AI Moderation
    add_custom_heading(doc, "Màn 2.1: Đăng Tin Tuyển Dụng Mới Tích Hợp AI Kiểm Duyệt Nội Dung (/admin/add-post/)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Đăng nhập tài khoản Sao Khuê Digital (0918800001 / Demo@123456) tại Cửa sổ Incognito 1.")
    add_bullet_p(doc, "Vào 'Tạo mới bài đăng' (/admin/add-post/): Nhập thông tin việc làm và soạn mô tả bằng Markdown.")
    add_bullet_p(doc, "Nhấn 'Lưu bài viết': AI Moderation tự động phân tích và gắn nhãn rủi ro (Risk: LOW) lưu vào hệ thống.")

    # Màn 2.2: PayPal Sandbox
    add_custom_heading(doc, "Màn 2.2: Mua Gói Tuyển Dụng Qua Cổng PayPal Sandbox (/admin/buy-post/)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Vào 'Mua thêm lượt đăng bài' (/admin/buy-post/): Chọn loại 'Bài viết nổi bật', số lượng '2'.")
    add_bullet_p(doc, "Bấm 'Mua' -> Hệ thống chuyển sang cổng PayPal Sandbox.")
    add_bullet_p(doc, "Đăng nhập tài khoản người mua sandbox -> Xác nhận -> Redirect về /admin/payment/success -> Hạn mức được cộng ngay.")

    add_three_tier_box(
        doc,
        feature_name="Thanh Toán Mua Gói Tin Qua Cổng PayPal Sandbox",
        frontend_logic="""• Giao diện /admin/buy-post/: Chọn gói bài viết nổi bật, bấm Mua.
• Chuyển hướng: Frontend điều hướng trình duyệt sang đường dẫn approval_url của PayPal.
• Return URL: Sau khi người dùng xác nhận trên PayPal, trình duyệt chuyển về /admin/payment/success?token=ORDER_ID.""",
        backend_logic="""• Tạo Order v2: Backend gọi PayPal API tạo đơn hàng với giá trị tiền USD tương ứng.
• Capture trực tiếp từ Máy chủ: Backend không tin tưởng client, mà gửi lệnh capture trực tiếp từ máy chủ backend sang máy chủ PayPal.
• Sequelize ACID Transaction:
  1. db.Company.increment('allowHotPost', { by: 2, where: { id: companyId } }) (Cộng nguyên tử hạn mức).
  2. db.HistoryTrade.create(...) (Lưu hóa đơn thanh toán giao dịch thành công).""",
        microservice_logic="""• Đảm bảo tính toàn vẹn tài chính: Toàn bộ giao dịch được ghi nhận độc lập, tự động đồng bộ hạn mức công ty trên hệ thống.
• Nếu capture thất bại hoặc PayPal báo chưa hoàn tất, hạn mức tuyệt đối không được cộng."""
    )

    doc.add_page_break()

    # -------------------------------------------------------------------------
    # HỒI 3: KANBAN & EMAIL THỰC TẾ
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "HỒI 3: TRUNG TÂM TUYỂN DỤNG KANBAN 6 BƯỚC & TỰ ĐỘNG HÓA EMAIL", level=2)

    # Màn 3.1: Kanban & Bulk AI Screening
    add_custom_heading(doc, "Màn 3.1: Quản Trị Pipeline Kanban 6 Bước & AI Sàng Lọc Hàng Loạt (/admin/pipeline/)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Vào 'Quy trình tuyển dụng' (/admin/pipeline/): Bảng Kanban 6 cột hiện ra kèm Phễu tuyển dụng trực quan.")
    add_bullet_p(doc, "Bấm 'AI sàng lọc hồ sơ' (Bulk AI Screening): AI chấm 50 hồ sơ cùng lúc -> Huy hiệu điểm 'AI 88' hiện trên thẻ.")
    add_bullet_p(doc, "Tích chọn 'Sắp xếp theo điểm AI': Hồ sơ điểm cao nhất tự động xếp lên đầu cột.")
    add_bullet_p(doc, "Kéo thẻ 'Nguyễn Minh An' từ 'Mới ứng tuyển' sang 'Đang xem xét' -> Bấm vào thẻ để chấm 5 sao và ghi chú nội bộ.")

    # Màn 3.2: Lên lịch phỏng vấn & Gửi Email thật
    add_custom_heading(doc, "Màn 3.2: Lên Lịch Phỏng Vấn & Gửi Email Thật Tới Ứng Viên (Nodemailer)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Tại thẻ ứng viên: Bấm nút 'Mời phỏng vấn' (hoặc kéo vào cột Phỏng vấn).")
    add_bullet_p(doc, "Điền lịch hẹn (09:30 AM ngày mai, Online Google Meet link https://meet.google.com/abc-xyz).")
    add_bullet_p(doc, "Bấm 'AI soạn lời nhắn': AI sinh đoạn lời mời cá nhân hóa -> Bấm 'Dùng nội dung này'.")
    add_bullet_p(doc, "Bấm 'Xem trước thư mời phỏng vấn' -> Bấm 'Xác nhận gửi': Hệ thống gửi email thật về hòm thư Gmail của ứng viên.")

    add_callout(doc, "Kính thưa Hội đồng, đây là minh chứng cho kiến trúc hướng sự kiện (Event-Driven) của JobFind: Khi HR xác nhận gửi thư mời, Application Service áp dụng mô hình Transactional Outbox ghi đồng thời trạng thái và sự kiện vào PostgreSQL trong một Transaction cục bộ. Ngay lập tức, Outbox Relay chuyển sự kiện sang RabbitMQ để Notification Service dùng Nodemailer gửi một Email HTML tuyệt đẹp về đúng địa chỉ Gmail thật của bạn An, có sẵn nút 'Thêm vào Google Calendar' và cấu hình Reply-To gửi thẳng về cho HR.", title="LỜI THOẠI THUYẾT MINH MÀN 3.2")

    # Màn 3.3: Thư mời nhận việc (Offer Letter)
    add_custom_heading(doc, "Màn 3.3: Gửi Thư Mời Nhận Việc (Offer Letter) Chuẩn TopCV", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Tại hồ sơ ứng viên đạt: Bấm nút 'Gửi trúng tuyển' màu xanh lá.")
    add_bullet_p(doc, "Điền form: Lương chính thức 25.000.000 VNĐ Gross, ngày đi làm thứ Hai tuần tới, thử việc 2 tháng (85% lương), phúc lợi.")
    add_bullet_p(doc, "Bấm 'AI soạn lời nhắn' -> Bấm 'Xem trước thư mời' -> Bấm 'Xác nhận gửi': Email Offer Letter chính thức gửi tới Gmail ứng viên.")

    doc.add_page_break()

    # -------------------------------------------------------------------------
    # HỒI 4: CHAT & CHATBOT AI
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "HỒI 4: TƯƠNG TÁC THỜI GIAN THỰC & TRỢ LÝ AI CHATBOT ĐA NHÀ CUNG CẤP", level=2)

    # Màn 4.1: Chat 1-1 Socket.IO
    add_custom_heading(doc, "Màn 4.1: Nhắn Tin Realtime 1-1 Qua Socket.IO & Trợ Lý AI Soạn Tin (/chat)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Mở 2 cửa sổ cạnh nhau: Ứng viên bên trái, HR bên phải. Cùng vào /chat.")
    add_bullet_p(doc, "HR gõ tin: Phía Ứng viên hiện 'Đang soạn tin...' (Typing indicator). Gửi tin nhắn -> Ứng viên nhận tức thì qua Socket.IO.")
    add_bullet_p(doc, "Trợ lý AI Chat: Bấm 'Gợi ý trả lời' -> AI sinh 3 câu trả lời nhanh. Hoặc gõ nháp rồi bấm 'Viết lại lịch sự hơn' -> AI trau chuốt câu từ chuẩn công sở.")

    # Màn 4.2: Support Chatbot
    add_custom_heading(doc, "Màn 4.2: Trợ Lý AI Chatbot 24/7, Function Calling & Chuyển Nhân Viên (SupportChat)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Bấm biểu tượng Chatbot nổi ở góc phải màn hình.")
    add_bullet_p(doc, "Hỏi 'Tìm việc làm React trên 20 triệu tại Hà Nội': Chatbot kích hoạt công cụ 'search_jobs', trả về danh sách thẻ việc làm dạng Carousel.")
    add_bullet_p(doc, "Hỏi 'Đơn ứng tuyển của tôi': Chatbot tra cứu private database và hiển thị chính xác các hồ sơ đã nộp của ứng viên.")
    add_bullet_p(doc, "Tích chọn 'Đồng ý chia sẻ hội thoại' -> Bấm 'Chuyển hội thoại cho hỗ trợ' (Human Handoff): Chatbot bàn giao phiên chat cho Admin.")

    add_callout(doc, "Kính thưa Hội đồng, Chatbot của JobFind không chỉ trả lời theo văn bản định sẵn. Em vừa yêu cầu 'Tìm việc làm React trên 20 triệu tại Hà Nội', chatbot đã sử dụng cơ chế Function Calling tự động gọi công cụ search_jobs truy vấn Elasticsearch và hiển thị danh sách thẻ việc làm ngay trong khung chat. Đặc biệt, để tối ưu tốc độ, hệ thống sử dụng kỹ thuật Hedging phát song song request sau 4 giây, kết hợp Anthropic Prompt Caching giúp tiết kiệm 75% chi phí token. Khi người dùng cần hỗ trợ chuyên sâu, tính năng Human Handoff sẽ chuyển toàn bộ lịch sử trò chuyện sang bàn làm việc của Admin qua Socket.IO.", title="LỜI THOẠI THUYẾT MINH MÀN 4.2")

    doc.add_page_break()

    # -------------------------------------------------------------------------
    # HỒI 5: QUẢN TRỊ ADMIN
    # -------------------------------------------------------------------------
    add_custom_heading(doc, "HỒI 5: TRUNG TÂM ĐIỀU HÀNH & BÁO CÁO TOÀN DIỆN (ADMIN CONSOLE)", level=2)

    # Màn 5.1: Admin Dashboard & Recharts
    add_custom_heading(doc, "Màn 5.1: Bảng Điều Khiển Quản Trị & Biểu Đồ Recharts (/admin/)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Đăng nhập tài khoản Admin (0795095049 / 123456) tại Cửa sổ Incognito 2.")
    add_bullet_p(doc, "Màn hình Dashboard hiện ra: Khối 'VIỆC CẦN XỬ LÝ' (Action Items) liệt kê tin chờ duyệt, công ty chờ duyệt, ticket hỗ trợ.")
    add_bullet_p(doc, "Chọn bộ lọc kỳ báo cáo: Các biểu đồ sóng Recharts (TrendChart) và chỉ số KPI tự động co giãn cập nhật mượt mà.")

    # Màn 5.2: Bàn hỗ trợ Support Inbox
    add_custom_heading(doc, "Màn 5.2: Bàn Tiếp Nhận Hỗ Trợ Khách Hàng (Support Inbox - /admin/support)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Vào menu 'Yêu cầu hỗ trợ' (/admin/support): Thấy ticket của ứng viên Nguyễn Minh An chuyển từ Chatbot ở Hồi 4.")
    add_bullet_p(doc, "Xem trước toàn bộ lịch sử trò chuyện giữa ứng viên và Chatbot AI.")
    add_bullet_p(doc, "Bấm nút 'Tiếp nhận' (Claim): Ticket chuyển sang 'Đang xử lý' và kết nối vào khung chat trực tiếp 1-1.")
    add_bullet_p(doc, "Hỗ trợ xong -> Bấm 'Đánh dấu đã xử lý' (Resolve) để hoàn tất ticket.")

    # Màn 5.3: Báo cáo doanh thu & Kiểm duyệt
    add_custom_heading(doc, "Màn 5.3: Kiểm Duyệt Tin Tuyển Dụng & Báo Cáo Doanh Thu Theo Năm (Chart.js)", level=3)
    add_body_p(doc, "1. Thao tác trên giao diện:", bold_prefix="👉 ")
    add_bullet_p(doc, "Vào 'Tin tuyển dụng' (/admin/list-post-admin/): Xem tin của Sao Khuê Digital, đọc kết quả AI Moderation (Risk: LOW) -> Bấm 'Duyệt'.")
    add_bullet_p(doc, "Vào 'Doanh thu theo năm' (/admin/sum-by-year-post/ và /admin/sum-by-year-cv/): Xem biểu đồ cột Chart.js thể hiện doanh thu cổng PayPal theo từng tháng trong năm.")
    add_bullet_p(doc, "Bấm nút 'Xuất Excel': Toàn bộ dữ liệu doanh thu được trích xuất thành file Excel .xlsx tải về máy tính.")

    doc.add_page_break()

    # =========================================================================
    # PHẦN IV: KINH NGHIỆM THUYẾT TRÌNH & BỘ CÂU HỎI PHẢN BIỆN (Q&A)
    # =========================================================================
    add_custom_heading(doc, "PHẦN IV: KINH NGHIỆM THUYẾT TRÌNH & BỘ CÂU HỎI PHẢN BIỆN (Q&A)", level=1)
    
    add_custom_heading(doc, "4.1 Khung Phân Bổ Thời Gian Demo Khuyến Nghị", level=2)
    time_headers = ["Thời Lượng", "Phân Bổ Từng Hồi Cụ Thể", "Chiến Lược Ghi Điểm Tuyệt Đối"]
    time_data = [
        ["Phiên bản 15 Phút\n(Báo Cáo Nhanh)", "• 2 phút: Giới thiệu kiến trúc\n• 5 phút: Ứng viên (Tìm việc, Tạo CV AI)\n• 5 phút: Doanh nghiệp (Kanban, Bulk AI Screening, Gửi Offer)\n• 2 phút: Chatbot AI Function Calling\n• 1 phút: Admin Dashboard & Kết luận", "Tập trung vào 3 điểm nhấn WOW: Tạo CV AI, Bulk AI Screening 50 hồ sơ trên Kanban và Chatbot tìm việc thời gian thực."],
        ["Phiên bản 30 Phút\n(Bảo Vệ Đề Án Chuẩn)", "• 4 phút: Giới thiệu bài toán & kiến trúc Microservices\n• 8 phút: Hồi 1 (Hành trình Ứng viên từ A-Z)\n• 9 phút: Hồi 2 & Hồi 3 (Doanh nghiệp, PayPal, Kanban, Email Nodemailer)\n• 5 phút: Hồi 4 (Chat realtime Socket.IO & Chatbot RAG)\n• 4 phút: Hồi 5 (Admin Console, Duyệt tin, Báo cáo Chart.js)", "Mở 2 cửa sổ song song để minh họa tương tác 2 chiều mượt mà. Chiếu sơ đồ hoạt động khi giải thích các khối kỹ thuật."],
        ["Phiên bản 45 Phút\n(Demo & Phản Biện Sâu)", "• 5 phút: Báo cáo Slide tổng quan\n• 25 phút: Demo chi tiết đầy đủ 5 Hồi kịch bản\n• 15 phút: Trả lời câu hỏi phản biện của Hội đồng", "Thao tác từng tính năng tỉ mỉ, sẵn sàng mở Docker logs, RabbitMQ UI hoặc Database để chứng minh kiến trúc thực sự hoạt động."]
    ]
    create_table(doc, time_headers, time_data, [1.4, 2.5, 2.8])

    add_custom_heading(doc, "4.2 Top 8 Câu Hỏi Phản Biện Chuyên Sâu Của Hội Đồng & Đáp Án Mẫu", level=2)
    qa_list = [
        ("Câu hỏi 1: Hệ thống sử dụng cả MySQL, PostgreSQL và MongoDB. Tại sao lại dùng nhiều loại CSDL như vậy và làm sao đảm bảo tính toàn vẹn dữ liệu?",
         "Đáp án chuyên sâu: Đây là kiến trúc Polyglot Persistence đặc trưng của Microservices. Mỗi dịch vụ chọn CSDL tối ưu nhất cho nghiệp vụ của nó: MySQL phù hợp cho Core Backend (giao dịch tài chính ACID, người dùng); PostgreSQL với JSONB mạnh mẽ tối ưu cho Application Service (lưu trữ Kanban, lịch sử timeline và snapshot quyết định); MongoDB lý tưởng cho Identity Service và AI Worker (lưu trữ hồ sơ linh hoạt không cố định schema và ledger chống chạy trùng tác vụ); Elasticsearch tối ưu cho tìm kiếm toàn văn. Để giải quyết tính toàn vẹn, chúng tôi áp dụng Transactional Outbox Pattern kết hợp RabbitMQ: Mọi thay đổi dữ liệu và sự kiện đều được ghi vào DB trong cùng 1 transaction cục bộ, sau đó Outbox Relay phát sự kiện qua RabbitMQ đảm bảo tính nhất quán cuối cùng (Eventual Consistency) mà không bao giờ mất sự kiện."),
        
        ("Câu hỏi 2: AI có bịa đặt kinh nghiệm (Hallucination) hoặc có định kiến (Bias) khi sàng lọc hồ sơ ứng viên không?",
         "Đáp án chuyên sâu: JobFind giải quyết triệt để 2 vấn đề này bằng thiết kế hệ thống nghiêm ngặt: (1) Về chống bịa đặt: System Prompt của AI Worker quy định nguyên tắc 'Chỉ sử dụng sự thật có trong CV'; mô hình Claude được ép trả về cấu trúc JSON Schema định sẵn; đồng thời giao diện hiển thị rõ trích dẫn bằng chứng (evidence) lấy từ trang nào của PDF. (2) Về chống định kiến: Khi gửi dữ liệu cho AI Worker chấm điểm, hệ thống tự động ẩn hoặc yêu cầu mô hình bỏ qua hoàn toàn các yếu tố nhạy cảm gồm tuổi tác, giới tính, tình trạng hôn nhân, tôn giáo và địa chỉ quê quán; chỉ chấm điểm dựa trên năng lực chuyên môn và kỹ năng."),

        ("Câu hỏi 3: Chi phí gọi API Claude cho hàng ngàn ứng viên có quá đắt đỏ và làm nghẽn hệ thống không?",
         "Đáp án chuyên sâu: Chúng tôi áp dụng 3 giải pháp tối ưu: Thứ nhất, kiến trúc bất đồng bộ qua AI Worker và hàng đợi RabbitMQ giúp tách rời hoàn toàn API Gateway, tránh nghẽn luồng HTTP. Thứ hai, áp dụng kỹ thuật Prompt Caching của Anthropic giúp tái sử dụng ngữ cảnh JD và quy tắc chấm, giảm tới 75% chi phí token và giảm 50% độ trễ. Thứ ba, đối với Chatbot hỗ trợ, chúng tôi áp dụng cơ chế Answer Cache (TTL 10 phút) và Hedging Request, giúp tốc độ phản hồi cực nhanh mà không lãng phí token."),

        ("Câu hỏi 4: Khi mạng chập chờn hoặc người dùng bấm nút AI nhiều lần, hệ thống xử lý trùng lặp thế nào?",
         "Đáp án chuyên sâu: JobFind áp dụng cơ chế Idempotency-Key trên toàn bộ các route ghi và route AI. Mỗi yêu cầu từ giao diện đều gắn một UUID duy nhất. Nếu người dùng bấm gửi lại do mạng chậm, Gateway và Service phát hiện cùng Idempotency-Key sẽ trả về ngay kết quả hoặc trạng thái đang xử lý mà không trừ thêm quota hay gọi AI lần thứ hai."),

        ("Câu hỏi 5: Tại sao trong bảng Kanban, khi gửi lời mời phỏng vấn hoặc thư nhận việc, hệ thống lại cho xem trước email?",
         "Đáp án chuyên sâu: Đây là nguyên tắc cốt lõi 'Human-in-the-loop' trong thiết kế UI/UX của JobFind. Mặc dù AI tự động soạn thảo lời nhắn dựa trên hồ sơ, nhưng con người luôn phải là người kiểm soát nội dung cuối cùng trước khi gửi cho ứng viên. Điều này ngăn chặn tuyệt đối các sai sót không đáng có và thể hiện sự tôn trọng, chuyên nghiệp của doanh nghiệp đối với người tìm việc."),

        ("Câu hỏi 6: Hệ thống tìm kiếm của JobFind có điểm gì khác biệt so với tìm kiếm SQL thông thường?",
         "Đáp án chuyên sâu: Thay vì dùng câu lệnh LIKE trong SQL gây khóa bảng và hiệu năng kém khi dữ liệu lớn, JobFind sử dụng Elasticsearch 8.15 với bộ phân tích tiếng Việt (Vietnamese Analyzer). Hệ thống hỗ trợ tìm kiếm toàn văn (full-text search), gợi ý tự động (auto-suggest) khi gõ, tìm kiếm mờ (fuzzy matching) chấp nhận gõ sai chính tả và lọc kết hợp đa chiều (faceted filtering) với thời gian phản hồi trung bình chỉ 30 - 80ms trên hàng trăm ngàn bản ghi."),

        ("Câu hỏi 7: Chatbot AI hoạt động thế nào để lấy được thông tin việc làm thời gian thực?",
         "Đáp án chuyên sâu: Chatbot được xây dựng bằng Vercel AI SDK tích hợp cơ chế Function Calling (Tools). Khi người dùng hỏi tìm việc, mô hình AI tự động nhận diện ý định và kích hoạt công cụ 'search_jobs', truyền các tham số lọc vào Search Service qua API Gateway. Sau khi có kết quả, chatbot render trực tiếp thẻ việc làm dưới dạng Carousel tương tác thay vì chỉ trả về văn bản đơn thuần."),

        ("Câu hỏi 8: Quá trình thanh toán qua PayPal được bảo mật và cộng quyền lợi như thế nào?",
         "Đáp án chuyên sâu: Chúng tôi không bao giờ tin tưởng phản hồi trực tiếp từ phía client trình duyệt. Khi người dùng hoàn tất thanh toán trên PayPal, PayPal sẽ chuyển hướng về máy chủ backend. Backend thực hiện capture giao dịch trực tiếp từ máy chủ PayPal, kiểm tra số tiền và trạng thái giao dịch 'COMPLETED' rồi mới cộng quota nguyên tử (atomic increment) vào cơ sở dữ liệu.")
    ]

    for q, a in qa_list:
        add_body_p(doc, q, bold_prefix="❓ ", space_after=2)
        add_body_p(doc, a, bold_prefix="👉 ", space_after=8)

    add_custom_heading(doc, "4.3 Bảng Đường Dẫn Nhanh (URL Cheat Sheet)", level=2)
    url_headers = ["Khu Vực Nghiệp Vụ", "Đường Dẫn URL (Localhost:3000)", "Mục Đích Thao Tác Khi Demo"]
    url_data = [
        ["Trang chủ sàn", "http://localhost:3000/", "Trang chủ, banner việc làm mới, danh mục ngành nghề."],
        ["Tìm kiếm việc làm", "http://localhost:3000/job", "Elasticsearch full-text search, lọc 34 tỉnh thành, tin verified."],
        ["Không gian CV & AI", "http://localhost:3000/candidate/ai-cv", "Tạo CV AI, đọc PDF CV, chấm độ phù hợp, soạn cover letter."],
        ["Công việc đã nộp", "http://localhost:3000/candidate/cv-post", "Theo dõi tiến trình hồ sơ thời gian thực của ứng viên."],
        ["Lịch phỏng vấn ứng viên", "http://localhost:3000/candidate/interviews", "Xem lịch hẹn phỏng vấn, liên kết Google Calendar."],
        ["Pipeline tuyển dụng", "http://localhost:3000/admin/pipeline/", "Kanban 6 bước, AI sàng lọc hàng loạt, phễu tuyển dụng."],
        ["Lịch phỏng vấn công ty", "http://localhost:3000/admin/interviews", "Calendar lịch phỏng vấn doanh nghiệp tập trung."],
        ["Tìm kiếm ứng viên", "http://localhost:3000/admin/list-candiate/", "Lọc ứng viên theo tiêu chuẩn tin đăng, AI đối chiếu CV."],
        ["Đăng tin tuyển dụng", "http://localhost:3000/admin/add-post/", "Tạo tin tuyển dụng mới với AI Content Moderation."],
        ["Mua gói đăng tin", "http://localhost:3000/admin/buy-post/", "Thanh toán trực tuyến qua cổng PayPal Sandbox."],
        ["Chat realtime 1-1", "http://localhost:3000/chat", "Socket.IO chat, đính kèm CV/Job, AI gợi ý & viết lại tin."],
        ["Bàn hỗ trợ khách hàng", "http://localhost:3000/admin/support", "Tiếp nhận ticket chuyển giao từ Chatbot, xử lý hỗ trợ."],
        ["Admin Dashboard", "http://localhost:3000/admin/", "Tổng quan hệ thống, việc cần xử lý, biểu đồ Recharts KPI."],
        ["Báo cáo phân tích", "http://localhost:3000/admin/reports/", "Báo cáo tăng trưởng, phân bố ngành nghề, phễu toàn sàn."],
        ["Doanh thu theo năm", "http://localhost:3000/admin/sum-by-year-post/", "Biểu đồ cột Chart.js thống kê doanh thu bán gói tuyển dụng."]
    ]
    create_table(doc, url_headers, url_data, [1.6, 2.5, 2.6])

    doc.add_paragraph().paragraph_format.space_after = Pt(20)
    p_end = doc.add_paragraph()
    p_end.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_end = p_end.add_run("— HẾT TOÀN VĂN BÁO CÁO KIẾN TRÚC & KỊCH BẢN DEMO TOÀN DIỆN JOBFIND —\nChúc bạn có một buổi thuyết trình xuất sắc và bảo vệ đồ án thành công rực rỡ!")
    r_end.font.name = "Segoe UI"
    r_end.font.size = Pt(11)
    r_end.font.bold = True
    r_end.font.color.rgb = RGBColor(15, 118, 110)

    # Lưu file Word vào nhiều đường dẫn để tránh xung đột file đang mở
    target_files = [
        r"d:\job_find\Bao_Cao_Thuyet_Trinh_Va_Kich_Ban_Demo_JobFind.docx",
        r"d:\job_find\Kich_Ban_Demo_Chi_Tiet_JobFind.docx",
        r"d:\job_find\Kich_Ban_Demo_Chi_Tiet_JobFind_Co_Code_Va_So_Do.docx",
        r"d:\job_find\docs\Kich_Ban_Demo_Chi_Tiet_JobFind.docx"
    ]

    saved_paths = []
    for path in target_files:
        try:
            doc.save(path)
            saved_paths.append(path)
            print("Saved successfully to:", path)
        except Exception as e:
            print("Cannot save to", path, "Reason:", e)

    return saved_paths

if __name__ == "__main__":
    build_ultimate_demo_document()
