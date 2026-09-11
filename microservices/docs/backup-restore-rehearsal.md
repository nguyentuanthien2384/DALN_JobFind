# Sao lưu và khôi phục dữ liệu/hàng đợi — 2ae

Tiếp nối [Worker/Admin 2ad](worker-admin-rehearsal.md). Bài diễn tập đọc nguồn `ai-job-portal`, tạo bản sao riêng, gây sự cố trên bản sao và khôi phục vào volume mới. Kết quả máy đọc được tại [backup-restore-rehearsal.json](backup-restore-rehearsal.json). Chỉ xem là đạt khi `status=passed`, `sourceUnchanged=true`, `cleaned=true`.

**PASS ngày 11-09-2026**, project `jobfind-restore-a2c024d6`: 8 nhóm kiểm tra tích hợp qua; 18 kiểm thử công cụ/runtime qua, trong đó 3 ca về tính toàn vẹn/khôi phục được chạy lại sau khi bổ sung đánh dấu bản sao đã kiểm chứng. Nguồn không đổi; container/network/volume thử đã dọn. Khôi phục sau SIGKILL và đối chiếu mất khoảng **26,4 giây**; thay toàn bộ volume rồi phục hồi/đối chiếu mất **43,4 giây** trong môi trường thử này. Đây là thời gian đo của dữ liệu/bộ máy thử, không phải SLA hoặc RTO đã cam kết cho môi trường thật.

Bộ sao lưu được giữ tại **`D:\job_find\.local\backups\restore-2026-09-11T14-03-08-894Z`**, gồm 10 artifact với tổng 93.367.426 byte, cộng manifest. Manifest đã ghi `restoreVerification.status=passed`, kiểm tra lại mọi checksum sau hoàn tất. Các lượt thử chưa đạt trước đó không được đánh dấu này. Lượt đầu sửa điểm mount của helper; lượt sau điều chỉnh tiêu chí sequence sau crash từ so đúng số cũ sang kiểm tra không lùi và cấu hình không đổi. Không sửa sequence hoặc dữ liệu nguồn để vượt bài kiểm tra.

## Phạm vi dữ liệu thật

- MariaDB **10.4.32**: 31 bảng InnoDB, 465 dòng, gồm 6 CV. Dump mới từ transaction `REPEATABLE READ`, `CONSISTENT SNAPSHOT`, `READ ONLY`; kiểm tra checksum từng dòng gồm toàn bộ BLOB, schema từng bảng. Không đổi engine sang MySQL 8 để làm bài phục hồi. Big integer được giữ dạng chuỗi để không mất chính xác; file SQL quy định chế độ escape và giữ ID 0 khi import.
- PostgreSQL 16: 5 bảng public, gồm 6 hồ sơ ứng tuyển, 11 sự kiện, 6 ghi chú; đối chiếu rows, columns, constraints, indexes, sequence và large objects. Volume vật lý chứa cả cluster/role. Bản `pg_dump` chỉ của database ứng dụng, không thay thế sao lưu global role.
- MongoDB 7: 1.142 audit, 1 tag, 2 profile; toàn bộ document, options, index được đối chiếu. TTL monitor tắt trên các bản sao để không xóa dữ liệu trong lúc kiểm tra. Bản sao nguồn giữ cấu trúc/index/retention đang có.
- RabbitMQ: đúng image, hostname/node name và toàn bộ volume `/var/lib/rabbitmq`, gồm cookie, definitions và message store. 12 queue nguồn là classic durable, không có ready/unacked lúc đọc bản khôi phục. Volume nguồn hiện là volume tự sinh; tên chính xác và node identity được lưu trong bằng chứng.

Ba bộ sao lưu ngày 10–11/09 có sẵn đã được kiểm tra checksum/độ dài, không ghi đè. Bài xuất–nhập logic chạy trên bộ sao lưu mới; không đồng nhất “checksum hợp lệ của file cũ” với “file cũ đã được diễn tập khôi phục”.

## Các tình huống diễn tập

