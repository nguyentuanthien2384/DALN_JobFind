# JobFind: triển khai bản vá Authentication / Authorization / Google SSO

> Bản vá dành riêng cho `DALN_JobFind-main(3).zip`. Gói ZIP chỉ chứa file đã **thêm mới / sửa đổi**, không chứa toàn bộ dự án. Bản vá chưa được kiểm thử kết nối MySQL, Google hoặc trình duyệt thật trong môi trường tạo gói; phải thử trên staging trước khi đưa lên production.

## Thiết kế và những giới hạn rõ ràng

- **Giữ nguyên** `backend/src/middlewares/authorize.js`, role trong `Account` và kiểm tra company/tenant: Google chỉ xác minh danh tính. Không cấp role qua email hay claim bên Google.
- Đăng nhập số điện thoại/mật khẩu vẫn qua `POST /api/login` hoặc `/api/auth/login`. Backend phát access JWT chứa `sid` (session family), lưu hash của refresh token ngẫu nhiên trong `AuthSessions` và đặt cookie HttpOnly. Frontend giữ access token **chỉ trong RAM**, còn `token_user` trong localStorage là **marker không phải JWT** để giữ tương thích các route guard cũ.
- Refresh `POST /api/auth/refresh` xoay vòng refresh token; dùng lại refresh token đã xoay sẽ thu hồi cả family. Logout server `POST /api/auth/logout`, logout tất cả thiết bị `POST /api/auth/logout-all` (cần Bearer). Gateway và monolith tra DB để chặn ngay token của session đã thu hồi; Socket.IO kiểm tra khi kết nối và định kỳ mỗi 30 giây.
- Google SSO dùng OIDC Authorization Code + PKCE S256 + state + nonce; backend xác minh ID token qua thư viện `openid-client` v6. Callback không đưa access/refresh token vào URL. Chỉ identity `(issuer, sub)` đã được liên kết sau khi đăng nhập local mới có thể SSO; **chưa tự tạo tài khoản hoặc gộp tài khoản trùng email**. SAML, Microsoft Entra, logout toàn IdP, UI liệt kê/huỷ từng liên kết và MFA chưa thuộc bản vá này.
- Phần auth chạy qua **API Gateway (thường :4000)**; backend trực tiếp thường :5000. Các endpoint auth đi qua proxy HTTP nguyên bản để giữ `Set-Cookie` và `Location`. Các dịch vụ còn lại tiếp tục qua proxy và cơ chế authorization hiện có.

## 1. Áp dụng bản vá

Giải nén gói **vào thư mục gốc DALN**, sao lưu database và các file sẽ bị ghi đè trước khi làm. Gói có đúng cấu trúc `backend/...`, `frontend/...`, `microservices/...`, `docs/...`; không giải nén vào một thư mục con `DALN_JobFind-main` khác. Không tự động copy file `.env` hiện có: gói chỉ bổ sung các giá trị mẫu trong `.env.example`.

Tại môi trường có mạng, cài dependency OIDC **chỉ ở backend**, tạo lockfile đồng bộ (không dùng `--no-save`):

```bash
cd backend
npm install 'openid-client@^6'
```

**Bắt buộc dùng Node >=22.12** cho cách backend `require('openid-client')` v6. Kiểm tra `node -v` trên host và trong container thực tế. Nếu dùng Docker, cập nhật Node trong image/backend build theo điều kiện trên; không chỉ cập nhật máy phát triển. Trong môi trường tạo bản vá này npm registry không truy cập được, nên **`openid-client` chưa có trong `backend/package.json` / `backend/package-lock.json` của ZIP**; `npm install` bên trên là bước bắt buộc trước khi bật SSO hoặc chạy backend (module chỉ được `require` khi có request SSO).

## 2. Database trước khi bật đăng nhập

Backend và Gateway phải kết nối **cùng một database MySQL**. Migration mới `backend/src/migrations/migrationzzzzzzz-auth-sessions-sso.js` thêm `AuthSessions`, `AuthIdentities`, `OidcTransactions`; không thay đổi bảng `Users`, `Accounts` và RBAC. Sao lưu database trước:

```bash
cd backend
npx sequelize-cli db:migrate
```

