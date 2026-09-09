# Đồng bộ AI/CV và tìm kiếm — đợt 2x

Đợt thực hiện ngày 08–09/09/2026, tiếp nối nghiệm thu Compose 2w. Đã nối màn hình ứng viên với API AI/CV hiện có và thêm lựa chọn Search cho trang tìm việc chính. Không thay `.env`, dữ liệu, schema hoặc container đang phục vụ; không gọi AI/SMTP thật.

## Màn hình và dữ liệu

- `/candidate/ai-cv` chỉ dành cho CANDIDATE đang đăng nhập. Khi bật cờ, menu tài khoản desktop/mobile có mục **CV và trợ lý AI** và trang chi tiết tin có đường dẫn kèm mã công việc.
- Đọc CV từ PDF → chờ kết quả → xem và chỉnh sửa bản nháp → chủ động lưu vào danh sách CV của Identity. Có đầy đủ thông tin liên hệ, giới thiệu, kỹ năng, ngôn ngữ, kinh nghiệm và học vấn; thời gian `duration` từ AI được chuyển sang trường `from` để người dùng sửa lại.
- Đánh giá CV theo mã công việc hiển thị điểm, kỹ năng phù hợp/chưa thể hiện, điểm mạnh và điều cần xem lại. Soạn thư hỗ trợ tiếng Việt/Anh và cho sửa nội dung kết quả. Không tự nộp hồ sơ hoặc gửi thư.
- Danh sách CV có tải, tạo, sửa, xóa; payload chỉ chứa trường cho phép. Không ghi `userId`, trường nội bộ hoặc toàn bộ kết quả thô của AI vào profile. Đây là CV có cấu trúc trong Identity, chưa đồng bộ hai chiều với thông tin tài khoản, tệp CV và hồ sơ đã nộp của legacy.
- PDF tối đa 5 MiB, tên tối đa 255 ký tự; kiểm tra đuôi và dấu `%PDF-` trước gửi. Đây là kiểm tra định dạng ban đầu, chưa phải quét nội dung file. Nội dung văn bản gửi matching/thư giới hạn 10.000 ký tự để tránh bị worker cắt ngầm.
- Trang `/job` có trạng thái đang tải, lỗi/tải lại, không có kết quả; bỏ phản hồi đến muộn khi đổi bộ lọc. Adapter Search chuyển dữ liệu phẳng về hình dạng thẻ tin đang dùng; nhãn mã lấy từ danh mục legacy, thiếu nhãn thì hiện mã gốc.

## Yêu cầu AI và khôi phục

Mỗi người dùng giữ một ý định AI trong **sessionStorage của tab**, gồm loại tác vụ, key, SHA-256 của payload và task ID nếu đã nhận. Không lưu PDF, nội dung CV hoặc kết quả AI vào storage. Cần HTTPS hoặc localhost để dùng Web Crypto. Nháp CV và thư đang sửa chỉ nằm trong bộ nhớ trang, không được tự lưu.

Key được lưu trước POST. Bấm liên tiếp không tạo hai POST; mất phản hồi không tự sinh key hoặc tự gửi lại. Khi tải lại, người dùng chọn lại đúng dữ liệu cũ để đối chiếu bằng cùng key. Các lỗi xác định từ chối đầu vào (400/404/413/415/422) cho sửa dữ liệu với cùng key; 409/timeout/503 vẫn giữ nguyên ý định để đối chiếu. Server là nơi bảo đảm chống trùng.

Đã nhận task ID thì chỉ đọc GET; kiểm tra đúng ID và loại tác vụ trước hiển thị. Dừng chờ hoặc hết 120 giây không hủy công việc phía server và không xóa mã. Tác vụ hoàn tất/thất bại cho phép bấm **Tác vụ mới**, không tự tạo thay thế; kết quả sai cấu trúc không hiển thị thành công. Phiên kết thúc/đổi tài khoản ngắt polling và bỏ phản hồi muộn.

