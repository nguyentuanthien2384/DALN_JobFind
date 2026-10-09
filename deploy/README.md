# Triển khai JobFind lên VPS bằng Docker

Toàn bộ hệ thống chạy bằng Docker Compose trên **một VPS Linux**. Chỉ có Caddy mở cổng ra Internet; Caddy tự xin và tự gia hạn chứng chỉ HTTPS.

```
Internet ──► Caddy "web" :80/:443 (HTTPS tự động, giao diện React)
               └─ /api, /socket.io ──► API Gateway :4000
                                         ├─ 8 microservice (identity, job-core, search, application,
                                         │                  notification, admin, support-chat, ai-worker)
                                         └─ backend Express + Socket.IO :5000
Nội bộ, không mở cổng: MariaDB · PostgreSQL · MongoDB · Elasticsearch · Redis · RabbitMQ
```

| File | Vai trò |
| --- | --- |
| `docker-compose.yml` | Toàn bộ stack production |
| `.env.example` | Mô tả mọi biến cấu hình (file thật là `deploy/.env`, không commit) |
| `Caddyfile`, `web.Dockerfile` | Build giao diện React, phục vụ bằng Caddy + HTTPS |
| `backend.Dockerfile` | Image backend Express |
| `scripts/make-env.mjs` | Chạy trên **Windows**: tạo `deploy/.env` (sinh mật khẩu mới, chép khóa AI/email/Cloudinary/PayPal từ `.env` local) |
| `scripts/export-local-data.mjs` | Chạy trên **Windows**: xuất MySQL (XAMPP), PostgreSQL, MongoDB đang dùng |
| `scripts/import-data.sh` | Chạy trên **VPS**: kiểm tra checksum rồi nạp dữ liệu |
| `scripts/backup.sh` | Chạy trên **VPS**: sao lưu định kỳ (cùng định dạng, khôi phục bằng `import-data.sh`) |
| `scripts/check-sso.mjs` | Chạy trên **Windows** (`npm run vps:check-sso`): kiểm tra nút Google/GitHub/Facebook trên tên miền thật (mục 6) |

## 0. Cần chuẩn bị

- **VPS** Ubuntu 22.04/24.04, kiến trúc **x86_64 (amd64)**, tối thiểu **4 GB RAM, 2 vCPU, 30 GB SSD**. Đo thực tế: Elasticsearch khoảng 1 GB, mỗi microservice khoảng 40 MB, cả stack khoảng 2–2,5 GB. Build giao diện React cần thêm khoảng 3 GB, nên VPS 4 GB phải bật swap (bước 2) hoặc build image trên Windows (mục 4b).
- **Tên miền** có bản ghi `A` trỏ về IP VPS, ví dụ `jobfind.example.com`. Nếu chưa có, có thể dùng subdomain miễn phí của DuckDNS (`ten.duckdns.org`). Cần tên miền vì backend chạy chế độ production chỉ đặt cookie phiên `Secure`, và trình duyệt chỉ lưu cookie này qua HTTPS.
- Nhà cung cấp VPS mở cổng **22, 80, 443**.

## 1. Trên máy Windows: tạo cấu hình và xuất dữ liệu

Chạy trong thư mục gốc dự án:

```powershell
# Tạo deploy/.env cho tên miền thật (mật khẩu/secret sinh mới, không in ra màn hình)
npm run vps:env -- jobfind.example.com

# Bật hệ thống local để có XAMPP MySQL + các container dữ liệu, rồi xuất dữ liệu
npm start
npm run vps:export-data
```

`vps:export-data` tạo thư mục `deploy/data-export/<thời-điểm>/` gồm `mysql.sql`, `postgres.dump`, `mongo.archive.gz` và `manifest.json` (chứa SHA-256). Thư mục này chứa toàn bộ dữ liệu người dùng, đã được loại khỏi Git. Elasticsearch không cần xuất: search-service tự dựng lại chỉ mục từ MySQL khi khởi động.

Đẩy code lên GitHub như bình thường (`git push`). `deploy/.env` và `deploy/data-export/` **không** lên Git; hai thứ này sẽ chép bằng `scp` ở bước 3.

## 2. Trên VPS: cài Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER          # đăng xuất SSH rồi đăng nhập lại

# Elasticsearch cần giới hạn mmap cao hơn mặc định
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-elasticsearch.conf
sudo sysctl --system

