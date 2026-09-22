# Authentication, authorization và đăng nhập liên kết của JobFind

## Trạng thái tích hợp

Mã trong ZIP đã được đối chiếu và đồng bộ với dự án, sau đó sửa lỗi tích hợp và bổ sung kiểm thử. Xác thực chạy tại backend; API Gateway chuyển tiếp cookie và redirect nguyên vẹn. Quyền nghiệp vụ lấy từ tài khoản/công ty hiện tại trong MySQL, không lấy quyền do Google hoặc trình duyệt khai báo.

Google SSO **chưa bật** vì chưa có Google OAuth Client. Đăng nhập số điện thoại/mật khẩu hoạt động độc lập. Trang đăng nhập luôn hiển thị nút Google và trạng thái; nút chỉ bấm được khi `/api/auth/providers` xác nhận backend sẵn sàng. Nếu chưa bật, giao diện hướng dẫn dùng số điện thoại/mật khẩu; lỗi kiểm tra có nút thử lại. Không cần cờ riêng hoặc secret trong frontend.

Trang `/login` nhận **email hoặc số điện thoại**, có nhãn và tự điền mật khẩu, hiện/ẩn mật khẩu, kiểm tra trường trống, lỗi trong form, chặn gửi trùng và trạng thái chờ xác thực liên kết. **Ghi nhớ đăng nhập** tạo cookie lâu dài, phiên tối đa 14 ngày; bỏ chọn dùng cookie phiên và hạn tuyệt đối 8 giờ. Trình duyệt có tính năng khôi phục phiên có thể giữ cookie phiên sau khi đóng cửa sổ, nên không cam kết đóng cửa sổ là đăng xuất. Lựa chọn này được giữ khi refresh và qua luồng SSO; thời hạn không được kéo dài sau mỗi refresh. Mở menu tài khoản → **Bảo mật và đăng nhập** để quản lý Google/GitHub/Auth0 và các phiên.

Trang `/register` dùng bố cục gọn hai bước: chọn Ứng viên/Nhà tuyển dụng và nhập họ tên/email, rồi số điện thoại và mật khẩu. Có quay lại giữ dữ liệu, hiện/ẩn và xác nhận mật khẩu, lỗi từng trường và chặn gửi trùng. Mật khẩu mới cần ít nhất 8 ký tự Unicode, tối đa 72 byte UTF-8 (giới hạn bcrypt), cho phép dấu, khoảng trắng và ký tự đặc biệt; mật khẩu cũ vẫn đăng nhập được. Chính sách áp dụng ở cả frontend/backend khi tạo, đổi và đặt lại mật khẩu. Tạo xong tự đăng nhập; nếu cấp phiên lỗi, trang xác nhận đã tạo và dẫn sang đăng nhập. Không upload ảnh mặc định.

Google/GitHub/Auth0 đã có luồng **đăng ký mới**: xác thực nhà cung cấp → cookie đăng ký HttpOnly 10 phút → bổ sung họ tên, số điện thoại, mật khẩu JobFind và vai trò công khai → tạo người dùng, tài khoản và danh tính liên kết trong cùng transaction. Email được lấy từ nhà cung cấp đã xác minh, không cho trình duyệt sửa. Yêu cầu đăng ký chỉ dùng một lần; không đưa token/mã đăng ký vào URL. Email đã tồn tại không được tự gộp: người dùng cần đăng nhập bằng mật khẩu rồi liên kết trong trang bảo mật. Đăng ký local chưa xác minh quyền sở hữu email bằng thư; xác minh email từ nhà cung cấp chỉ áp dụng luồng đăng ký liên kết.

Các ZIP mới ngày 22/09/2026 được dùng làm tham khảo chức năng: React/Express (email login, đăng ký và liên kết), NextAuth (ghi nhớ phiên, Google/GitHub), Auth0 (nhà cung cấp OIDC). Giữ React + Express + MySQL hiện có; không cài song song Next.js/Prisma hoặc đưa Auth0 Management Client Secret vào trình duyệt. Mã mẫu giả lập token và lưu refresh token trong localStorage không được nhập vào ứng dụng.

## Chức năng

