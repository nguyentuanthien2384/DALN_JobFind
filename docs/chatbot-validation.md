# Kiểm thử chatbot JobFind — 19/09/2026

> Báo cáo dưới đây là kết quả ngày 19/09. Các cập nhật về lưu lịch sử trên máy chủ, phiên khách và hỏi thử trên ứng dụng ngày 21/09 nằm trong [chatbot-widget-history.md](chatbot-widget-history.md).

## Kết luận

Các luồng giao diện và xử lý kỹ thuật đã qua kiểm thử. **Chưa có đủ bằng chứng để xác nhận chất lượng trả lời AI hoặc sẵn sàng vận hành thực tế.** Không dùng số lượng unit test làm điểm chất lượng câu trả lời.

Ở thời điểm kiểm tra, chưa có `GEMINI_API_KEY`, backend cổng 5000 và Gateway cổng 4000 không truy cập được. MySQL kết nối được: 41 tin, 30 tin đã duyệt, 0 tin đã duyệt còn hạn; công cụ công khai trả 0 tin. Không thay đổi hạn tuyển hay thêm dữ liệu giả vào database.

## Bằng chứng đã chạy

- Toàn bộ backend: 53 bộ, 888 kiểm thử đạt. Đây là kiểm thử của cả backend, không phải 888 câu hỏi cho AI.
- Frontend liên quan đến chatbot và tích hợp App: 4 bộ, 47 kiểm thử đạt.
- Build production của frontend: thành công sau các bản sửa.
- Gateway/HTTP contract/proxy streaming: 3 bộ, 233 kiểm thử đạt. Dịch vụ phía sau được giả lập trong kiểm thử, không phải triển khai thật đang chạy.
- Chromium thật: gửi, streaming, Markdown, thẻ việc làm, sửa câu hỏi, tạo lại, dừng, thử lại, giữ câu trả lời đang dở khi lỗi, khôi phục lịch sử và bố cục điện thoại đều đạt với SSE giả lập.
- Bổ sung kiểm thử 8 yêu cầu đang chạy: yêu cầu thứ 9 bị giới hạn, sau khi lỗi các slot được trả lại.
- Chạy lệnh đánh giá AI thật: bị chặn do thiếu khóa; **0 lượt gọi Gemini thật**, chưa có câu trả lời thật để chấm. Trạng thái được lưu ở `.local/support-chat-evaluation.json`.

## Vấn đề đã tái hiện và sửa

1. **Nhầm câu trả lời dở thành hoàn tất.** Các ca EOF thiếu `finishReason`, `MAX_TOKENS`, `SAFETY`, `MALFORMED_FUNCTION_CALL` trước đây có thể thành công dù nội dung chưa hoàn chỉnh. Đã yêu cầu `STOP` cho từng lượt model, kể cả lượt sau khi gọi công cụ; lượt công cụ bị ngắt không được thực thi. Các ca tái hiện ban đầu thất bại và đã đạt sau sửa.
2. **Mất thông tin chi tiết việc làm.** Chỉ 400 ký tự mô tả được gửi cho AI; test với phần yêu cầu nằm phía sau đoạn giới thiệu đã chứng minh dữ liệu bị mất. Đã tăng giới hạn lên 6.000 ký tự và thêm cờ `descriptionTruncated`, đồng thời nhắc model không suy diễn phần thiếu.
3. **Mất nội dung đang đọc khi lỗi mạng.** Giao diện trước đây xóa toàn bộ câu trả lời đang dở. Nay giữ lại, ghi rõ bị gián đoạn, cho thử lại và không đưa nội dung lỗi vào ngữ cảnh tiếp theo; trạng thái vẫn đúng sau tải lại.

Tham chiếu giao thức: [Google Gemini GenerateContent / FinishReason](https://ai.google.dev/api/generate-content#FinishReason). Kiểm thử giả lập xác minh ứng dụng xử lý giao thức, không xác minh chất lượng của Gemini.

## Những phần chưa được chứng minh

- Tính đúng sự thật, diễn đạt tiếng Việt, hỏi làm rõ, nhớ ngữ cảnh, không bịa việc/lương, phản ứng với chỉ dẫn độc hại: cần đọc câu trả lời từ model thật. Prompt hiện có các hướng dẫn này; chưa thể coi đó là bằng chứng model luôn tuân thủ.
- Độ trễ lần đầu, p95, chi phí/token, tỷ lệ lỗi/quota khi nhiều người dùng: chưa đo với Gemini và hạ tầng triển khai thật. Test giới hạn đồng thời không phải kiểm thử tải production.
- Tìm kiếm chỉ hỗ trợ tên việc/địa điểm. Yêu cầu lương số tiền, remote, kinh nghiệm, tìm kiếm ngữ nghĩa và cá nhân hóa chưa có bộ lọc tương ứng. Đã bổ sung hướng dẫn model nói rõ giới hạn, nhưng cần đánh giá thực tế.
- Lịch sử chỉ lưu theo tab/phiên; chưa có đồng bộ đa thiết bị. Không có tải CV trực tiếp trong chat hay tự nộp đơn.

## Cách hoàn tất nghiệm thu

1. Cấu hình khóa/model Gemini hợp lệ trong `backend/.env`, khởi động backend và Gateway/Redis theo README. Không gửi khóa trong chat hoặc đưa vào frontend.
2. Chuẩn bị các tin tuyển dụng thử nghiệm hợp lệ trên môi trường test: có kết quả, không có kết quả, hết hạn, chờ duyệt và mô tả dài. Không sửa dữ liệu production để ép ca kiểm thử thành công.
3. Chạy `npm --prefix backend run test:support-chat:live`. Bộ 9 tình huống có chào hỏi, ứng tuyển, tìm việc, hỏi tiếp theo ID, không có kết quả, làm rõ nhu cầu, lọc phức tạp, yêu cầu thông tin riêng tư và yêu cầu bịa dữ liệu. Hỏi tiếp chỉ chạy khi tìm được tin thật. Mỗi câu trả lời có tiêu chí chấm và thời gian; người đọc phải đối chiếu với dữ liệu/giao diện thật. Kiểm tra tự động không thay thế bước này.
4. Sau khi đạt bộ câu hỏi nhỏ, mở rộng tập đánh giá theo câu hỏi thật của người dùng và đo tải/độ trễ qua Gateway. Chỉ chốt vận hành sau khi các ca quan trọng không bịa kết quả, không vượt quyền và báo lỗi rõ ràng.

Hướng dẫn cấu hình và lệnh kiểm thử: [CHATBOT_SETUP.md](../CHATBOT_SETUP.md).