1. Archive volume MongoDB/PostgreSQL/RabbitMQ nguồn khi nguồn đã dừng, mount nguồn chỉ đọc. Giải nén sang volume mới, đối chiếu checksum toàn bộ file trước khi mở DB. RabbitMQ nguồn dừng với exit 137: đây là khôi phục từ trạng thái bị ngắt, không gắn nhãn shutdown sạch.
2. Khôi phục SQL vào MariaDB cùng phiên bản, đối chiếu toàn bộ row/BLOB/schema với snapshot ngay lúc dump. Từ MongoDB/PostgreSQL bản sao, tạo `mongodump`/`pg_dump`, import vào namespace/database trống khác và so toàn bộ dữ liệu/chỉ mục/sequence. Restore dừng nếu gặp lỗi; không bỏ qua lỗi duplicate, không sửa dữ liệu để làm kết quả qua.
3. Tạo marker liên kết trong ba kho bản sao và vhost RabbitMQ riêng. Publisher nhận confirm cho 8 message persistent: 6 công việc và 2 message ở hàng đợi lỗi. Một công việc được ghi receipt vào MariaDB nhưng cố tình chưa ACK: còn 5 ready + 1 unacked + 2 dead-letter.
4. Gửi SIGKILL tới cả bốn kho **chỉ trong project thử**, khởi động lại. Các bản ghi đã commit/marker/checksum/definitions phải giữ nguyên, message chưa ACK phải quay lại hàng đợi. Bộ đếm PostgreSQL được phép tiến lên các số đã dành trước trong WAL, nhưng không được lùi; dữ liệu và cấu hình sequence vẫn đối chiếu chặt. Không gọi `setval` để ép số quay lại.
5. Dừng sạch bản sao, archive cả bốn volume thành checkpoint thử. Xóa toàn bộ container và volume thử; giải nén archive sang volume mới, giữ đúng node name RabbitMQ. Đối chiếu dữ liệu, definitions, queue count với trạng thái sau crash.
6. Đọc đúng 8 message tổng hợp, so bytes/nội dung/message ID/header/persistence; một lần giao lại message đã ghi receipt không tạo thêm hiệu ứng. Tổng 6 receipt cho 6 công việc. ACK cả các message thử rồi restart broker để xác nhận chúng không xuất hiện lại. Không consume/ACK queue dữ liệu thật.
7. Kiểm tra mạng internal, không cổng công bố, không mount volume nguồn vào ứng dụng thử. Dọn tài nguyên thử theo nhãn sở hữu; đối chiếu lại checksum file nguồn và trạng thái container nguồn.

Đây là kiểm thử độ bền dữ liệu và hàng đợi. Receipt là fixture để kiểm tra cửa sổ commit–ACK; không phải nghiệm thu lại mọi consumer nghiệp vụ. Ba trạng thái ledger AI tổng hợp được giữ nguyên; không tự chạy lại yêu cầu AI `started` chưa rõ kết quả. Không gọi AI, SMTP hoặc bật tính năng giao diện.

## Chạy lại và vị trí bản sao

Từ gốc repository:

```powershell
npm run test:restore
npm run test:runtime
```

Công cụ yêu cầu toàn bộ container của project nguồn **đã dừng** và không có container khác đang ghi các volume nguồn; công cụ không tự dừng hệ thống thật. MariaDB nguồn đọc theo cấu hình `backend/.env`, không in credential. Bài hiện ghim phiên bản MariaDB 10.4.32 và chỉ hỗ trợ các bảng InnoDB không có view/trigger/routine/event/generated column; nếu xuất hiện cấu trúc khác thì dừng để dùng dump native phù hợp. Không thực hiện DDL đồng thời với backup SQL.

Mỗi lượt tạo thư mục `.local/backups/restore-<UTC>/`. Đường dẫn bộ được kiểm chứng ghi ở trường `backupDirectory` trong báo cáo. Bản sao được giữ lại sau khi dọn Docker; `.local/` đã bị loại khỏi Git. File `manifest.json` chứa checksum SHA-256 và kích thước mọi artifact; `verifyBackup` phải qua trước dùng bản sao. Chỉ sau bài khôi phục thành công, kiểm chứng nguồn không đổi và dọn môi trường thử mới ghi `restoreVerification.status=passed`. Không phục hồi từ thư mục thiếu manifest hoặc lượt thất bại; dấu xác nhận không thay cho việc chạy lại checksum.

