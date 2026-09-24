# Đối chiếu báo cáo Authentication, Authorization và SSO

> Kiểm chứng lại 24/09/2026: unit, MySQL/OIDC/GitHub local và browser qua Gateway đều đạt. OAuth credentials thật vẫn chưa có; xem [biên bản API key/demo](api-key-demo-validation.md).

Ngày kiểm chứng tại workspace: 20/09/2026. Nguồn yêu cầu tham chiếu: “Báo cáo kiểm tra Authentication, Authorization và phương án tích hợp SSO cho dự án DALN JobFind.pdf”, 28 trang, đặc biệt trang 12–15 và 24–27. Tài liệu PDF đánh giá bộ mã cũ; trạng thái dưới đây dựa trên mã và kiểm thử hiện tại. Các tên file/schema mẫu và lịch triển khai trong PDF là đề xuất, không phải yêu cầu phải sao chép nguyên văn.

## Kết luận phạm vi

Đã đáp ứng nền tảng P0 và luồng SSO MVP P1 cho một provider Google với chính sách liên kết vào tài khoản JobFind đã tồn tại. Đã bổ sung phần lớn hardening P2: nhật ký, thông tin thiết bị, logout-all, phát hiện refresh reuse, xác nhận lại khi hủy liên kết, kiểm thử OIDC có chữ ký thật và CI riêng. Chưa thể xác nhận toàn bộ lộ trình trong PDF hay khả năng triển khai production hoàn chỉnh: Google thật chưa có OAuth Client; các mục doanh nghiệp P3 chưa triển khai, cùng một số việc vận hành nêu cuối tài liệu.

## P0: phiên đăng nhập và thu hồi

- JWT ngắn hạn, issuer/audience/algorithm được kiểm tra; refresh token ngẫu nhiên trong cookie HttpOnly, chỉ lưu hash ở MySQL. Frontend dùng token trong bộ nhớ và marker công khai trong localStorage.
- Refresh xoay vòng theo transaction và khóa tài khoản, phát hiện dùng lại, thu hồi cả family. Logout/logout-all và đổi/reset mật khẩu thu hồi phiên phía server; không tạo phiên mới lọt qua logout đồng thời.
- HTTP đọc lại vai trò, trạng thái tài khoản/công ty và phiên ở DB. Socket kiểm tra lại tối đa 30 giây. 401 dùng cho thông tin xác thực không hợp lệ; 403 giữ cho thiếu quyền/trạng thái bị khóa.
- Hạn tuyệt đối 14 ngày giữ qua mọi vòng refresh; cookie mới chỉ nhận thời gian còn lại. Có kiểm thử cạnh tranh và rollback transaction trên MySQL thật.

Bằng chứng: `authSessionService.js`, `jwtVerify.js`, Gateway `accountStore.js`, `authClient.js`, `test-auth-integration.cjs` và `test-auth-browser.cjs`.

## P1: SSO và quyền nghiệp vụ

- Authorization Code + PKCE S256, state gắn cookie trình duyệt, nonce; state tiêu thụ một lần trong DB. Callback và issuer do máy chủ cấu hình, không nhận từ tham số người dùng.
- `openid-client` thật kiểm tra chữ ký với JWKS, issuer, audience, thời hạn và nonce. Không bỏ qua TLS hoặc kiểm tra chữ ký trong mã production.
- `AuthIdentity` dùng unique `(issuer, subject)` phân biệt hoa/thường; bổ sung email đã xác minh và tên tại thời điểm liên kết.
- Tài khoản mới từ Google không được tự tạo/gộp theo email; người dùng đăng nhập local rồi xác nhận mật khẩu để liên kết. Đây là chính sách provisioning đóng, đáp ứng lựa chọn liên kết an toàn trong báo cáo. Claim role/group của Google không cấp ADMIN hay thay đổi quyền local.
- Liên kết kiểm tra phiên/cookie gốc còn hiệu lực; hủy liên kết kiểm tra lại mật khẩu và phiên dưới khóa tài khoản. ID liên kết không thuộc người dùng không được thay đổi và không làm thu hồi nhầm phiên của họ.
- Kiểm thử cùng một JWT SSO khi DB đổi giữa CANDIDATE/EMPLOYER/COMPANY/ADMIN, công ty chưa duyệt/bị khóa hoặc tài khoản bị khóa. Quyền mới có hiệu lực ở yêu cầu kế tiếp.

Bằng chứng: `oidcService.js`, `authController.js`, `authorize.js`, `backend/scripts/auth/oidc-acceptance.cjs`.

## Mười điều kiện chặn phát hành ở trang 26