# Swap 4 GB (bắt buộc với VPS 4 GB nếu build image ngay trên VPS)
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Tường lửa. Mở ĐÚNG cổng SSH của VPS trước khi bật, nếu không sẽ bị khóa ngoài.
# 123HOST dùng cổng 2018 (xem "SSH Command" trong trang quản lý VPS); cổng 22 thì dùng OpenSSH.
sudo ufw allow 2018/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443
sudo ufw enable
```

Ảnh Ubuntu bản *minimal* có thể thiếu công cụ: chạy `sudo apt-get install -y curl git tmux netcat-openbsd ca-certificates` trước khi cài Docker. Nếu VPS dùng cổng SSH khác 22, thêm cổng đó khi chép file: `scp -P 2018 ...`.

## 3. Lấy mã nguồn và chép cấu hình, dữ liệu

Trên VPS:

```bash
git clone https://github.com/nguyentuanthien2384/DALN_JobFind.git
mkdir -p DALN_JobFind/deploy/data-export
```

Repo private: dùng Personal Access Token khi `git clone`, hoặc thêm SSH key của VPS vào GitHub.

Trên Windows (PowerShell, thư mục gốc dự án), thay `user@IP` và `<thời-điểm>`:

```powershell
scp deploy/.env user@IP:~/DALN_JobFind/deploy/.env
scp -r deploy/data-export/<thời-điểm> user@IP:~/DALN_JobFind/deploy/data-export/
```

## 4. Build, nạp dữ liệu, chạy

Mọi lệnh `docker compose` đều chạy **trong thư mục `deploy/`**, vì compose đọc biến từ `deploy/.env` ở đó.

```bash
cd ~/DALN_JobFind/deploy
docker compose build                                   # lần đầu 5–15 phút
sh scripts/import-data.sh data-export/<thời-điểm>      # nạp dữ liệu, xong tự khởi động cả stack
docker compose ps                                      # đợi các dịch vụ báo "healthy"
```

Mở `https://jobfind.example.com`. Lần đầu Caddy cần vài giây để xin chứng chỉ; xem tiến trình bằng `docker compose logs -f web`.

`import-data.sh` dừng mọi ứng dụng trong lúc nạp. Nếu MySQL/PostgreSQL/MongoDB trên VPS đã có dữ liệu, script sẽ **từ chối** chạy, trừ khi bạn thêm `--force` (xóa rồi nạp lại).

### 4b. VPS yếu: build trên Windows rồi chép image lên

Docker Desktop trên Windows build image amd64, chạy được trên VPS x86_64 (không dùng được cho VPS ARM).

```powershell
cd deploy
docker compose build
docker save -o jobfind-images.tar jobfind/microservices:latest jobfind/backend:latest jobfind/web:latest
scp jobfind-images.tar user@IP:~/
```

Trên VPS:

```bash
docker load -i ~/jobfind-images.tar && rm ~/jobfind-images.tar
cd ~/DALN_JobFind/deploy
docker compose pull --ignore-buildable                 # tải các image hạ tầng
sh scripts/import-data.sh data-export/<thời-điểm>
```

Các cờ `REACT_APP_*` được đóng vào giao diện **lúc build**, nên `deploy/.env` trên Windows phải trùng với file trên VPS.

## 5. Kiểm tra sau khi chạy

```bash
docker compose ps                              # 16–17 dịch vụ "running"/"healthy"
curl -sI https://jobfind.example.com | head -1 # HTTP/2 200
docker compose logs --tail 50 api-gateway backend
```

Đăng nhập bằng tài khoản admin trong dữ liệu đã nạp, rồi thử tìm việc, chat và chatbot.

## 6. Cho mọi người đăng nhập bằng Google, GitHub, Facebook

Ba nút này đi qua Auth0 (connection `google-oauth2`, `github`, `facebook`). Bất kỳ ai có tài khoản Google/GitHub/Facebook đều đăng nhập được từ máy của họ. Yêu cầu duy nhất là có tên miền HTTPS: backend production tắt các nút này khi chạy HTTP theo IP.

1. **Cấu hình**: `npm run vps:env -- <tên-miền>` chép sẵn `OIDC_AUTH0_*` từ `backend/.env`. Lệnh này cũng in ra đúng URL callback cần thêm ở bước 2.
2. **Auth0 Dashboard** → *Applications* → application của JobFind → *Settings* → **Allowed Callback URLs**: thêm `https://<tên-miền>/api/auth/sso/auth0/callback`. Các URL cách nhau bằng dấu phẩy; giữ lại URL `http://localhost:4000/...` để vẫn chạy được ở máy dev. Bấm *Save*.
3. **Auth0 Dashboard** → *Authentication* → *Social*: mở từng connection Google, GitHub, Facebook → tab *Applications* → bật application của JobFind.
4. Deploy (bước 4). Nếu VPS đã nạp dữ liệu từ trước ngày 05/10/2026, chạy thêm migration xác thực (lệnh *Cập nhật code mới* ở mục Vận hành) để có cột `AuthSignupRequests.emailVerified`. Sau đó kiểm tra từ máy Windows:

   ```powershell
   npm run vps:check-sso -- https://<tên-miền>
   ```

   Script đi từ JobFind → Auth0 → trang đăng nhập của từng nhà cung cấp, dừng trước callback nên không tạo tài khoản hay phiên nào. Khi có lỗi, script chỉ rõ cần sửa gì: URL callback chưa có trong Auth0, connection chưa bật cho application, hoặc nút đang tắt trong `deploy/.env`. Script cũng chạy được ở máy dev: `npm run vps:check-sso -- http://localhost:4000`.