Các file để phục hồi **dữ liệu nguồn** là `mysql.sql`, `mongo-source.tar.gz`, `postgres-source.tar.gz`, `rabbitmq-source.tar.gz`; `postgres.dump` và `mongo.archive.gz` là phương án logic đã thử. `*-checkpoint.tar.gz` chứa dữ liệu/vhost tổng hợp của bài diễn tập và các namespace thử, chỉ dùng để lặp lại bài kiểm tra, **không đưa vào môi trường thật**. `coordinatedCheckpoint` trong manifest chỉ nói về checkpoint của fixture; trường `checkpointScope` ghi rõ giới hạn này.

Sao lưu có dữ liệu riêng tư, mật khẩu ứng dụng được lưu trong DB và cookie broker: giữ trong nơi lưu trữ do người vận hành kiểm soát, không commit hoặc đưa file lên báo cáo. Báo cáo Git chỉ chứa số lượng, metadata và checksum; không có payload/CV/credential.

## Trình tự phục hồi thật đã được chuẩn bị

1. Chọn bộ backup được kiểm chứng, kiểm tra manifest và phiên bản image/engine. Giữ nguyên hiện trường sự cố và dữ liệu phát sinh sau backup; tạo volume/database đích mới.
2. Dừng toàn bộ writer/consumer đúng cửa sổ bảo trì, gồm backend legacy và tác vụ ngoài Compose. Khôi phục ba kho và broker của cùng recovery point đã chọn; không trộn snapshot cũ/mới rồi tự replay toàn bộ event.
3. RabbitMQ phải giữ đúng node name/hostname và toàn bộ dữ liệu node. Không thay volume tự sinh bằng volume rỗng hoặc chỉ import definitions rồi cho rằng message đã phục hồi. Không reset broker, purge queue hay đổi queue type tại chỗ.
4. So checksum/count/schema, user/quyền, ID/ledger/outbox/inbox, message ready/unacked/DLQ. Khởi động reader và consumer tương thích trước writer; đối chiếu kết quả chưa rõ, dedup và ledger AI trước khi xử lý backlog. Khởi động bằng đúng secret/image cấu hình, giữ cờ frontend tắt cho đến nghiệm thu triển khai.

## Giới hạn vận hành còn phải giữ

- Các file nguồn là snapshot theo từng kho: MariaDB đọc ở thời điểm mới, MongoDB/PostgreSQL/RabbitMQ lấy từ volume đã dừng. Không coi chúng là một giao dịch phân tán hoặc một recovery point đồng bộ của toàn hệ thống thật. Checkpoint đồng bộ đã diễn tập là checkpoint **trên bản sao sau khi ngừng ghi fixture**.
- Backup hiện lưu cùng máy/ổ D:. Đã thử mất container và volume Docker; chưa chứng nhận mất máy/ổ đĩa, offsite restore, lịch backup hay RPO/SLA. Chưa có đích sao lưu ngoài máy được cấu hình.
- Redis rate limit và Elasticsearch projection không nằm trong bộ bốn kho này. Cần khởi tạo Redis và đối chiếu/rebuild Search từ nguồn trong đợt nghiệm thu triển khai; không coi dữ liệu hai dịch vụ này đã được backup/restore bởi bài này.
- Chưa cập nhật `.env`, cấu hình volume/hostname hay runtime thật. Bước tiếp theo là cố định artifact triển khai/quay lui và hoàn thiện cấu hình provider theo [kế hoạch rollout](rollout-plan.md).

## Cơ sở kỹ thuật

[RabbitMQ Backup and Restore](https://www.rabbitmq.com/docs/backup) phân biệt definitions với message store, yêu cầu dừng node khi backup message và giữ nguyên node name khi khôi phục đĩa. [PostgreSQL pg_restore 16](https://www.postgresql.org/docs/16/app-pgrestore.html) mô tả restore archive và dừng khi lỗi. [MongoDB mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/) mô tả archive/namespace/index; bài dùng namespace trống, không `--drop` dữ liệu nguồn. [PostgreSQL Sequence Functions 16](https://www.postgresql.org/docs/16/functions-sequence.html) giải thích sequence có khoảng trống và không dùng để đánh số liên tục.
