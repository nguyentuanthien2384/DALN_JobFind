// Conservative mapping from a source's own wording to Job Finder's filter codes.
// Anything that is not stated plainly stays null; locations that cannot be mapped
// make the vacancy ineligible instead of being guessed.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PROVINCES } = require('../../microservices/shared/recruitmentCatalog.cjs');

export const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

// Cities and districts that job pages name instead of the province (current 34-province map).
const PLACE_ALIASES = {
    'tphcm': 'Hồ Chí Minh', 'tp hcm': 'Hồ Chí Minh', 'hcm': 'Hồ Chí Minh', 'ho chi minh city': 'Hồ Chí Minh', 'sai gon': 'Hồ Chí Minh',
    'thu duc': 'Hồ Chí Minh', 'vung tau': 'Hồ Chí Minh', 'thu dau mot': 'Hồ Chí Minh', 'di an': 'Hồ Chí Minh', 'hanoi': 'Hà Nội',
    'nha trang': 'Khánh Hòa', 'cam ranh': 'Khánh Hòa', 'sa pa': 'Lào Cai', 'sapa': 'Lào Cai', 'vinh': 'Nghệ An', 'da lat': 'Lâm Đồng',
    'bao loc': 'Lâm Đồng', 'phan thiet': 'Lâm Đồng', 'quy nhon': 'Gia Lai', 'pleiku': 'Gia Lai', 'buon ma thuot': 'Đắk Lắk',
    'tuy hoa': 'Đắk Lắk', 'phu quoc': 'An Giang', 'rach gia': 'An Giang', 'ha long': 'Quảng Ninh', 'mong cai': 'Quảng Ninh',
    'bien hoa': 'Đồng Nai', 'dong hoi': 'Quảng Trị', 'viet tri': 'Phú Thọ', 'vinh yen': 'Phú Thọ', 'hoi an': 'Đà Nẵng',
    'tam ky': 'Đà Nẵng', 'my tho': 'Đồng Tháp', 'cao lanh': 'Đồng Tháp', 'chau doc': 'An Giang', 'long xuyen': 'An Giang',
    'soc trang': 'Cần Thơ', 'bac lieu': 'Cà Mau', 'hue city': 'Huế', 'ha tinh city': 'Hà Tĩnh', 'nam dinh': 'Ninh Bình',
};
const NATIONWIDE = /^(toan quoc|nationwide|all locations|nhieu tinh thanh|remote)$/;
const places = new Map();
for (const province of PROVINCES) {
    for (const name of [province.code, province.value, ...(province.previousNames || [])]) places.set(fold(name), province.code);
}
for (const [alias, code] of Object.entries(PLACE_ALIASES)) places.set(alias, code);
const stripPrefix = value => fold(value).replace(/^(tinh|thanh pho|tp\.?|t\.p\.?|city of)\s+/, '').replace(/\s+(province|city)$/, '').replace(/[.()]/g, '').trim();

/** One place name → current province code, or null. */
export const provinceOf = value => {
    const key = stripPrefix(value);
    return key ? places.get(key) || null : null;
};

/**
 * Every place in a list must map to a province ("Hà Nội, Hải Phòng", "Lam Dong, Quang Ngai").
 * Returns null when any part is unknown or the source only says "toàn quốc".
 */
export function provincesFromList(text) {
    const parts = String(text || '').split(/\s*(?:[,;|·]|\/|\s+và\s+|\s+and\s+)\s*/i).map(part => part.trim()).filter(Boolean);
    if (!parts.length || parts.some(part => NATIONWIDE.test(fold(part)))) return null;
    const codes = [];
    for (const part of parts) {
        // "Ho Chi Minh - Head Office", "Phu Xuyen - Ha Noi": a place qualified by a site or district.
        const found = provinceOf(part) ? [provinceOf(part)] : part.split(/\s+-\s+/).map(provinceOf).filter(Boolean);
        if (!found.length) return null;
        for (const code of found) if (!codes.includes(code)) codes.push(code);
    }
    return codes;
}

/** A street address names its province last: "..., TP Lai Châu, Lai Châu". */
export function provinceFromAddress(text) {
    const parts = String(text || '').split(',').map(part => part.trim()).filter(Boolean).reverse();
    for (const part of parts) {
        const code = provinceOf(part);
        if (code) return code;
    }
    return null;
}

const has = (text, pattern) => pattern.test(fold(text));

