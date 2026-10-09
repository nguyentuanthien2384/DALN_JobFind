# Cấu hình và chạy thử chatbot JobFind

Chatbot hiện chạy ở `support-chat-service`, đi qua Gateway `http://localhost:4000`; giao diện local do `npm start` mở tại `http://localhost:3000`. API key chỉ nằm ở máy chủ. Đợt kiểm thử với key thật ngày 24/09/2026 được ghi tại [biên bản demo](docs/api-key-demo-validation.md).

## Cấu hình

Trong `microservices/.env`, đặt `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` nếu dùng gateway tương thích Anthropic, `SUPPORT_CLAUDE_MODEL` cho chatbot và `CLAUDE_MODEL` cho AI Worker. Dùng tên model do nhà cung cấp của bạn hỗ trợ. Các giá trị mặc định trong `.env.example` dành cho cấu hình gateway của dự án; chúng không chứng minh model cùng tên có trên API Anthropic trực tiếp. Không đặt key vào `frontend/.env`, Git hoặc ảnh demo.

Hai dịch vụ sử dụng chung key nhưng có hai nhiệm vụ: chatbot hướng dẫn/tìm việc bằng công cụ chỉ đọc; AI Worker đọc PDF, đánh giá CV, soạn thư và kiểm duyệt tin. Khóa AI không thay thế OAuth Client ID/Secret cho Google, GitHub hoặc Auth0.

Sau khi thay key/model, chạy `npm run dev:stop`, chờ trạng thái dừng trong `npm run dev:status`, rồi `npm start`. Trình chạy sao lưu dữ liệu, dựng image và khởi động các dịch vụ. `npm run dev:status` kiểm tra cấu hình Claude trong container có khớp file hiện tại hay không; không in key.

Chatbot có chế độ hướng dẫn dự phòng khi provider lỗi/chưa cấu hình. Một câu trả lời dự phòng thành công không được tính là gọi AI thật thành công. Khi dùng gateway chỉ hỗ trợ văn bản, Worker trích chữ PDF trước khi gửi; CV scan không có lớp chữ cần OCR/chuyển sang PDF có văn bản trước.

## Kiểm tra

- `npm --prefix microservices run test:support`: kiểm thử dịch vụ, quyền và lưu hội thoại, không gọi model thật.
- `npm --prefix microservices run test:support:live`: đánh giá qua Gateway với AI thật và dữ liệu công khai đang có; tệp kết quả `.local/support-service-evaluation.json` ghi cả thời gian nhận chữ đầu tiên, công cụ, nguồn và trạng thái dọn hội thoại thử.
- `npm --prefix microservices run test:support:live:fixtures`: bốn ca AI thật với dữ liệu công cụ tổng hợp: có kết quả, hỏi tiếp, mô tả chứa chỉ dẫn độc hại, bộ lọc chưa hỗ trợ. Không tạo tin trong database. Kết quả `.local/support-fixture-evaluation.json`.
- `npm --prefix microservices run test:support:live:browser`: một câu hỏi thật bằng Chromium; kiểm tra lưu lịch sử, mở lại sau reload, giao diện điện thoại và xóa hội thoại thử. Kết quả `.local/support-live-browser/`.

Các lệnh có `live` sử dụng hạn mức API. Có thể chọn một phần evaluator bằng biến `SUPPORT_EVAL_CASES`, ví dụ `jobs,follow-up,unsupported-filters`. Khi không có tin công khai còn hạn, ca hỏi tiếp được ghi `skipped_no_live_job`; ca fixture kiểm tra trường hợp dương tính, không được dùng để khẳng định dữ liệu thật có tin phù hợp.

Đọc các câu trả lời cùng dữ liệu/công cụ để đánh giá nội dung; `automatic_checks_passed_review_required` chỉ xác nhận các điều kiện máy kiểm tra được. Không coi số unit test là điểm chất lượng AI.

## Thử trên giao diện