Với database tạo từ SQL thủ công đã có bảng nhưng chưa có lịch sử `SequelizeMeta`, **không chạy toàn bộ các migration cũ một cách mù quáng**. Đối chiếu `SequelizeMeta`, thực hiện migration mới trên một bản sao staging bằng quy trình migration phù hợp của dự án rồi xác minh đủ 3 bảng và unique index `(issuer, subject)`. Không chạy `db:migrate:undo` cho bản vá khi đã có user SSO/session; `down` sẽ xoá toàn bộ dữ liệu liên kết và phiên.

Vì middleware Gateway mới tra `AuthSessions`, **phải migrate DB trước khi deploy backend/Gateway/frontend mới**. Nếu rolling deploy, đặt `AUTH_ALLOW_LEGACY_TOKENS=true` tạm thời **đồng thời** cho backend và Gateway trong thời gian bản frontend cũ còn phát JWT không có `sid`; sau đó tắt và yêu cầu phiên cũ đăng nhập lại. Production mặc định không cho legacy JWT nếu bỏ biến.

## 3. Biến môi trường

Thêm các dòng có tên tương ứng từ `.env.example` vào `.env` **từng service**; giữ nguyên giá trị kết nối DB/JWT cũ. Không commit `.env` hoặc Google client secret.

```dotenv
# backend/.env
URL_REACT=http://localhost:3000
AUTH_ALLOW_LEGACY_TOKENS=false
OIDC_GOOGLE_ENABLED=false
OIDC_GOOGLE_ISSUER=https://accounts.google.com
OIDC_GOOGLE_CLIENT_ID=<Google OAuth Client ID>
OIDC_GOOGLE_CLIENT_SECRET=<Google OAuth Client Secret>
OIDC_GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/sso/google/callback

# microservices/.env
CORS_ORIGIN=http://localhost:3000
AUTH_ALLOW_LEGACY_TOKENS=false

# frontend/.env
REACT_APP_BACKEND_URL=http://localhost:4000
REACT_APP_GOOGLE_SSO_ENABLED=false
```

Thay giá trị `<...>` bằng thông tin thật của bạn. Trong Google Cloud Console, tạo OAuth Client loại **Web application**, thêm `http://localhost:3000` vào Authorized JavaScript origins khi cần và thêm **chính xác** `http://localhost:4000/api/auth/sso/google/callback` vào Authorized redirect URIs. Dùng URL public của Gateway trong `OIDC_GOOGLE_REDIRECT_URI`, **không dùng** URL nội bộ backend `:5000`. Cấu hình OAuth consent screen, test users và publish app theo chính sách Google nếu cần. Khi đủ DB, dependency, OAuth credentials thì đặt `OIDC_GOOGLE_ENABLED=true`, `REACT_APP_GOOGLE_SSO_ENABLED=true` rồi **build lại frontend**.

Production cần **HTTPS** cho frontend và API, `Secure` cookie và domain **cùng site** (ví dụ `app.example.com` và `api.example.com`; khác origin nhưng cùng site). `SameSite=Lax` cố ý chặn third-party cookie; nếu frontend deploy tại `*.vercel.app` còn API tại `*.onrender.com`, phiên refresh qua fetch có thể không hoạt động: cấu hình custom domains/proxy cùng site trước, không đổi bừa thành `SameSite=None`. Nếu frontend và Gateway đặt **cùng origin**, chỉnh `REACT_APP_BACKEND_URL` trỏ chính origin đó. Đồng bộ `URL_REACT` backend và `CORS_ORIGIN` Gateway, gồm scheme/host/port chính xác. Không đặt `OIDC_GOOGLE_CLIENT_SECRET` trong `REACT_APP_*`.

## 4. Kiểm tra luồng thực tế