Người dùng sẽ thấy:

- **Lần đầu**: hoàn tất đăng ký (vai trò, họ tên, email, số điện thoại, mật khẩu). Nếu nhà cung cấp không gửi email đã xác minh (GitHub qua developer key thường như vậy), người dùng tự nhập email.
- **Email đã xác minh trùng tài khoản JobFind có sẵn**: tự liên kết và đăng nhập vào tài khoản đó. Email chưa xác minh không bao giờ được gộp; người đó liên kết trong *Bảo mật và đăng nhập* sau khi đăng nhập bằng mật khẩu.
- **Từ lần sau**: bấm nút là vào thẳng.

Đang dùng **developer keys** của Auth0 (không tự tạo app Google/GitHub/Meta). Ai cũng đăng nhập được, nhưng màn hình đồng ý của nhà cung cấp hiện tên Auth0 thay vì JobFind, GitHub thường không gửi email đã xác minh, và Auth0 khuyến nghị thay bằng khóa riêng khi chạy chính thức. Khi có khóa riêng, chỉ cần dán vào connection tương ứng trong Auth0; không phải đổi code hay `deploy/.env`.

## Vận hành hằng ngày

| Việc | Lệnh (trong `deploy/`) |
| --- | --- |
| Cập nhật code mới | `git pull && docker compose build && docker compose run --rm backend node /app/scripts/migrate-auth.mjs --from-env && docker compose up -d` (migration xác thực chỉ thêm cột/bảng còn thiếu, chạy lại an toàn; nên `sh scripts/backup.sh` trước) |
| Đổi biến trong `.env` | `docker compose up -d` (chỉ tạo lại dịch vụ bị ảnh hưởng) |
| Đổi cờ `REACT_APP_*` | `docker compose up -d --build web` |
| Xem log | `docker compose logs -f <dịch-vụ>` |
| Khởi động lại một dịch vụ | `docker compose restart <dịch-vụ>` |
| Dừng toàn bộ (giữ dữ liệu) | `docker compose down` |
| Sao lưu ngay | `sh scripts/backup.sh` → `deploy/backups/<thời-điểm>/` |
| Khôi phục bản sao lưu | `sh scripts/import-data.sh backups/<thời-điểm> --force` |
| Xem hàng đợi RabbitMQ | `docker compose exec rabbitmq rabbitmqctl list_queues` |

> [!CAUTION]
> **Không** chạy `docker compose down -v`: lệnh này xóa volume, tức là xóa toàn bộ CSDL và chứng chỉ HTTPS.

**Sao lưu tự động lúc 3 giờ sáng** (`crontab -e`), giữ 14 ngày:

```
0 3 * * * cd $HOME/DALN_JobFind/deploy && sh scripts/backup.sh >> backups/backup.log 2>&1
```

Nên định kỳ chép thư mục `deploy/backups/` ra ngoài VPS (`scp` về máy, Google Drive...).

## Chạy chung VPS với ứng dụng khác (ví dụ SCAP)

Caddy `web` của JobFind giữ cổng 80/443 và có thể phục vụ thêm tên miền của ứng dụng khác trên cùng VPS mà không phải đổi gì trong JobFind:

```
Internet ──► Caddy "web" :80/:443 ─┬─ SITE_ADDRESS ───────► JobFind (như trên)
                                   └─ tên miền ứng dụng kia ─► mạng vps-shared-edge ─► Caddy của ứng dụng đó
```

- Mạng `vps-shared-edge` (`172.30.47.0/28`) chỉ có Caddy JobFind (`172.30.47.2`, cố định) và Caddy của ứng dụng kia. Ứng dụng kia **không** vào mạng nội bộ của JobFind nên không thấy MariaDB/MongoDB/Redis…
- Volume `vps-shared-sites` được mount chỉ đọc vào `/etc/caddy/sites`; `Caddyfile` có `import sites/*.caddy`. Ứng dụng kia tự ghi file site của mình vào volume, kiểm tra cú pháp rồi `caddy reload` (SCAP: `deploy/remote-deploy.sh`). Volume rỗng thì Caddy chỉ ghi cảnh báo, JobFind không đổi.
- `Caddyfile` được mount từ repo, nên sửa Caddyfile chỉ cần `docker compose up -d web`, không phải build lại giao diện React.

Áp dụng trên VPS đang chạy (JobFind gián đoạn vài giây khi tạo lại container `web`):

