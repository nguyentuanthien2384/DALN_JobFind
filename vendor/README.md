# Dependency vá tại chỗ

## braces 3.0.4-jobfind.1

`vendor/braces` là `braces@3.0.3` (integrity npm `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`) cộng một bản vá cho [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): pattern lồng `{}`/`()` rất sâu (khoảng 5.000 cấp, dưới giới hạn 10.000 ký tự) làm các hàm đệ quy `compile`/`expand`/`stringify` tràn stack. Advisory chưa có bản sửa chính thức (`first_patched_version: null`), còn các PR sửa ở upstream chưa được merge.

Thay đổi so với 3.0.3, chỉ nằm ở `lib/constants.js` và `lib/parse.js`:

- Thêm `MAX_DEPTH: 100`. Parser ném `SyntaxError` ("Input depth (101), exceeds max depth (100)") trước khi mở nhóm `{` hoặc `(` thứ 101, theo đúng kiểu giới hạn `maxLength` có sẵn và cách tiếp cận của PR micromatch/braces#87.
- `options.maxDepth` chỉ hạ được giới hạn; giá trị lớn hơn, `Infinity`, `NaN` hoặc không phải số đều dùng 100.
- `package.json` đổi version, bỏ script/devDependencies; README upstream không đóng gói.

Phạm vi ảnh hưởng: frontend dùng `braces` qua công cụ build/test (react-scripts, Jest, webpack-dev-server, Tailwind). Microservices có `braces` trong image gateway qua `http-proxy-middleware → micromatch`, nhưng `micromatch` chỉ gọi `braces` trong `braces()`/`braceExpand()`/`parse()`; phần so khớp `pathFilter` dùng `picomatch`. Backend không còn `braces` sau khi bỏ `nodemon` (dùng `node --watch`).

## Cách cài và kiểm chứng

`frontend` (devDependencies) và `microservices` (dependencies) khai báo `"braces": "file:vendor/braces-3.0.4-jobfind.1.tgz"` và `"overrides": { "braces": "$braces" }`. Lockfile khóa integrity của tarball. Không dùng override trỏ thẳng vào thư mục: npm khi đó không cài `fill-range`, hoặc xóa `braces` khỏi cây phụ thuộc.

npm audit bỏ qua phiên bản prerelease nên không thể dùng nó để xác nhận bản vá. Thay vào đó:

- `scripts/vendored-braces.test.mjs` (trong `npm run test:runtime`): hai tarball giống hệt nhau, không bị `.gitignore` (luật `*.tgz`) loại khỏi Git, khớp integrity trong lockfile, nội dung trùng byte với `vendor/braces`, mỗi lockfile chỉ có một `braces`.
- `microservices/tests/vendored-braces.test.js`: độ sâu 100 vẫn chạy, 101 bị từ chối; input gây tràn stack ở 3.0.3 nay trả `SyntaxError`; kết quả compile/expand của pattern thông dụng giống 3.0.3; `pathFilter: '/socket.io/**'` của gateway vẫn định tuyến đúng. Khi tắt hai lời gọi `enterGroup()`, ba ca bảo mật thất bại.
- `scripts/check-vendored-deps.mjs` (trong `npm run check` và CI): thất bại nếu `braces@3.0.3` có advisory high/critical khác; báo khi upstream phát hành bản sửa.
- Bộ test chính thức của braces (tag 3.0.3, 764 ca, mocha) đạt cả trước và sau khi vá (09/10/2026).

`.gitattributes` tắt chuyển đổi xuống dòng cho `vendor/**` để nội dung trên Windows (`core.autocrlf=true`) vẫn trùng với tarball.

## Sửa bản vá

```powershell
node scripts/pack-vendor.mjs          # đóng gói vendor/braces vào frontend/vendor và microservices/vendor
npm --prefix frontend install --ignore-scripts
npm --prefix microservices install --ignore-scripts
node --test scripts/vendored-braces.test.mjs
```

Đổi `version` trong `vendor/braces/package.json` thì đổi tên tarball và hai `package.json` tương ứng. Docker (`deploy/web.Dockerfile`, `scripts/release/web.Dockerfile`, `microservices/Dockerfile`) chép thư mục `vendor` trước `npm ci`.

## Khi upstream có bản sửa

Khi `check-vendored-deps` báo "đã sửa", xóa `vendor/braces`, hai thư mục `*/vendor`, khai báo `braces` và override trong hai `package.json`, dòng `COPY vendor` trong các Dockerfile, mục `frontend/vendor` trong `scripts/prepare-release.mjs`, hai file test và script kiểm tra; cài lại và chạy `npm run check`.
