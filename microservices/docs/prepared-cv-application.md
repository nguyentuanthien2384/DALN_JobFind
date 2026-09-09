# Dùng CV đã chuẩn bị để ứng tuyển — đợt 2z

Ngày 09-09-2026, tiếp nối đường nộp CV bền và lịch sử ứng tuyển của [đợt 2y](application-sync.md). Đợt này nối CV có cấu trúc đã lưu tại Identity vào tệp PDF gửi qua thao tác ứng tuyển hiện có. Chưa triển khai lên môi trường đang phục vụ.

## Luồng ứng viên

1. Kiểm tra và lưu nội dung tại **CV và trợ lý AI**. Khi mở từ một tin tuyển dụng, trang có liên kết quay lại đúng công việc; bản nháp chưa lưu không được chuyển theo.
2. Mở **Ứng tuyển ngay**, kiểm tra tên công việc và nhập lời giới thiệu tối đa 255 ký tự. Chọn **CV đã chuẩn bị**.
3. Chọn một CV trong danh sách của tài khoản hiện tại, bấm **Tạo bản PDF để xem lại**. Không tự chọn CV đầu tiên, không gửi yêu cầu AI hoặc nộp hồ sơ ở bước này.
4. Mở hoặc tải bản PDF, kiểm tra nội dung rồi chọn **Tôi đã xem và chọn bản PDF này để ứng tuyển**. Bấm **Gửi hồ sơ** để nộp.
5. Theo dõi hồ sơ tại **Công việc đã nộp**; tiến trình hiển thị khi cờ đọc tiến trình 2y đã bật.

CV dùng nội dung của lần tải danh sách hiện tại. Sau khi tạo bản xem lại, chỉnh sửa/xóa CV nguồn ở nơi khác không đổi tệp đã chọn. Tải lại danh sách hoặc đổi CV sẽ xóa bản xem lại và yêu cầu chọn lại. Thao tác gửi lấy đúng chuỗi PDF đã xem, không tải lại hoặc tạo lại PDF giữa lúc gửi.

Chỉ bốn trường `userId`, `postId`, `file`, `description` được gửi tới `POST /api/create-new-cv`; backend tiếp tục lấy người nộp từ phiên đăng nhập và kiểm tra quyền hiện tại dưới khóa như 2y. Mongo CV ID không được dùng làm CV ID MySQL. Không thêm trường vào HTTP/event hoặc lưu liên kết cập nhật hai chiều. Thông tin trong PDF do ứng viên chọn; liên hệ trong event vẫn lấy từ tài khoản đã khóa khi nộp.

## Tệp và phiên làm việc

