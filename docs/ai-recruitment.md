# AI trong quy trình tuyển dụng

Phần này bổ sung AI vào các bước ứng viên và nhà tuyển dụng dùng hằng ngày: nộp CV, lọc CV, gửi email kết quả và nhắn tin. Mọi kết quả AI chỉ là **bản nháp hoặc thông tin tham khảo**: người dùng xem, sửa rồi tự bấm gửi. AI không tự gửi email, không tự gửi tin nhắn và không tự chuyển bước hay loại ứng viên.

Các chức năng dùng chung AI Worker, hàng đợi RabbitMQ và cấu hình `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` đã có (xem [ai-cv.md](ai-cv.md)). Mỗi lần bấm nút AI là một lượt gọi mô hình; gửi lại do lỗi mạng dùng cùng mã yêu cầu nên không bị tính hai lần.

## Ứng viên: nộp CV

Trong cửa sổ **Nộp CV** (trang chi tiết việc làm), khi `REACT_APP_CANDIDATE_AI_ENABLED=true`:

- **Viết lời giới thiệu bằng AI**: AI đọc CV đang chọn (tệp từ máy, CV online hoặc CV đã chuẩn bị) và tin tuyển dụng, đưa ra 2 phương án tối đa 255 ký tự. Bấm **Dùng lời giới thiệu này** để điền vào ô, có thể sửa tiếp.
- **Kiểm tra độ phù hợp**: điểm 0–100, điểm khớp và kỹ năng chưa thấy trong CV trước khi gửi.

AI chỉ dùng thông tin có trong CV, không thêm kinh nghiệm hay bằng cấp.

## Nhà tuyển dụng: lọc CV trên bảng Kanban

Mở **Quản lý hồ sơ ứng tuyển** (Kanban), tài khoản COMPANY/EMPLOYER:

- **AI sàng lọc hồ sơ**: chọn một tin, bấm nút để AI chấm các hồ sơ chưa có kết quả (bỏ qua hồ sơ đã từ chối/đã nhận việc; tối đa 50 hồ sơ mỗi lần, có hộp xác nhận số lượt gọi AI). AI đọc file CV ứng viên đã nộp ngay tại máy chủ.
- Điểm hiện trên từng thẻ (`AI 84`) và tự cập nhật khi có kết quả. Bật **Sắp xếp theo điểm AI** để xếp hồ sơ điểm cao lên đầu mỗi cột.
- Trong chi tiết hồ sơ, mục **Đánh giá CV so với tin tuyển dụng** hiện điểm, nhận xét, kỹ năng phù hợp/còn thiếu, điểm mạnh, nội dung cần trao đổi; có thể chấm một hồ sơ hoặc chấm lại.

Quyền giống trình xem CV hiện có: chỉ CV nộp vào tin của chính công ty (đang hoạt động, đã duyệt). Kết quả lưu theo công ty, mở lại trang vẫn thấy. AI bỏ qua tuổi, giới tính và đặc điểm cá nhân nhạy cảm khi chấm.

## Nhà tuyển dụng: email phỏng vấn, trúng tuyển, từ chối

Trong chi tiết hồ sơ, phần **Gửi email cho ứng viên**:

1. (Không bắt buộc) gõ vài ý chính vào ô lời nhắn, ví dụ "ấn tượng phần dự án thanh toán, mong gặp lại".
2. Chọn loại thư (tự theo biểu mẫu đang mở: mời phỏng vấn, trúng tuyển; mặc định là không trúng tuyển) và bấm **AI soạn lời nhắn**.
3. Xem đoạn gợi ý, bấm **Dùng nội dung này** để đưa vào ô lời nhắn, sửa nếu cần rồi gửi như bình thường.

Email đã có sẵn lời chào, ngày giờ, địa điểm, lương và chữ ký, nên AI chỉ viết đoạn lời nhắn cá nhân 2–5 câu, không tự đặt ra lịch, lương hay cam kết. Thư từ chối được viết lịch sự, không nêu lý do nhạy cảm.

## Chat ứng viên ↔ nhà tuyển dụng

Trong khung soạn tin của cuộc trò chuyện giữa ứng viên và nhà tuyển dụng:

- **Gợi ý trả lời**: khi tin mới nhất là của đối phương, AI đưa 3 câu trả lời khác nhau. Bấm một gợi ý để điền vào ô soạn tin.
- **Viết lại lịch sự hơn**: AI sửa tin đang soạn cho rõ ràng, đúng chính tả, giữ nguyên ý và thông tin.

Tin nhắn chỉ được gửi khi người dùng bấm **Gửi**. Khi bấm nút AI, tối đa 12 tin văn bản gần nhất được gửi tới dịch vụ AI; nội dung hội thoại không được lưu trong bảng tác vụ AI. Cuộc trò chuyện hỗ trợ với quản trị viên không có các nút này.

## API

| API | Quyền | Mô tả |
|---|---|---|
| `POST /api/ai/application-intro` | Ứng viên | `{ jobId, fileBase64, language? }` → lời giới thiệu (≤255 ký tự) |
| `POST /api/ai/candidate-message` | COMPANY/EMPLOYER | `{ jobId, emailType: interview\|offer\|rejection, candidateName?, recruiterNotes?, interviewed?, language? }` |
| `POST /api/ai/chat-assist` | Ứng viên, COMPANY/EMPLOYER | `{ mode: "suggest", messages }` hoặc `{ mode: "polish", draft, messages? }`; `messages` tối đa 20 mục `{ from: me\|partner, text }` |
| `POST /api/ai/screen-application` | COMPANY/EMPLOYER | `{ cvId }` — CV đã nộp vào tin của công ty; tạo tác vụ `match_cv` |
| `GET /api/ai/jobs/:id/screenings` | COMPANY/EMPLOYER | Kết quả AI mới nhất theo từng CV đã nộp của tin |

Các API ghi trả `202` cùng `taskId`; đọc kết quả bằng `GET /api/ai/tasks/:taskId` (loại `write_assist` trả `{ kind, suggestions[] }`, loại `match_cv` trả điểm và nhận xét). Hỗ trợ header `Idempotency-Key` như các API AI khác.

## Triển khai

Thay đổi nằm ở `ai-worker`, `job-core-service`, `api-gateway` (đọc danh sách API từ hợp đồng dùng chung) và frontend. Sau khi kéo mã, chạy lại `npm start` để dựng lại các image; bảng `ai_application_screenings` được tạo tự động khi job-core-service khởi động.