- Access JWT hạn ngắn ở bộ nhớ trình duyệt; cookie refresh HttpOnly, SameSite=Lax (Secure khi production). `token_user` trong localStorage chỉ là marker phiên mới, không chứa JWT.
- Refresh token ngẫu nhiên chỉ lưu SHA-256 trong MySQL, xoay vòng khi gia hạn. Dùng lại token cũ thu hồi toàn bộ phiên. Phiên có hạn tuyệt đối 8 giờ hoặc 14 ngày theo lựa chọn ghi nhớ; JWT mặc định 15 phút.
- Chuẩn hóa email và chặn đăng ký trùng email/số điện thoại bằng khóa InnoDB trong transaction. Tạo `Users` + `Accounts` đồng thời, rollback nếu một bước lỗi. Dữ liệu email trùng từ trước không bị xóa/gộp; đăng nhập email mơ hồ bị từ chối, các tài khoản đó vẫn dùng số điện thoại. Cập nhật email hồ sơ cũng kiểm tra trùng bằng cùng cơ chế khóa.
- Tạo/gia hạn/thu hồi phiên dùng khóa tài khoản trong transaction, tránh phiên mới lọt qua yêu cầu đăng xuất đồng thời. Đổi/reset mật khẩu và khóa tài khoản commit cùng thu hồi phiên.
- Backend, Gateway và Socket.IO kiểm tra phiên bị thu hồi. Kết nối chat hết hạn JWT sẽ gia hạn và kết nối lại; socket kiểm tra thu hồi định kỳ tối đa 30 giây.
- Trang **Bảo mật và đăng nhập** tại `/account/security`, có trong menu hồ sơ của mọi vai trò: xem phiên hiện tại/phiên khác, đăng xuất từng phiên/tất cả, xem và hủy liên kết Google.
- Phiên ghi nhận trình duyệt/hệ điều hành, thời điểm đăng nhập ban đầu và lần gia hạn gần nhất. Xoay vòng token giữ nguyên thời điểm bắt đầu và hạn tuyệt đối; cookie hết hạn theo thời gian còn lại của phiên.
- Lịch sử bảo mật của chính người dùng, phân trang 20 sự kiện: đăng nhập, liên kết/hủy liên kết, thu hồi phiên, dùng lại refresh token, đổi mật khẩu/trạng thái tài khoản. API không nhận `userId` từ trình duyệt để lựa chọn chủ sở hữu.
- Liên kết/hủy liên kết Google yêu cầu mật khẩu JobFind hiện tại. Callback liên kết ràng buộc với phiên và cookie trình duyệt đã bắt đầu; phiên đã đăng xuất/đổi tài khoản không thể hoàn tất liên kết.
- Google dùng Authorization Code, PKCE S256, state và nonce; `openid-client` kiểm tra token. Liên kết bằng `(issuer, sub)`, không tự gộp tài khoản theo email và không cấp quyền từ Google.
- Trình duyệt chờ xác minh quyền trước khi hiển thị trang bảo vệ; lỗi mạng có nút thử lại. Yêu cầu ghi thất bại vì hết phiên không tự gửi lại để tránh dữ liệu trùng.
- JWT sai/hết hạn hoặc người dùng đã bị xóa trả HTTP 401; thiếu quyền nghiệp vụ vẫn trả 403. API xác thực có no-store, no-referrer, nosniff, chống nhúng và CSP giới hạn nội dung API.
- OTP dùng `crypto.randomInt`, chỉ giữ HMAC trong bộ nhớ, so sánh bằng `timingSafeEqual`, không in mã ra log. Bcrypt tạo salt riêng cho từng lần băm. Khi email chưa sẵn sàng/gửi thất bại, không báo đã gửi và hủy mã vừa tạo.

## Cài đặt và cập nhật database

Dùng Node **22.12 trở lên**. `openid-client` đã có trong package và lockfile của backend.

```powershell
npm ci --prefix backend
npm ci --prefix frontend
npm ci --prefix microservices
npm run auth:migrate
npm start
```

`auth:migrate` chỉ áp dụng các migration xác thực, phù hợp cả database đã nhập từ SQL mà chưa có lịch sử migration cũ. Công cụ sao lưu MySQL vào `.local/backups/auth-<timestamp>/mysql.sql` cùng bằng chứng kiểm tra trước khi tạo bảng, ghi nhận vào `SequelizeMeta`, không chạy lại migration nghiệp vụ cũ. Nếu bộ ba bảng gốc bị thiếu một phần thì dừng để kiểm tra.

Các bảng thêm: `AuthSessions`, `AuthIdentities`, `OidcTransactions`, `AuthSecurityEvents`. Migration thứ hai bổ sung ràng buộc phiên liên kết và collation phân biệt hoa/thường cho danh tính OIDC. Migration thứ ba bổ sung thông tin thiết bị, thời gian phiên, email đã xác minh/tên hiển thị khi liên kết và nhật ký; có thể chạy tiếp khi một phần DDL đã hoàn tất. Giữ các bảng khi rollback ứng dụng.