- PDF A4 có chữ chọn/sao chép được, phông Roboto hiện có trong dự án được nhúng vào tệp, hỗ trợ dấu tiếng Việt, xuống dòng, ngắt từ quá dài và đánh số trang. Các mục họ tên, tiêu đề, liên hệ, giới thiệu, kỹ năng, kinh nghiệm, học vấn, ngôn ngữ đều lấy từ bản CV đã lưu.
- Dùng `pdf-lib@1.17.1` và `@pdf-lib/fontkit@1.1.1`, tải phần tạo PDF khi ứng viên chủ động tạo bản xem lại. Tải phông chữ từ cùng website; không gọi dịch vụ chuyển đổi, URL trong CV hoặc AI. Nội dung được vẽ như văn bản, không đưa qua HTML. Cách nhúng và kiểm tra ký tự dựa trên [tài liệu PDF-LIB](https://pdf-lib.js.org/docs/api/classes/pdffont).
- Yêu cầu họ tên; giới hạn 60.000 ký tự nội dung đã chuẩn hóa, 20 trang và 2 MiB. Phông thiếu ký tự, lỗi tải, dữ liệu sai hoặc vượt giới hạn sẽ báo lỗi, không bỏ nội dung hay trả tệp một phần. Có thể sửa CV hoặc chủ động chọn tệp PDF riêng.
- Bản xem lại và PDF chỉ giữ trong bộ nhớ của modal. Đổi công việc, đóng modal, thay tài khoản hoặc kết thúc phiên sẽ hủy lựa chọn và bỏ phản hồi muộn. URL tạm của bản xem lại được thu hồi; không ghi CV hoặc PDF vào local/session storage.
- Chặn gửi chồng; khóa lựa chọn lúc đang gửi. Khi mất phản hồi hoặc nhận báo đã ứng tuyển, giữ bản đang xem và hướng dẫn kiểm tra hồ sơ đã nộp; không tự gửi lại. Rời trang có thể làm mất bản chưa gửi; ghi đã được backend chấp nhận vẫn tồn tại theo 2y.
- Hai nguồn cũ **Tự chọn CV** và **CV online** tiếp tục có mặt. Modal chỉ mở cho ứng viên đã đăng nhập; kiểm tra dấu hiệu PDF, dung lượng và lời giới thiệu trước khi gửi. Lỗi tải nguồn CV đã chuẩn bị không tự chuyển nguồn.
- Identity và Gateway trả `Cache-Control: private, no-store` cho đường CV cá nhân. Quyền sở hữu vẫn do danh tính Gateway và `legacyUserId` tại Identity quyết định, không nhận user/CV owner từ query của màn hình chọn.

## Cờ, áp dụng và rollback

```dotenv
REACT_APP_PREPARED_CV_APPLICATION_ENABLED=false
```

Cờ mới chỉ điều khiển lựa chọn CV có cấu trúc khi ứng tuyển, độc lập cờ AI/CV và tiến trình tuyển dụng. Bản CV phải đã lưu; việc tạo/sửa CV vẫn theo cờ AI/CV hiện có.

1. Giữ đầy đủ điều kiện writer/relay/importer/consumer của 2y, đặc biệt InnoDB, unique CV và outbox. Không có migration/DDL mới trong 2z.
2. Nâng Identity và Gateway với chính sách không lưu cache CV cá nhân. Xác minh tài khoản ứng viên đọc được danh sách của chính mình.
3. Build frontend với cờ mới `true` sau khi các phụ thuộc trên sẵn sàng. Giữ các tệp Roboto trong artifact website; không chặn tải phông hoặc bản xem lại `blob:` trong chính sách trình duyệt của môi trường đích.
4. Rollback bằng frontend với cờ mới `false`. PDF đã nộp là tệp độc lập trong CV legacy, tiếp tục đọc và đồng bộ theo 2y. Không xóa PDF, outbox hoặc dữ liệu Application để rollback giao diện.

Chưa thay `.env`, cờ/container/schema/dữ liệu thật, gọi provider/SMTP, push/deploy hoặc chạy workflow GitHub. Bản dựng cuối local giữ các cờ mới tắt.

## Nghiệm thu và chạy lại

**1.383 test frontend / 68 suite và 1.133 test microservices / 59 file qua**, tổng 2.516 bài hồi quy; các bài kiểm tra lại sau chỉnh sửa không cộng thêm vào tổng. Không chạy lại 789 bài backend unit của 2y trong đợt này. Bộ kiểm tra gồm lựa chọn/xem lại/gửi có chủ đích, đúng byte PDF, đổi nguồn/đổi phiên/kết quả muộn, mất phản hồi/trùng, dữ liệu sai và tạo PDF tiếng Việt nhiều trang.

Browser production và **10 nhóm tích hợp DB/broker với chính PDF từ browser đều qua**. Đã trích lại nội dung PDF hai trang: tên tiếng Việt, đủ 28 đoạn và dòng kết thúc; render từng trang bằng Poppler để kiểm tra chữ/bố cục. Hai chế độ build bật/tắt, kiểm tra cài đặt từ lockfile, contracts, syntax, YAML và diff qua. Bộ browser dùng API fixture, chặn các request ngoài fixture/website; không chứng nhận đăng nhập thật. Ảnh/PDF tổng hợp được giữ tại thư mục tạm riêng để xem lại; container/volume thử thuộc bài tích hợp đã dọn.

Từ `frontend`, build các cờ thử trong phiên lệnh, không sửa `.env`:

```powershell
$env:REACT_APP_JOB_SEARCH_MODE='core'
$env:REACT_APP_CANDIDATE_AI_ENABLED='true'
$env:REACT_APP_APPLICATION_PROGRESS_ENABLED='true'
$env:REACT_APP_PREPARED_CV_APPLICATION_ENABLED='true'
npm run build
```

Từ `microservices`, sau khi cài dependencies của frontend/backend/microservices và chuẩn bị ba image MySQL/PostgreSQL/RabbitMQ theo 2y:

```powershell
$env:JOBFIND_TEST_BROWSER_CHANNEL='msedge' # Hoặc cài Chromium trên máy/CI
$env:JOBFIND_VERIFY_PREPARED_CV_DELIVERY='1'
npm run test:candidate-browser:integration
```

Chế độ này lấy chính PDF được tạo và chọn trên browser, đối chiếu byte trong POST fixture, rồi đưa cùng tệp vào bài 10 nhóm tích hợp backend → MySQL outbox → relay → RabbitMQ → Application/PostgreSQL thật trên container tạm. Backend chặn giả mạo người nộp, giữ nguyên PDF khi nguồn thay đổi hoặc nộp lại, kiểm tra rollback/chống trùng/phục hồi broker. Browser và backend tích hợp là hai giai đoạn nối bằng tệp kiểm thử, không phải browser đăng nhập và gọi xuyên Gateway tới toàn bộ stack thật.

Không đặt `JOBFIND_VERIFY_PREPARED_CV_DELIVERY` thì chỉ chạy browser. `JOBFIND_KEEP_UI_SCREENSHOT=1` giữ ảnh và PDF tổng hợp trong thư mục tạm riêng để xem; mặc định runner dọn thư mục nó tạo. Bài database xác minh label/token trước khi dọn tài nguyên sở hữu. CI được nối hai giai đoạn này, không chạy lặp bài Application trước browser.

## Phần còn lại

**Cập nhật 2aa ngày 09-09-2026:** nghiệm thu HTTP xuyên vai trò trong Compose đã qua 32 checkpoint, gồm login legacy thật, hồ sơ lịch sử, nộp PDF, Kanban/tiến trình và restart. Xem [compose-application-acceptance.md](compose-application-acceptance.md). PDF trong bài Compose là fixture; browser tạo/chọn PDF trên API Compose thật vẫn là bước kế tiếp. Đoạn dưới ghi phạm vi tại thời điểm kết thúc 2z.

Đợt này chưa chứng nhận login/SMTP/Socket.IO thật, chất lượng AI, tải, bộ dữ liệu lịch sử quy mô lớn hoặc toàn bộ checklist kiến trúc. Chưa có revision/idempotency phía server cho CV Builder; thao tác lưu chưa xác nhận vẫn phải đối chiếu theo 2x. Bước tiếp theo là nghiệm thu xuyên vai trò trên Compose cách ly với dữ liệu lịch sử đại diện, từ chuẩn bị CV đến ứng tuyển và cập nhật tiến trình tuyển dụng, trước khi bật cờ trên môi trường dự kiến.
