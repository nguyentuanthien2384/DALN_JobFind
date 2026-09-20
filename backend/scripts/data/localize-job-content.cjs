const { createHash } = require('node:crypto');
const translations = require('./job-description-translations.json');

const contentHash = row => createHash('sha256')
    .update(JSON.stringify([row.descriptionHTML || '', row.descriptionMarkdown || ''])).digest('hex');
const titles = {
    'Sales Support - T7012': 'Nhân viên hỗ trợ kinh doanh - T7012',
    'Tổng Đài Viên - Partime': 'Tổng đài viên - Bán thời gian',
    'Tuyển dụng HR': 'Tuyển dụng nhân sự',
    'Tuyển dụng HR2': 'Tuyển dụng nhân sự 2',
    'Tuyển dụng Developer': 'Tuyển dụng lập trình viên',
    'Tuyển dụng Backend Developer': 'Tuyển dụng lập trình viên hệ thống phía máy chủ',
    'lap trinh vien tieu ban 3': 'Lập trình viên tiểu ban 3',
};
// Reviewed phrases from the existing imported jobs. Technology/product names,
// qualifications, numbers and URLs are preserved; this is not machine translation.
const phrases = [
    ['Product Owner', 'người phụ trách sản phẩm'],
    ['Product Manager', 'quản lý sản phẩm'],
    ['front-end framework', 'bộ khung phát triển giao diện'],
    ['base-components', 'các thành phần giao diện dùng chung'],
    ['Single Page Application', 'ứng dụng web một trang'],
    ['team back-end', 'nhóm phát triển hệ thống phía máy chủ'],
    ['open-source project/library', 'dự án hoặc thư viện mã nguồn mở'],
    ['code splitting', 'chia nhỏ mã nguồn'],
    ['bundling', 'đóng gói mã nguồn'],
    ['Year End Party', 'tiệc cuối năm'],
    ['Team buiding', 'hoạt động gắn kết tập thể'],
    ['Team Building', 'hoạt động gắn kết tập thể'],
    ['teambuilding', 'hoạt động gắn kết tập thể'],
    ['work from home', 'làm việc tại nhà'],
    ['site văn phòng', 'địa điểm văn phòng'],
    ['Môi trường IT', 'Môi trường công nghệ thông tin'],
    ['Marketing online', 'tiếp thị trực tuyến'],
    ['data khách hàng', 'dữ liệu khách hàng'],
    ['data chất lượng', 'dữ liệu chất lượng'],
    ['Best sale', 'nhân viên kinh doanh xuất sắc'],
    ['Hỗ trợ Sale', 'Hỗ trợ nhân viên kinh doanh'],
    ['cho Sale', 'cho nhân viên kinh doanh'],
    ['khối Sales', 'khối Kinh doanh'],
    ['khách hàng online', 'khách hàng trực tuyến'],
    ['làm product', 'phát triển sản phẩm'],
    ['xây dựng Product', 'xây dựng sản phẩm'],
    ['công ty startup', 'công ty khởi nghiệp'],
    ['các Apps', 'các ứng dụng'],
    ['cho Apps', 'cho ứng dụng'],
    ['với Artist', 'với nhân viên thiết kế'],
    ['Cùng team', 'Cùng nhóm'],
    ['trực tiếp check', 'trực tiếp kiểm tra'],
    ['up to 35m', 'tối đa 35 triệu đồng'],
    ['free trà', 'miễn phí trà'],
    ['Part-time', 'Bán thời gian'],
    ['Marketing', 'Tiếp thị'],
    ['Outing', 'dã ngoại'],
    ['Teabreak', 'nghỉ giải lao'],
    ['eLearning', 'học trực tuyến'],
];
const localizeText = text => phrases.reduce((result, [source, target]) =>
    result.replace(new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), target), text);
const localizeMarkup = text => String(text || '').split(/(<[^>]*>|https?:\/\/[^\s<>]+|`[^`]*`)/g)
    .map((part, index) => index % 2 ? part : localizeText(part)).join('');

function localizeJobContent(row) {
    const translated = translations.find(item => item.sourceHashes.includes(contentHash(row)));
    return {
        name: titles[row.name] || row.name,
        descriptionHTML: translated?.descriptionHTML || localizeMarkup(row.descriptionHTML),
        descriptionMarkdown: translated?.descriptionMarkdown || localizeMarkup(row.descriptionMarkdown),
    };
}

module.exports = { localizeJobContent, contentHash };
