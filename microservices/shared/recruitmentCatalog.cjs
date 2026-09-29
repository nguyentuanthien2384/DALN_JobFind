'use strict';

// Effective 2025-07-01, Decision 19/2025/QD-TTg; mergers: Resolution 202/2025/QH15.
// Keep the application's existing name-based keys; administrativeCode is reference metadata.
const PROVINCE_SOURCE = 'https://baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm';
const MERGER_SOURCE = 'https://xaydungchinhsach.chinhphu.vn/quoc-hoi-thong-qua-nghi-quyet-sap-xep-don-vi-hanh-chinh-cap-tinh-119250612101356465.htm';
const PROVINCES = Object.freeze([
    ['01', 'Hà Nội', []],
    ['04', 'Cao Bằng', []],
    ['08', 'Tuyên Quang', ['Hà Giang']],
    ['11', 'Điện Biên', []],
    ['12', 'Lai Châu', []],
    ['14', 'Sơn La', []],
    ['15', 'Lào Cai', ['Yên Bái']],
    ['19', 'Thái Nguyên', ['Bắc Kạn']],
    ['20', 'Lạng Sơn', []],
    ['22', 'Quảng Ninh', []],
    ['24', 'Bắc Ninh', ['Bắc Giang']],
    ['25', 'Phú Thọ', ['Vĩnh Phúc', 'Hòa Bình']],
    ['31', 'Hải Phòng', ['Hải Dương']],
    ['33', 'Hưng Yên', ['Thái Bình']],
    ['37', 'Ninh Bình', ['Hà Nam', 'Nam Định']],
    ['38', 'Thanh Hóa', []],
    ['40', 'Nghệ An', []],
    ['42', 'Hà Tĩnh', []],
    ['44', 'Quảng Trị', ['Quảng Bình']],
    ['46', 'Huế', ['Thừa Thiên Huế', 'Thừa Thiên - Huế']],
    ['48', 'Đà Nẵng', ['Quảng Nam']],
    ['51', 'Quảng Ngãi', ['Kon Tum']],
    ['52', 'Gia Lai', ['Bình Định']],
    ['56', 'Khánh Hòa', ['Ninh Thuận']],
    ['66', 'Đắk Lắk', ['Phú Yên']],
    ['68', 'Lâm Đồng', ['Đắk Nông', 'Bình Thuận']],
    ['75', 'Đồng Nai', ['Bình Phước']],
    ['79', 'Hồ Chí Minh', ['Bình Dương', 'Bà Rịa - Vũng Tàu', 'Bà Rịa – Vũng Tàu']],
    ['80', 'Tây Ninh', ['Long An']],
    ['82', 'Đồng Tháp', ['Tiền Giang']],
    ['86', 'Vĩnh Long', ['Bến Tre', 'Trà Vinh']],
    ['91', 'An Giang', ['Kiên Giang']],
    ['92', 'Cần Thơ', ['Sóc Trăng', 'Hậu Giang']],
    ['96', 'Cà Mau', ['Bạc Liêu']]
].map(([administrativeCode, code, previousNames]) => Object.freeze({
    code, value: code, administrativeCode, previousNames: Object.freeze(previousNames)
})));

// Seniority and management levels apply across industries. Job titles belong in the post name.
// 'thuc-tap' is already a WORKTYPE primary key, so the intern level needs a distinct key.
const JOB_LEVELS = Object.freeze([
    ['thuc-tap-sinh', 'Thực tập sinh'],
    ['moi-tot-nghiep', 'Mới tốt nghiệp / Fresher'],
    ['nhan-vien', 'Nhân viên'],
    ['chuyen-vien', 'Chuyên viên'],
    ['chuyen-vien-cao-cap', 'Chuyên viên cao cấp'],
    ['truong-nhom', 'Trưởng nhóm'],
    ['giam-sat', 'Giám sát'],
    ['pho-phong', 'Phó phòng'],
    ['truong-phong', 'Trưởng phòng'],
    ['pho-giam-doc', 'Phó giám đốc'],
    ['giam-doc', 'Giám đốc'],
    ['giam-doc-dieu-hanh', 'Giám đốc điều hành']
].map(([code, value]) => Object.freeze({ code, value })));

const key = value => value.normalize('NFC').trim().replace(/^(?:tỉnh|thành phố|tp\.?)\s+/iu, '')
    .replace(/[–—]/g, '-').replace(/\s+/g, ' ').toLocaleLowerCase('vi');
const provinceByName = new Map(PROVINCES.flatMap(province =>
    [province.code, ...province.previousNames].map(name => [key(name), province])));

function normalizeProvinceCode(value) {
    if (typeof value !== 'string') return value;
    return provinceByName.get(key(value))?.code ?? value;
}

// Old links and old index documents remain searchable while migration/events catch up.
function provinceFilterCodes(value) {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value !== 'string') return [value];
    const province = provinceByName.get(key(value));
    return province ? [...new Set([province.code, ...province.previousNames, value])] : [value];
}

module.exports = { PROVINCES, JOB_LEVELS, PROVINCE_SOURCE, MERGER_SOURCE, normalizeProvinceCode, provinceFilterCodes };