// Order matters: the first matching field wins.
const CATEGORY_RULES = [
    // A buyer of legal or IT services is still a purchasing role.
    ['kinh-te', /\b(procurement|purchasing|mua hang)\b/],
    ['luat',/\b(phap che|phap ly|luat su|legal|compliance)\b/],
    ['logistics', /\b(logistics|kho van|nhan vien kho|thu kho|tro ly kho|quan ly kho|kho tong|chuoi cung ung|supply chain|giao nhan|van tai|xuat nhap khau|tai xe|shipper|dieu phoi van tai|warehouse)\b/],
    ['giao-vien', /\b(giao vien|giang vien|tro giang|teacher|lecturer|tutor)\b/],
    ['truyen-thong', /\b(marketing|truyen thong|content|pr|seo|thiet ke do hoa|graphic|designer|media|social|thuong hieu|brand|video|editor|livestream)\b/],
    ['quan-ly-nhan-su', /\b(nhan su|tuyen dung|c&b|hr|hrbp|talent acquisition|recruit\w*|hanh chinh nhan su|people)\b/],
    ['cong-nghe-thong-tin', /\b(lap trinh|developer|dev|phan mem|software|it|cong nghe thong tin|data|dataops|mlops|du lieu|ai|tri tue nhan tao|hoc may|hoc sau|ui|ux|ky thuat vien ha tang|machine learning|devops|kiem thu|tester|qa|qc phan mem|an toan thong tin|bao mat|security|pentest|soc (analyst|manager|engineer)|network|ky su he thong|quan tri he thong|cloud|kubernetes|platform engineer|product owner|business analyst|phan tich nghiep vu|ky thuat dia ban|vien thong)\b/],
    ['bat-dong-san', /\b(bat dong san|bds|real estate|moi gioi)\b/],
    ['kinh-te', /\b(kinh doanh|ban hang|sales?|ke toan|tai chinh|finance|accountant|ngan hang|tin dung|thu ngan|cham soc khach hang|dich vu khach hang|customer services?|sales admin|account manager|mua hang|purchas\w*|kiem toan|audit|dau tu|investment|bao hiem|insurance)\b/],
];
export const categoryOf = (...texts) => {
    const text = texts.filter(Boolean).join(' ');
    return CATEGORY_RULES.find(([, pattern]) => has(text, pattern))?.[0] || null;
};

const LEVEL_RULES = [
    ['thuc-tap-sinh', /\b(thuc tap sinh|thuc tap|intern(ship)?|trainee)\b/],
    ['pho-giam-doc', /\b(pho giam doc|deputy director|vice director)\b/],
    ['giam-doc', /\b(giam doc|director|head of)\b/],
    ['pho-phong', /\b(pho phong|deputy manager)\b/],
    ['truong-phong', /\b(truong phong|manager)\b/],
    ['giam-sat', /\b(giam sat|supervisor)\b/],
    ['truong-nhom', /\b(truong nhom|to truong|team lead(er)?|leader|truong ca)\b/],
    ['chuyen-vien-cao-cap', /\b(chuyen vien cap cao|chuyen vien cao cap|senior officer|senior specialist)\b/],
    ['chuyen-vien', /\b(chuyen vien|specialist|officer|executive)\b/],
    ['nhan-vien', /\b(nhan vien|staff)\b/],
];
export const levelOf = title => LEVEL_RULES.find(([, pattern]) => has(title, pattern))?.[0] || null;

export const workTypeOf = text => {
    const value = fold(text);
    if (!value) return null;
    if (/(toan thoi gian|full[- ]?time)/.test(value) && !/(ban thoi gian|part[- ]?time)/.test(value)) return 'fulltime';
    if (/(ban thoi gian|part[- ]?time)/.test(value) && !/(toan thoi gian|full[- ]?time)/.test(value)) return 'part-time';
    if (/^(thuc tap|internship)$/.test(value)) return 'thuc-tap';
    if (/(lam viec tu xa|remote)/.test(value)) return 'remote';
    return null;
};

/** Salary brackets are assigned only when the source's range is exactly a bracket, or negotiable. */
const BRACKETS = [['3-5tr', 3, 5], ['5-10tr', 5, 10], ['10-15tr', 10, 15], ['15-20tr', 15, 20], ['20-30tr', 20, 30]];
export function salaryCodeOf(text) {
    const value = fold(text);
    if (!value) return null;
    if (/^(luong )?(thoa thuan|thuong luong|negotiable|theo thoa thuan)$/.test(value)) return 'thoa-thuan';
    if (/(gio|ngay|nam|usd|\$)/.test(value)) return null;
    const million = value.match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*(trieu|tr)\b/);
    if (million) {
        const [low, high] = [million[1], million[2]].map(n => Number(n.replace(',', '.')));
        return BRACKETS.find(([, lo, hi]) => lo === low && hi === high)?.[0] || null;
    }
    if (/^tren 30 trieu/.test(value)) return 'tren-30tr';
    return null;
}

/** Experience codes come from an explicit "Kinh nghiệm" value or a "tối thiểu N năm" requirement. */
export function experienceOf(factValue, requirementLines = []) {
    const direct = fold(factValue);
    if (/khong yeu cau/.test(direct)) return 'khong-yeu-cau';
    const years = text => {
        const match = fold(text).match(/(?:toi thieu|it nhat|tu|at least|minimum)\s*(\d{1,2})\s*(?:nam|years?)(?!\s*-)/);
        return match ? Number(match[1]) : null;
    };
    const fromFact = /^(\d)\s*nam$/.test(direct) ? Number(direct[0]) : null;
    const found = fromFact ?? requirementLines.map(years).find(value => value !== null) ?? null;
    if (found === null) {
        return requirementLines.some(line => /khong yeu cau kinh nghiem|chua co kinh nghiem|khong can kinh nghiem/.test(fold(line))) ? 'khong-yeu-cau' : null;
    }
    return { 1: '1-nam', 2: '2-nam', 3: '3nam' }[found] || (found > 5 ? 'tren-5-nam' : null);
}