Migration thứ tư `migrationzzzzzzzzzz-auth-registration-options.js` bổ sung `rememberMe`, `AuthSignupRequests` và `AuthRegistrationLocks`; chạy lại an toàn, giữ nguyên dữ liệu cũ. Phải chạy migration trước khi khởi động backend mới. Các hàng khóa là SHA-256 của định danh chuẩn hóa, không chứa email/số điện thoại trực tiếp.

Backend và Gateway phải dùng cùng MySQL, `JWT_SECRET`, issuer và audience. `AUTH_ALLOW_LEGACY_TOKENS=false` mặc định ở mọi môi trường: người dùng JWT cũ cần đăng nhập lại. Chỉ bật `true` ở cả hai nơi nếu chủ động cần giai đoạn chuyển tiếp; JWT cũ không có khả năng thu hồi theo phiên.

## Cấu hình Google trên máy này

1. Trong [Google Cloud Console](https://console.cloud.google.com/), chọn/tạo project, cấu hình Google Auth Platform/consent screen và thêm tài khoản thử nếu đang ở chế độ Testing.
2. Tạo OAuth Client loại **Web application**. Đăng ký Authorized redirect URI chính xác: `http://localhost:4000/api/auth/sso/google/callback`.
3. Điền trong **backend/.env** (không commit hoặc gửi Client Secret vào chat):

```dotenv
URL_REACT=http://localhost:3000,http://localhost:3001
AUTH_FRONTEND_ORIGIN=http://localhost:3001
AUTH_ALLOW_LEGACY_TOKENS=false
OIDC_GOOGLE_ENABLED=true
OIDC_GOOGLE_ISSUER=https://accounts.google.com
OIDC_GOOGLE_CLIENT_ID=CLIENT_ID_TU_GOOGLE
OIDC_GOOGLE_CLIENT_SECRET=CLIENT_SECRET_TU_GOOGLE
OIDC_GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/sso/google/callback
```

4. Kiểm tra `frontend/.env`: `REACT_APP_BACKEND_URL=http://localhost:4000`. Gateway phải cho phép origin `http://localhost:3001` (trình khởi chạy sử dụng cấu hình local tương ứng).
5. Khởi động lại bằng `npm run dev:stop`, `npm start`. Tài khoản đã tồn tại: đăng nhập local, vào **Bảo mật và đăng nhập**, nhập mật khẩu và chọn **Liên kết tài khoản Google**.
6. Sau khi liên kết có thể đăng nhập bằng Google. Người mới có email được Google xác minh sẽ chuyển sang hoàn tất đăng ký. Hủy consent, email chưa xác minh hoặc callback hết hạn sẽ hiện thông báo tương ứng.

`AUTH_FRONTEND_ORIGIN` phải nằm trong `URL_REACT`, giúp callback về đúng cổng 3001. Không đưa Client Secret vào biến `REACT_APP_*`.

Production: frontend/API dùng HTTPS và tên miền cùng site; SameSite=Lax không phục vụ cookie bên thứ ba khác site. Đổi redirect URI sang địa chỉ HTTPS public của Gateway và đăng ký chính xác tại Google. Không dùng địa chỉ backend nội bộ. Google issuer cố định là `https://accounts.google.com`.

Tham chiếu: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [openid-client authorizationCodeGrant](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md).

## Bật GitHub và Auth0 khi có cấu hình

Mẫu đầy đủ nằm trong `backend/.env.example`; các nhà cung cấp mặc định tắt. Không sửa `.env` bằng khóa lấy từ ZIP. GitHub/Auth0 chỉ hiện nút khi backend xác nhận đã cấu hình; Google vẫn có thông báo trạng thái trên trang đăng nhập.

GitHub: tạo OAuth App, đặt callback `http://localhost:4000/api/auth/sso/github/callback`, điền `OAUTH_GITHUB_ENABLED=true`, `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_GITHUB_REDIRECT_URI` trong backend/.env. Luồng yêu cầu `read:user user:email`, dùng state một lần, cookie ràng buộc trình duyệt và PKCE S256; xác định người dùng bằng numeric ID, lấy email đã verified từ `/user/emails` kể cả khi ẩn email công khai. Token GitHub chỉ dùng tại backend khi callback, không gửi vào frontend hoặc lưu làm phiên JobFind. [Tài liệu OAuth GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [API email GitHub](https://docs.github.com/en/rest/users/emails).

Auth0: tạo application loại **Regular Web Application**, dùng token endpoint authentication `client_secret_post`; đặt Allowed Callback URLs là `http://localhost:4000/api/auth/sso/auth0/callback`. Điền `OIDC_AUTH0_ENABLED=true`, `OIDC_AUTH0_ISSUER=https://TENANT.REGION.auth0.com/` (giữ dấu `/` cuối), `OIDC_AUTH0_CLIENT_ID`, `OIDC_AUTH0_CLIENT_SECRET`, `OIDC_AUTH0_REDIRECT_URI` trong backend/.env. Có thể dùng custom domain HTTPS. Backend thực hiện Authorization Code + PKCE, kiểm tra discovery issuer, nonce và chữ ký ID token. Đăng ký mới yêu cầu `email_verified=true`; không đọc quyền ADMIN/company từ claim nhà cung cấp. Không cần Auth0 Management API hay secret ở React. [Luồng Auth0 với PKCE](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce).

Sau khi cấu hình, khởi động lại và thử đăng ký mới, đăng nhập lại, liên kết tài khoản cũ, hủy và lỗi callback với tài khoản thử của chính bạn. Địa chỉ callback production phải chuyển sang HTTPS và đăng ký chính xác ở nhà cung cấp.

## Kiểm thử

```powershell
npm test
npm run test:auth:integration
npm run test:auth:browser
npm run build --prefix frontend
```

`test:auth:integration` tạo database MySQL riêng mang tên `jobfind_auth_test_<random>`, chạy migration và luồng HTTP thật rồi dọn database thử đó; cần quyền tạo/xóa database thử. Không sửa dữ liệu của `jobfindtest`.

`test:auth:browser` cần ứng dụng local đang chạy (`npm start`), tạo một tài khoản QA tạm với mật khẩu ngẫu nhiên, thử đăng nhập/tải lại/đa tab/đăng xuất/đổi mật khẩu qua trình duyệt rồi dọn tài khoản đó. Ảnh desktop/mobile lưu trong `.local/auth-browser/`.

`node backend/scripts/test-register-browser.cjs` kiểm tra hai bước đăng ký ở desktop/mobile, dữ liệu khi quay lại, lỗi và vai trò; tạo một ứng viên QA qua API thật, kiểm tra đăng nhập/cookie và dữ liệu được lưu, rồi dọn đúng tài khoản thử. Script luôn truyền mật khẩu và không truyền ảnh nên không gửi email hay upload ảnh. Ảnh nằm trong `.local/register-browser/`; mỗi lần chạy dùng một lượt đăng ký thật trong giới hạn chống spam.

Kiểm thử bao gồm cookie/Origin, JWT có session ID, xoay vòng/replay refresh, gia hạn đồng thời, gia hạn đua với logout/logout-all, đổi mật khẩu thu hồi phiên, HTTP sau logout, proxy giữ cookie/redirect và bỏ header giả mạo, state/browser/nonce/PKCE và chính sách liên kết SSO, phản hồi refresh đến muộn sau đổi tài khoản, RBAC và ranh giới công ty hiện có.

Unit test kiểm tra các nhánh bằng mock. Integration test dùng máy chủ HTTP OIDC cục bộ thực sự có discovery, authorization, token, JWKS và RSA; thư viện `openid-client` thật kiểm tra state/nonce/PKCE/chữ ký/issuer/audience/expiry. Chỉ chuyển địa chỉ mạng sang máy chủ thử trong tiến trình test, không thêm tùy chọn bỏ kiểm tra TLS/chữ ký trong production. Test thử vai trò ADMIN do IdP gửi, email trùng, token giả, state/code dùng lại, bốn vai trò trong DB, công ty bị khóa/chưa duyệt, tài khoản bị khóa và hủy liên kết.

Để chạy thêm SSO qua giao diện React thật trên database riêng (PowerShell, tại thư mục gốc):

```powershell
$env:REACT_APP_BACKEND_URL='/'
$env:BUILD_PATH='../.local/auth-acceptance-build'
npm --prefix frontend run build
Remove-Item Env:REACT_APP_BACKEND_URL, Env:BUILD_PATH
$env:AUTH_TEST_FRONTEND_BUILD='.local/auth-acceptance-build'
npm run test:auth:integration
Remove-Item Env:AUTH_TEST_FRONTEND_BUILD
```

Ảnh ở `.local/auth-oidc-browser/`. Kiểm thử trình duyệt gồm đăng nhập Google giả lập, cookie HttpOnly, không lưu JWT trong storage, reload, lịch sử, hai tab/logout-all, hủy consent, sai chữ ký và trang forbidden. Workflow `.github/workflows/authentication.yml` tự chuẩn bị MySQL/Chromium và chạy các bước này trong CI; không cần Google Client Secret. Workflow cần chạy trên GitHub để xác nhận môi trường CI thực tế.

**Chưa kiểm thử Google/GitHub/Auth0 thật** vì chưa có Client ID/Secret do người dùng cung cấp. Kiểm thử dùng nhà cung cấp cục bộ/mocks; sau khi cấu hình vẫn cần thử consent/token exchange thật và HTTPS của nơi triển khai.

## Nhật ký và vận hành

Sự kiện tài khoản được đưa vào `AuthSecurityEvents` sau khi transaction bảo mật commit. Lỗi ghi log báo `AUTH_AUDIT_WRITE_FAILED` và không làm hoàn tác đăng xuất/thu hồi. Cần cảnh báo vận hành cho thông báo này; cơ chế hiện tại không phải hàng đợi audit bảo đảm giao nhận. Đăng nhập sai và SSO bị từ chối ghi `userId=null`, tránh gán sự kiện cho một người chỉ dựa vào số điện thoại/email chưa xác minh; các bản ghi này dành cho người vận hành DB, không hiện trong lịch sử cá nhân.

Không ghi password, OTP, access/refresh token, OAuth code, raw User-Agent, IP hoặc email vào sự kiện. Nhãn thiết bị suy ra từ User-Agent, có thể bị giả mạo và không phải bằng chứng nhận dạng. `lastUsedAt` là lần cấp/gia hạn phiên, không phải mọi thao tác trên ứng dụng. Chưa tự xóa lịch sử; khi đưa lên production cần chọn thời hạn lưu, sao lưu và phân quyền đọc DB theo yêu cầu vận hành.

Nếu cần tạm ngừng Google: đặt `OIDC_GOOGLE_ENABLED=false`, khởi động lại backend, giữ đăng nhập mật khẩu. Tắt cờ chỉ ngừng các lần SSO mới; các phiên đã cấp vẫn tồn tại đến khi thu hồi/hết hạn. Nếu có sự cố SSO, thu hồi các phiên `method='oidc:google'` theo quy trình quản trị DB, kiểm tra không còn phiên SSO hoạt động, rồi rollback bản ứng dụng đã hỗ trợ session. Không bật legacy token để xử lý sự cố và không chạy migration down/drop bảng xác thực.

Email OTP yêu cầu `EMAIL_APP` và `EMAIL_APP_PASSWORD` ở backend. Trình khởi chạy local chủ động để trống thông tin gửi email để tránh thư ngoài ý muốn; kiểm thử dùng transport giả. Không bật gửi thư thật chỉ để chạy test.

Đối chiếu tiêu chí của báo cáo: [AUTH_REPORT_ACCEPTANCE.md](AUTH_REPORT_ACCEPTANCE.md).

## Giới hạn phạm vi

Hỗ trợ Google/Auth0 OIDC và GitHub OAuth, đăng nhập/liên kết tài khoản cũ và hoàn tất đăng ký mới. Chưa triển khai SAML, Microsoft Entra trực tiếp, MFA hoặc đăng xuất nhà cung cấp toàn cục. Không thu thập vị trí/IP thiết bị. OTP và bộ giới hạn trực tiếp tại monolith vẫn dùng bộ nhớ một tiến trình; nhiều replica cần kho OTP dùng chung. Gateway có giới hạn dùng Redis. CSP mới áp dụng các phản hồi API xác thực; CSP toàn giao diện cần cấu hình và kiểm thử thêm tại máy chủ phục vụ frontend.

Google discovery hiện không công bố `end_session_endpoint` hoặc khả năng back-channel logout. Vì vậy không coi logout JobFind là logout tài khoản Google. Khi bổ sung IdP doanh nghiệp cần triển khai RP-Initiated/Back-Channel Logout theo khả năng nhà cung cấp, kiểm tra logout token và lưu `iss/sid` phù hợp. [Metadata chính thức của Google](https://accounts.google.com/.well-known/openid-configuration).

Nhiều tab dùng Web Locks để tuần tự hóa refresh trên trình duyệt hỗ trợ. Trình duyệt không hỗ trợ Web Locks có singleflight trong mỗi tab; refresh đồng thời giữa các tab có thể bị coi là replay và yêu cầu đăng nhập lại. JWT không lưu trong localStorage cho các phiên mới.