```bash
cd ~/DALN_JobFind && git pull && cd deploy
docker compose up -d web
docker network inspect vps-shared-edge --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"
"}}{{end}}'
```

Sau đó deploy ứng dụng kia. Gỡ một site: xóa file của nó trong volume rồi `docker compose exec web caddy reload --config /etc/caddy/Caddyfile`. Khi chạy `docker compose down`, Docker có thể báo không xóa được mạng `vps-shared-edge` vì ứng dụng kia vẫn đang dùng; dữ liệu JobFind không bị ảnh hưởng.

## Những điểm cần biết

- **Không đổi mật khẩu CSDL/RabbitMQ trong `.env` sau lần chạy đầu.** MariaDB, PostgreSQL và RabbitMQ chỉ đọc các mật khẩu này khi tạo volume lần đầu. Đổi trong `.env` mà không đổi trong CSDL thì dịch vụ sẽ không kết nối được. `JWT_SECRET` và `INTERNAL_SECRET` thì đổi được bất cứ lúc nào; người dùng chỉ phải đăng nhập lại.
- **MariaDB được cấu hình giống XAMPP**: `lower_case_table_names=1`, múi giờ `+07:00`, `sql_mode` không strict, `utf8mb4_general_ci`. Thiếu các tùy chọn này, Linux sẽ phân biệt hoa/thường tên bảng (Sequelize gọi `AuthSessions`, còn bảng thật tên `authsessions`) và báo lỗi "table doesn't exist".
- **Tài khoản demo** trong dữ liệu (mật khẩu `123456`, `Demo@123456`) ai cũng đoán được. Đổi mật khẩu tài khoản admin trước khi công bố link.
- **Email**: production bỏ qua địa chỉ mẫu (ví dụ `@example.com`) thay vì chuyển hướng như khi chạy local.
- **`SCHEDULED_JOBS_ENABLED=false`** mặc định: tắt email gợi ý việc làm tự động, reset hạn mức xem CV hằng ngày và đối soát PayPal. Chỉ bật khi đã dùng dữ liệu thật.
- **Đăng nhập Google/GitHub/Facebook**: xem mục 6. Nếu dùng Google/GitHub trực tiếp (không qua Auth0), đăng ký redirect URI `https://<tên-miền>/api/auth/sso/google/callback` hoặc `.../github/callback` ở nhà cung cấp, rồi đặt `OIDC_GOOGLE_ENABLED=true` hoặc `OAUTH_GITHUB_ENABLED=true`.
- **Giới hạn tần suất theo từng người**: mọi request đi qua Caddy (`172.30.250.10`) rồi API Gateway (`172.30.250.11`). Gateway và backend chỉ tin IP người dùng do đúng hai địa chỉ này chuyển xuống (`TRUST_PROXY`). Nhờ vậy, giới hạn đăng nhập sai, SSO và đăng ký được tính riêng cho từng người, không tính chung cho cả hệ thống. Đừng đổi hai IP cố định này trong `docker-compose.yml`.
- **Chưa có tên miền?** Chạy `npm run vps:env -- <IP-VPS>` để có cấu hình HTTP theo IP. Cách này chỉ để xem thử: không có HTTPS thì trình duyệt không lưu cookie phiên, nên đăng nhập không bền.
- **Docker và ufw**: cổng do Docker publish đi vòng qua luật ufw. Ở đây chỉ Caddy publish cổng (80/443), mọi kho dữ liệu đều không publish nên không lộ ra ngoài.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp / cách xử lý |
| --- | --- |
| Không vào được HTTPS, log `web` báo lỗi ACME | DNS chưa trỏ đúng IP hoặc cổng 80/443 bị chặn. Kiểm tra `dig +short <tên-miền>` và tường lửa của nhà cung cấp |
| `/api` trả 502 | API Gateway chưa sẵn sàng: `docker compose ps`, `docker compose logs api-gateway` |
| Đăng nhập xong bị đăng xuất khi tải lại trang | Đang chạy HTTP, hoặc `PUBLIC_URL` khác địa chỉ đang mở |
| `elasticsearch` thoát với mã 137 | Thiếu RAM: thêm swap hoặc nâng VPS. Kiểm tra lại `vm.max_map_count` |
| Build `web` bị kill (137) | Thiếu RAM khi build React: bật swap hoặc build trên Windows (mục 4b) |
| Nút Google/GitHub/Facebook bị mờ hoặc báo lỗi sau khi chọn tài khoản | Chạy `npm run vps:check-sso -- https://<tên-miền>` và làm theo dòng `LOI` (thường là thiếu URL callback trong Auth0) |
| Chatbot/AI không trả lời | Kiểm tra `ANTHROPIC_API_KEY`, `COMPOSE_PROFILES=ai`, `docker compose logs ai-worker support-chat-service` |