Mở nút **Hỗ trợ**, hỏi cách tạo CV, tìm việc hoặc quên mật khẩu. Sau khi trả lời, mở **Lịch sử trò chuyện** để xem lại hội thoại đã lưu. Các thao tác cá nhân yêu cầu đăng nhập; dữ liệu tra cứu riêng tư không được gửi cho model. Chuyển cho nhân viên cần người dùng đồng ý chia sẻ và bấm nút tương ứng.

Nếu hỏi việc đang tuyển mà không có kết quả, kiểm tra trạng thái duyệt, công ty và hạn tuyển. Không sửa hàng loạt hạn tuyển chỉ để ca demo có kết quả. Email/OTP thật và SSO cần cấu hình riêng; trình chạy local mặc định tắt gửi email.

## Trải nghiệm kiểu chatbot mạng xã hội

- **Tìm việc thật**: công cụ `search_jobs` tìm cả tin nội bộ đang mở lẫn danh mục tin có nguồn đối chiếu đang hiển thị ở `/job` ([verified-jobs](docs/verified-jobs.md)); tin nội bộ đứng trước. Thẻ tin dạng băng chuyền có logo, hạn nộp và nhãn “Tin nguồn chính thức”; liên kết luôn sinh từ mã tin đã kiểm tra (`/detail-job/:id` hoặc `/external-job/external-…`). Không có danh mục thì chỉ còn tin nội bộ.
- **Thống kê**: `job_market_overview` chỉ trả số đếm (tỉnh/thành, doanh nghiệp, ngành nghề) cho câu hỏi kiểu “công ty nào tuyển nhiều nhất”.
- **Gợi ý trả lời nhanh**: model kết thúc câu trả lời bằng `[[GOI_Y]] câu 1 | câu 2 | câu 3`; dịch vụ ẩn phần này khỏi nội dung (kể cả khi đang stream), lưu thành `suggestions` và hiện thành nút dưới câu trả lời mới nhất. Model bỏ sót thì dùng gợi ý dự phòng theo công cụ/chủ đề.
- **Đánh giá 👍/👎**: `POST /api/support/conversations/:id/messages/:messageId/feedback` với `{ "value": "up" | "down" | null }`; chỉ chủ hội thoại, chỉ câu trả lời đã hoàn tất, không đổi phiên bản hội thoại. Nhật ký dịch vụ ghi sự kiện `support.feedback`.
- **Tốc độ** (đo ngày 02/10/2026): Gateway chuyển ngẫu nhiên mỗi yêu cầu tới máy chủ stream sau 2–4 giây hoặc máy chủ trả cả câu sau 10–16 giây. Nếu sau `SUPPORT_HEDGE_MS` (mặc định 4000) chưa có phản hồi, dịch vụ gửi thêm một yêu cầu giống hệt và dùng yêu cầu đến trước, huỷ yêu cầu còn lại. Cùng model, cùng prompt nên độ chính xác không đổi; đổi lại có thể tốn thêm token của một yêu cầu. Trên 16 câu hỏi thật, chữ đầu tiên đến sau trung bình 9,4 giây thay vì 17,5 giây, không còn ca hết thời gian 45 giây. Phần quy tắc và danh sách công cụ được đánh dấu prompt cache. Câu hỏi mở đầu giống hệt trong `SUPPORT_ANSWER_CACHE_TTL_MS` (mặc định 10 phút) được trả lại ngay từ bộ nhớ; “Tạo lại” và câu đã sửa luôn hỏi AI mới. Trong lúc chờ, khung chat hiện đang làm gì (“Đang tìm việc phù hợp…”) và thẻ tin hiện ngay sau khi tra cứu xong. Nhật ký ghi `support.hedge`, `support.answer_cache_hit` và `durationMs`, `cacheReadTokens` của mỗi câu trả lời.
- **Giao diện**: lời chào chủ động sau 6 giây trên trang chủ/việc làm/công ty (một lần mỗi phiên trình duyệt), huy hiệu tin chưa đọc khi câu trả lời đến lúc khung đang đóng, lời chào theo tên, menu lối tắt cạnh ô nhập, mốc giờ tin nhắn và câu hỏi nhanh về tin đang xem trên trang chi tiết.
