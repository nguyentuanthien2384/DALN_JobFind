// Tham so chung cho cac danh sach quan tri (nguoi dung, cong ty, tin tuyen dung).
//
// - Kich thuoc trang bi chan tren: mot request khong duoc keo ca bang ve.
// - Bo loc chi nhan gia tri trong danh sach cho phep; gia tri la bi bo qua thay
//   vi lot vao cau truy van.
// - Chuoi tim kiem duoc thoat ky tu dai dien cua LIKE: go "%" hay "_" la tim
//   dung ky tu do, khong phai "khop moi thu".

const MAX_PAGE_SIZE = 100;

const pageOf = (data = {}) => ({
    limit: Math.min(Math.max(Number.parseInt(data.limit, 10) || 1, 1), MAX_PAGE_SIZE),
    offset: Math.max(Number.parseInt(data.offset, 10) || 0, 0),
});

const allowed = (value, values) => (values.includes(value) ? value : undefined);

const likePattern = (value) => `%${String(value).trim().replace(/[\\%_]/g, '\\$&')}%`;

module.exports = { MAX_PAGE_SIZE, pageOf, allowed, likePattern };