Storage không khả dụng trước gửi thì không POST. Nếu đã nhận ID mà lưu storage lỗi, giữ ID trên trang, báo lỗi và khóa tạo mới. Đóng tab/xóa storage có thể mất mã cục bộ; đây chưa phải lịch sử tác vụ nhiều thiết bị hoặc bảo đảm khôi phục sau đóng tab. Không xóa ledger server để giải quyết yêu cầu chưa rõ kết quả.

Ghi CV hiện **chưa có idempotency hoặc revision/ETag phía server**. Trước ghi, UI giữ marker chỉ gồm thao tác và CV ID trong sessionStorage. Mất phản hồi thì khóa ghi tiếp, kể cả refresh; người dùng tải danh sách, xem nội dung và chủ động xác nhận đã đối chiếu. GET đơn lẻ không chứng minh lần ghi trước thành công. Không tự retry POST/PUT/DELETE. Không bảo đảm ngăn sửa đè giữa nhiều tab/thiết bị; chưa được xem marker này là cơ chế giao dịch server.

## Search và tương thích legacy

`GET /api/search/jobs` giữ API scalar cũ và nhận thêm tham số lặp cho bốn bộ lọc:

```text
salaryJobCode=S1&salaryJobCode=S2&categoryWorktypeCode=W1
```

`salaryJobCode`, `categoryJoblevelCode`, `categoryWorktypeCode`, `experienceJobCode` nhận tối đa 20 giá trị mỗi trường, OR trong trường và AND giữa các trường. Không dùng chuỗi nối dấu phẩy. Ngành nghề/địa điểm, từ khóa, phân trang vẫn đơn trị; object, kiểu sai và giá trị lặp rỗng bị từ chối. Gateway và Search dùng chung schema.

Search bật `track_total_hits` để trả tổng chính xác; UI chỉ cho phân trang trong cửa sổ 10.000 kết quả theo hợp đồng hiện có. Từ khóa dùng relevance; khi không có từ khóa, Search giữ thứ tự tin nổi bật/thời gian. Đây không phải cam kết cùng thứ hạng/từ khóa với SQL legacy. Projection có độ trễ; đọc Search không thay thế biên nhận của thao tác ghi.

## Bật và rollback

Hai cờ build mới mặc định trong `.env.example`:

```dotenv
REACT_APP_JOB_SEARCH_MODE=legacy
REACT_APP_CANDIDATE_AI_ENABLED=false
```

1. Cập nhật Search và Gateway cùng schema đa lựa chọn trước khi bật `core`. Giữ API danh mục và chi tiết tin legacy vì thẻ kết quả vẫn dùng chúng.
2. Chuẩn bị Identity/CV, Core AI, worker, broker, ledger/consumer theo các đợt trước, nghiệm thu bằng provider giả. Giữ cùng chính sách JWT và quyền hiện tại.
3. Build frontend với `REACT_APP_JOB_SEARCH_MODE=core` và/hoặc `REACT_APP_CANDIDATE_AI_ENABLED=true` khi triển khai có chủ đích. Hai cờ độc lập các cờ tạo/sửa/đăng lại/workspace nhà tuyển dụng. Search lỗi không tự chuyển sang legacy.
4. Rollback bằng **frontend 2x+** với Search `legacy` và AI `false`. Giữ route `/candidate/ai-cv` để xem task ID/đối chiếu yêu cầu đã gửi và tải danh sách CV; ẩn menu, khóa tác vụ/CV mới. Với ý định chưa có ID, chỉ người dùng chủ động gửi lại theo ý định đang giữ. Không bỏ endpoint, ledger, storage hoặc worker khi còn tác vụ chưa đối chiếu.

Cờ là cấu hình lúc build, không phải công tắc phía server và không thay đổi bundle đang mở. Chưa bật cờ trên môi trường thật trong đợt này. Mọi điều kiện writer/revision/rollback 2q–2u vẫn áp dụng.

## Kiểm chứng và chạy lại