1. Sau migration, khởi động backend/Gateway/frontend ở môi trường staging và đăng nhập số điện thoại. Trong DevTools Network, phản hồi `/api/login` phải có `Set-Cookie: jobfind_rt=...; HttpOnly; SameSite=Lax` trên local (production là `__Host-jobfind_rt` và có `Secure`); JSON trả `token` JWT, `user` và `errCode:0`. LocalStorage `token_user` chỉ có dạng `jf-session:...`, **không chứa JWT**.
2. Reload: `POST /api/auth/refresh` dùng cookie, trả access JWT mới và một `Set-Cookie` mới. Gọi API role-specific và mở chat/Socket.IO xác nhận còn hoạt động. Ở frontend, sau refresh profile luôn do DB xác nhận.
3. Refresh hai lần bằng **cùng cookie cũ**: lần đầu thành công, lần thứ hai `401`, session family cũ bị thu hồi. Test riêng tuần tự và đồng thời, và không sử dụng kết quả stale. Logout qua UI -> `204`, refresh sau logout -> `401`, token access cũ vào API/Gateway -> `401`; socket cũ bị ngắt trong tối đa 30 giây.
4. Để thử Google: đăng nhập local trước, bấm **Liên kết Google** ở menu hồ sơ, hoàn tất consent. Sau đó logout và đăng nhập bằng Google, callback phải về `/login?sso=success` và khôi phục phiên rồi về trang hợp lệ. Gmail chưa liên kết phải báo `sso=not-linked` (không tự gộp với user hiện có). Kiểm thử callback thiếu/sai/replay `state`, thiếu browser cookie, sai `nonce`/`issuer`/`audience`, và tài khoản local bị khoá; tất cả phải bị chặn.
5. Kiểm tra trên từng role `ADMIN`, `COMPANY`, `EMPLOYER`, `CANDIDATE` cùng điều kiện company chưa duyệt/đã khoá. Quyền sau SSO vẫn do DB hiện tại quyết định. Khi đổi mật khẩu hoặc khoá tài khoản, tất cả session cũ phải bị thu hồi.
6. Kiểm tra đa tab và browser: refresh một tab khi tab khác đang mở, logout tab A khiến tab B mất quyền; thử trình duyệt không hỗ trợ Web Locks để xác nhận UX/giới hạn của concurrent refresh. Audit giới hạn tốc độ login/refresh và tuyệt đối không log refresh cookie, authorization code, secret hay ID token.

### Lệnh kiểm thử sau khi cài dependency

```bash
# Test cấu trúc migration không cần npm
cd backend && node --test tests/auth-migration.node.test.cjs
# Jest backend: test service và kiểm tra hồi quy các route
npm test -- --runTestsByPath tests/services/authSessionService.test.js tests/services/oidcService.test.js tests/utils/authAccess.test.js
cd ../microservices && npm test -- tests/account-store.test.js
cd ../frontend && CI=true npm run test:unit -- --runTestsByPath src/auth/authClient.test.js src/axios.test.js src/container/login/Login.test.js
```

Chạy toàn bộ backend/frontend/microservices tests và E2E/smoke của repository nữa trước khi merge. **Không coi test mock là chứng nhận tính an toàn**: cần MySQL thật, Redis/rate limiter, browser cross-origin thật và Google test client trên staging. Chạy thêm dependency audit và review Google OAuth scope/consent.

## 5. Rollback và vận hành

- Nếu callback hoặc cookie lỗi: tắt `OIDC_GOOGLE_ENABLED` ở backend và `REACT_APP_GOOGLE_SSO_ENABLED` ở frontend, giữ local login, chẩn đoán redirect URI/cookie/HTTPS/Origin/Gateway trước khi bật lại.
- Khi rollback ứng dụng về build cũ, JWT/session cơ chế cũ **không có** logic thu hồi phiên và có thể tiếp tục sử dụng JWT cũ đến expiry. Xem xét vô hiệu hóa session và buộc đăng nhập lại; **không xoá** 3 bảng auth ngay. Nếu dùng compatibility flag, chỉ bật ngắn hạn sau khi đánh giá rủi ro.
- Database/session dùng nhiều replica: cùng MySQL, clock đồng bộ, transaction SELECT FOR UPDATE. Lưu ý refresh dùng lại token cũ do hai request không có Web Locks có thể revoke cả family; frontend dùng singleflight + Web Locks khi được browser hỗ trợ. Không dùng đây làm thay thế quản lý session trên thiết bị không hỗ trợ Web Locks.
- Không bật thêm provider hay auto-provision chỉ dựa trên email: cần identity linking/provisioning policy và test riêng. Bản vá này chưa hỗ trợ SAML hoặc toàn bộ OIDC federation logout.