1. **Secret trong frontend:** cấu hình secret chỉ đọc ở backend; kiểm tra bundle frontend và không cung cấp secret qua API provider.
2. **Refresh token trong storage:** cookie HttpOnly; browser test kiểm tra storage không chứa JWT và `document.cookie` không đọc được refresh.
3. **State không tồn tại:** bị chặn trước token exchange; kiểm tra cả cookie khác trình duyệt và state dùng lại.
4. **Bỏ PKCE:** bắt buộc S256; thay verifier khiến token endpoint thử nghiệm từ chối.
5. **Bỏ kiểm tra token:** thử token sai chữ ký, kid, nonce, issuer, audience, hết hạn và thiếu exp; mọi trường hợp không được cấp refresh.
6. **Tự cấp ADMIN từ SSO:** provider thử gửi ADMIN/groups nhưng tài khoản vẫn giữ vai trò DB.
7. **Gộp bằng email:** cả email đã xác minh/chưa xác minh trùng local đều không tự liên kết.
8. **Refresh sau logout:** bị từ chối; có kiểm thử refresh chạy đồng thời logout/logout-all.
9. **Không phát hiện reuse:** token thế hệ trước thu hồi toàn bộ family và ghi sự kiện bảo mật.
10. **Open redirect qua returnTo:** backend không nhận returnTo tùy ý, chỉ quay lại origin/frontend route đã cấu hình; frontend lọc lastUrl cùng origin. Có kiểm thử yêu cầu trỏ tới domain ngoài.

Các kiểm tra trên xác nhận mã và môi trường thử, không thay thế nghiệm thu tên miền, HTTPS và cấu hình Google thật khi triển khai.

## Các phần đã phát triển thêm từ lần đối chiếu này

- Trang `/account/security`: nhãn trình duyệt/hệ điều hành, thời điểm đăng nhập, gia hạn, lịch sử cá nhân phân trang và hướng dẫn xử lý phiên lạ.
- Nhật ký sự kiện sau commit, dữ liệu được giới hạn, không chứa credential hoặc raw header. Lỗi audit không ngăn việc thu hồi phiên.
- HTTP headers chống cache, rò rỉ referrer và nhúng nội dung ở API auth; thông báo riêng khi người dùng hủy Google.
- OTP ngẫu nhiên bảo mật, HMAC trong RAM, so sánh thời gian cố định, bỏ log mã; xử lý email lỗi/chưa cấu hình và salt bcrypt riêng.
- Migration cộng thêm có sao lưu, không đổi khóa chính hoặc dữ liệu nghiệp vụ; hướng dẫn rollback và CI OIDC riêng.

## Kiểm chứng

Các lệnh và cách chạy có trong [hướng dẫn tích hợp](AUTHENTICATION_SSO_INTEGRATION.md). Kiểm thử gồm unit backend/frontend/microservices, build production, MySQL độc lập, máy chủ HTTP OIDC có JWKS/RSA và Chromium chạy giao diện React thực tế. Browser SSO thử login, reload, lịch sử, hai tab/logout-all, hủy consent, chữ ký sai và forbidden. Browser local thử qua Gateway, giao diện desktop/mobile, đổi mật khẩu và chặn JWT cũ. Các test này không gửi email thật, không cần Google Client và tự dọn dữ liệu thử.

Kết quả đã chạy tại máy local: backend 61 suite / 932 test, frontend 80 suite / 1.486 test, microservices 64 suite / 1.226 test, tổng 3.644 test đạt. Build frontend production và luồng MySQL/OIDC/Chromium đạt. Một lượt microservices vượt timeout lúc máy chạy nhiều tác vụ; chạy lại nguyên bộ đạt mà không đổi mã/timeout. Bundle kiểm tra không chứa biến secret backend hoặc cấu hình client OIDC thử nghiệm.

## Phần chưa triển khai hoặc chưa nghiệm thu

- **Google thật:** cần tạo OAuth Client và kiểm tra consent/callback trên cấu hình thực. Đang tắt theo lựa chọn của chủ dự án; hướng dẫn đã sẵn sàng.
- **RP-Initiated Logout:** chưa triển khai; Google không công bố `end_session_endpoint` trong [discovery chính thức](https://accounts.google.com/.well-known/openid-configuration) được kiểm tra ngày 20/09/2026. Logout hiện kết thúc phiên JobFind, không phải phiên Google toàn cục.
- **P3 theo nhu cầu doanh nghiệp:** provider khác, back-channel logout, external group mapping, SAML. Cần nhà cung cấp và chính sách doanh nghiệp cụ thể trước khi triển khai.
- **Tự tạo tài khoản từ SSO:** tắt bằng thiết kế; chưa có UI hoàn thiện hồ sơ/điện thoại khi auto-provision. Không coi việc thiếu auto-provision là lỗi của chính sách liên kết hiện tại.
- **Vận hành quy mô lớn:** kho OTP chung cho nhiều replica, thời hạn lưu audit/phiên hết hạn, chuyển audit sang hệ thống tập trung có bảo đảm giao nhận, CSP toàn frontend, giám sát và cảnh báo. Chưa có MFA. Audit lỗi vẫn có thể mất sự kiện, dù việc thu hồi phiên không bị ảnh hưởng.
- **Trình duyệt không hỗ trợ Web Locks:** nhiều tab có thể refresh cạnh tranh và yêu cầu đăng nhập lại; không nới kiểm tra reuse để che vấn đề này.
- **CI trên GitHub:** workflow đã thêm, các bước được chạy tương ứng tại máy local; chưa có kết quả workflow từ GitHub trong lần làm việc này.

Tham chiếu kỹ thuật: [OIDC Core - ID Token Validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). Phân loại P0–P3 theo chính báo cáo, không quy đổi thành tỷ lệ phần trăm tùy ý.