- Frontend: **1.350 test / 64 suite**; microservices: **1.131 test / 59 file**. Bao gồm session, phản hồi sai/muộn, giữ key qua refresh/rollback, lỗi storage, CV CRUD/đối chiếu, adapter và serialize nhiều bộ lọc qua HTTP thật.
- Compose cách ly: **22 checkpoint**, gồm 17 checkpoint nền cũ và 5 checkpoint mới: parse/match/thư qua worker + SDK HTTP giả (thư dùng SSE), replay không tăng số lần gọi, quyền người khác, CV CRUD qua Gateway/MongoDB, Search nhiều bộ lọc qua Elasticsearch thật. Project `jobfind-accept-813f2977` kết thúc thành công và đã dọn tài nguyên sở hữu.
- Browser trên production build: PDF → kết quả → bản nháp đầy đủ → lưu CV → refresh chỉ GET; bố cục mobile, sửa thư và thẻ tìm kiếm Core. Đã xem ảnh desktop/mobile và sửa phần chiều rộng kế thừa từ trang quản trị; bài browser kiểm tra cả không tràn lẫn chiều rộng dùng được của form. Mọi API trả dữ liệu tổng hợp tại browser; không có backend/provider thật được gọi. Đây là bài UI riêng, không phải browser nối trực tiếp toàn Compose. Đã chạy trên Edge/Chromium local; CI cấu hình dùng Chromium.
- Build cả Core/AI bật và legacy/AI tắt; kiểm tra HTTP/event contracts, script, YAML và diff. CI đã thêm bước build/bài browser; chưa push hoặc chạy workflow GitHub. Không cộng bộ backend/360 nhóm tích hợp lịch sử chưa chạy lại vào các số trên.

Chạy unit/contract và chuỗi nền:

```powershell
# frontend
npm run test:unit -- --silent
# microservices
npm test
npm run contracts:check
npm run test:compose-background:integration
```

Chạy browser sau khi build cờ thử (biến chỉ thuộc phiên lệnh, không sửa `.env`):

```powershell
# frontend
$env:REACT_APP_JOB_SEARCH_MODE='core'
$env:REACT_APP_CANDIDATE_AI_ENABLED='true'
$env:REACT_APP_APPLICATION_PROGRESS_ENABLED='true' # Bộ browser từ 2y kiểm tra thêm lịch sử ứng tuyển
$env:REACT_APP_PREPARED_CV_APPLICATION_ENABLED='true' # Từ 2z kiểm tra thêm CV đã lưu -> PDF ứng tuyển
npm run build
# microservices; cài Chromium thử một lần nếu chưa có
npx --no-install playwright install chromium
npm run test:candidate-browser:integration
```

Có thể đặt `JOBFIND_TEST_BROWSER_CHANNEL=msedge` khi Edge sẵn trên máy. `JOBFIND_KEEP_UI_SCREENSHOT=1` giữ ảnh trong thư mục tạm mang tiền tố `jobfind-candidate-ui-`; mặc định runner dọn thư mục nó tạo và đóng server/browser. Sau nghiệm thu, build lại với legacy/false nếu artifact local cần giữ mặc định.

Trong lượt xem ảnh local, cờ giữ ảnh được bật. Bộ kiểm duyệt tự động chặn thao tác dọn thủ công với lý do `blocked by policy`, nên bốn thư mục ảnh tổng hợp vẫn còn trong `C:\Users\Admin\AppData\Local\Temp`: `jobfind-candidate-ui-GrXvMq`, `jobfind-candidate-ui-vWSp75`, `jobfind-candidate-ui-4VtyiJ`, `jobfind-candidate-ui-x63BQj`. Không có dữ liệu CV thật trong ảnh; browser/server thử đã đóng. Việc này không ảnh hưởng kết quả dọn tài nguyên Compose riêng.

Bước tiếp theo: đối chiếu hồ sơ/CV và luồng ứng tuyển legacy còn lại, kiểm thử dữ liệu lịch sử và các vai trò trên stack dự kiến trước rollout. Chưa chứng nhận chất lượng AI, đăng nhập/SMTP/Socket.IO thật, migration, tải hoặc toàn bộ các mục PDF.
