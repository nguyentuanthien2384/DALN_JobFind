# Đối chiếu chatbot với tài liệu nghiên cứu

Ngày triển khai: 19/09/2026. Nguồn: “Nghiên cứu lựa chọn chatbot hỗ trợ cho dự án JobFind.pdf”, 34 trang, do người dùng cung cấp. Chọn phương án A; Chatwoot, Dify, Flowise, Botpress và Rasa là các phương án thay thế, không cài đồng thời.

## Các luồng đã phát triển

- **Giao diện**: assistant-ui và React 18; streaming, sửa/tạo lại, dừng, Markdown an toàn, thẻ việc làm, nguồn, lịch sử, xuất/xóa và màn hình điện thoại.
- **Dịch vụ riêng**: support-chat-service, Node >=22, Vercel AI SDK 7, OpenAI/Google adapters. Gateway chuyển SSE không đệm; thay header giả mạo, bỏ JWT/cookie trước khi gửi nội bộ. Auth lỗi không tự hạ thành khách.
- **Lưu trữ**: MySQL theo chủ sở hữu, phiên bản và lease chống ghi đè. Tin nhắn dùng JSON có giới hạn trong bản ghi hội thoại để sửa cả lượt nguyên tử; không sao chép nguyên ví dụ ba bảng trong PDF. Không lấy userId/companyId từ model.
- **RAG công khai**: chín bài đã duyệt, Elasticsearch support_kb_v1, top 3 nguồn có trang đọc. Khi search lỗi dùng corpus đóng gói. Chỉ nhận ID nguồn khớp corpus, không dùng URL hoặc nội dung tùy ý từ index.
- **Tra cứu riêng tư**: độ đầy đủ hồ sơ, đơn ứng tuyển/trạng thái, việc đã lưu, tin công ty và hạn mức gói. Vai trò được kiểm tra; dữ liệu công ty yêu cầu công ty hoạt động và đã duyệt. Câu hỏi tự phục vụ được định tuyến bằng quy tắc; nút tra cứu là đường truy cập rõ ràng khi câu hỏi không được nhận diện. Kết quả không gửi cho model ở lượt sau.
- **Handoff**: người dùng đồng ý, lưu bản chụp, hàng đợi ADMIN, một người nhận việc, chuyển ChatMessage/Socket.IO có sẵn, thử lại không trùng, đánh dấu xử lý. Không mất ticket khi chưa có người online.
- **Quyền**: support:chat:use cho tài khoản hợp lệ, support:manage cho ADMIN. Chưa tạo vai trò SUPPORT riêng; ADMIN đảm nhiệm trong ma trận hiện tại.
- **Dự phòng**: OpenAI → Gemini theo cấu hình chính sách trả phí → Ollama tùy chọn → hướng dẫn/chuyển nhân viên. Giới hạn thời gian, độ dài, lượt công cụ và circuit breaker theo provider.
- **Vận hành**: Docker/Compose, supervisor local, migration, retention, readiness, metrics, cấu hình mẫu, OpenAPI và các bộ kiểm thử. RabbitMQ không nằm giữa browser và token stream.

## Phạm vi kiểm thử

Bộ tích hợp dùng MySQL Docker sạch, HTTP/Gateway/SSE thật và widget React/assistant-ui thật trong Chromium. Danh tính, phản hồi AI và gửi tin tới nhân viên được giả lập để không tác động người dùng thật.

- Store mới đọc lại dữ liệu; chủ khác không đọc/xóa được; retry không tạo lượt mới; dùng lại mã với câu hỏi khác bị từ chối.
- Hai cửa sổ không cùng ghi; phiên bản cũ bị chặn; sửa cắt lượt sau; lease hết hạn phục hồi được.
- Một ticket/một người tiếp nhận; xóa/retention dọn dữ liệu phụ thuộc; retry delivery giữ mã tin.
- Header giả bị thay; JWT/cookie không lọt sang provider; khách không dùng công cụ cá nhân; non-admin không đọc hàng đợi.
- Fallback kiến thức, lỗi Elasticsearch/provider, giới hạn công cụ, loại kết quả riêng tư khỏi ngữ cảnh AI. Adapter AI SDK thật được kiểm thử bằng stream OpenAI giả lập đúng giao thức.
- Gửi, sửa câu đầu, tạo lại, thẻ việc, nguồn, lỗi giữa chừng, dừng, khôi phục lịch sử từ MySQL, xóa, tra cứu, đồng ý chuyển hỗ trợ, hộp thư nhân viên, màn hình 390px.

Báo cáo tích hợp: `.local/support-chat-browser/validation.json`; ảnh trong cùng thư mục. Eval AI thật: `.local/support-service-evaluation.json`. Kết quả kỹ thuật không thay thế việc chấm chất lượng nội dung từ model thật.

## Những giới hạn cần biết

1. **Môi trường hiện chưa có API key hoặc model local.** Chưa thể kết luận chất lượng bằng chatbot thương mại. Cần cấu hình provider, chạy live eval, chấm độ đúng/nguồn và đo chi phí/độ trễ.
2. Chưa triển khai lại toàn bộ stack đang dùng của người dùng. Khởi động/rebuild theo CHATBOT_SETUP.md để Gateway, service và backend bridge cùng phiên bản. Không tạo tin tuyển dụng hoặc sửa tài khoản thật để làm đẹp kết quả.
3. Không mở upload file trong chatbot hỗ trợ. CV dùng luồng CV hiện có; nếu thêm support upload phải có giới hạn MIME/size và quét mã độc như checklist PDF.
4. Có khôi phục lịch sử, lưu phần bị dừng/ngắt có kiểm soát và retry. **Không nối tiếp chính xác token stream sau khi process chết**; lượt treo được đánh dấu chưa hoàn tất khi lease hết hạn. Chưa có bộ đệm phát lại token qua broker.
5. RAG dùng truy xuất từ khóa/corpus có kiểm duyệt; chưa có embeddings/reranker hoặc giao diện biên tập tài liệu. Kho FAQ nhỏ hiện dùng cách này. Dữ liệu cá nhân đọc trực tiếp, không đưa sang model để suy luận.
6. Chưa có phân ca, chuyển nhóm xử lý, SLA/email hoặc vai trò SUPPORT riêng. ADMIN tiếp nhận và chat qua hệ thống sẵn có. ChatMessage đã gửi có vòng đời riêng, được thông báo rõ trong UI.

Không đồng nhất “đã triển khai các luồng chính” với “đã được xác nhận sẵn sàng production”. Hướng dẫn cấu hình/kiểm thử: [CHATBOT_SETUP.md](../CHATBOT_SETUP.md).

## Tham chiếu

- [assistant-ui](https://github.com/assistant-ui/assistant-ui): thành phần giao diện.
- [Vercel AI SDK streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text): streaming và tool loop.
- [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini): model cấu hình mặc định; quyền thực tế phụ thuộc tài khoản.
