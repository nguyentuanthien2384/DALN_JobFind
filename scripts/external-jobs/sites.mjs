// Per-source extraction rules. Each extractor reads one official job page and returns only
// facts published there; nothing is inferred. Logos and banners are copies of images the
// source itself publishes, stored under frontend/public/external-jobs.
import {
    between, domLines, firstUpper, introFrom, lastDate, normalizeQuantity, normalizeSalary,
    splitSections, finalizeSections, squash, texts, valueAfter,
} from './extract.mjs';
import { provinceFromAddress, provinceOf, provincesFromList } from './classify.mjs';

const $ = (doc, selector) => doc.querySelector(selector);
const text = (doc, selector) => squash($(doc, selector)?.textContent);
const linesOf = (doc, selector) => domLines($(doc, selector));
const meta = (doc, property) => squash(doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute('content'));
const ogTitle = doc => meta(doc, 'og:title').split('|')[0].trim();
const fact = (label, value) => {
    const clean = squash(value).replace(/[\s,;:]+$/, '');
    return clean ? { label, value: clean } : null;
};
const facts = (...entries) => entries.filter(Boolean);

const place = (text, provinces) => (squash(text) ? { text: squash(text), provinces: provinces || null } : null);
const listPlace = text => place(text, provincesFromList(text));
const unique = values => [...new Set(values.filter(Boolean))];
const linksIn = (html, base, pattern) => unique([...html.matchAll(pattern)].map(match => new URL(match[1] || match[0], base).href));

const media = (logo, cover = null, extra = {}) => ({
    logo: logo && { file: `logos/${logo.file}`, origin: logo.origin },
    cover: cover && { file: `covers/${cover.file}`, origin: cover.origin },
    ...extra,
});

export const SITES = [
    {
        key: 'vnpt',
        hosts: ['tuyendung.vnpt.vn'],
        media: media({ file: 'vnpt.png', origin: 'https://tuyendung.vnpt.vn/images/logo_mau1.png' },
            { file: 'vnpt.jpg', origin: 'https://tuyendung.vnpt.vn/Images/social-facebook.jpg' }),
        profile: { employer: 'Tập đoàn Bưu chính Viễn thông Việt Nam (VNPT)', sourceName: 'Cổng tuyển dụng VNPT' },
        async discover(get) {
            const urls = [];
            for (let page = 1; page <= 8; page += 1) {
                const html = await get(`https://tuyendung.vnpt.vn/viec-lam/tat-ca-viec-lam.html?pageIndex=${page}`);
                const found = linksIn(html, 'https://tuyendung.vnpt.vn/', /https:\/\/tuyendung\.vnpt\.vn\/tim-viec-lam\/[a-z0-9-]+-jid\d+\.html/g);
                const fresh = found.filter(url => !urls.includes(url));
                if (!fresh.length) break;
                urls.push(...fresh);
            }
            return urls;
        },
        extract(doc) {
            return {
                title: text(doc, '.detail-job h1'),
                employer: text(doc, '.detail-job .div-department'),
                location: listPlace($(doc, '.detail-job .div-location span')?.getAttribute('title') || text(doc, '.detail-job .div-location')),
                deadline: lastDate(text(doc, '.detail-job .div-date')),
                salaryText: normalizeSalary(text(doc, '.detail-job .div-salary')),
                quantity: normalizeQuantity(text(doc, '.detail-job .div-number')),
                facts: [],
                sections: splitSections(linesOf(doc, '#detail-job-content')),
                companyIntro: introFrom(linesOf(doc, '.detail-job-right .gioithieucongty')),
            };
        },
    },
    {
        key: 'jollibee',
        hosts: ['tuyendung.jollibee.com.vn'],
        media: media({ file: 'jollibee.png', origin: 'https://data-talent-v2.basecdn.net/jollibee/logo.png' },
            { file: 'jollibee.jpg', origin: 'https://data-talent-v2.basecdn.net/jollibee/banner-job.jpg' }),
        profile: { employer: 'Jollibee Vietnam', sourceName: 'Jollibee Vietnam – Tuyển dụng chính thức' },
        discover: get => baseHiringLinks(get, 'https://tuyendung.jollibee.com.vn'),
        extract: baseHiring,
    },
    {
        key: 'sungroup',
        hosts: ['tuyendung.sungroup.com.vn'],
        media: media({ file: 'sungroup.png', origin: 'https://data-talent-v2.basecdn.net/sungroup/logo.png' }),
        profile: { employer: 'Tập đoàn Sun Group', sourceName: 'Tuyển dụng Sun Group' },
        discover: get => baseHiringLinks(get, 'https://tuyendung.sungroup.com.vn'),
        extract: baseHiring,
    },
    {
        key: 'hanwha-life',
        hosts: ['hanwhalifevietnam.talent.vn'],
        media: media({ file: 'hanwha-life.png', origin: 'https://data-gcdn.basecdn.net/202312/sys8636/hiring/04/10/HZC97VVCYD/3e3b39039b37dc1424207e2e0c0f341a/MLR9HXJ5MKTD4ZL3EVRHAAQ8BAKRDWBCPSZ97CRKCUGNKY77M764LS875Z3VA7PZX7RSHNSZMX4P9L2CXMULML/b0/4b/e7/7d/70/30b1bb547196a68d90a9cda54bf690b8/horizontal_logo_hanhwa_life_white_background.png' }),
        profile: { employer: 'Hanwha Life Vietnam', sourceName: 'Hanwha Life Vietnam – Cổng tuyển dụng' },
        async discover(get) {
            const html = await get('https://hanwhalifevietnam.talent.vn/');
            return linksIn(html, 'https://hanwhalifevietnam.talent.vn/', /https:\/\/hanwhalifevietnam\.talent\.vn\/job\/[a-z0-9-]+-\d+/g);
        },
        extract(doc) {
            const info = linesOf(doc, '#info-job');
            return {
                title: text(doc, '#job .overview h1') || ogTitle(doc),
                location: listPlace(valueAfter(info, /^Location$/i)),
                deadline: lastDate(valueAfter(info, /^Application deadline$/i)),
                salaryText: normalizeSalary(valueAfter(info, /^Salary$/i)),
                workTypeText: valueAfter(info, /^Type$/i),
                facts: [],
                sections: splitSections(between(linesOf(doc, '#job .article'), null, /^Apply for this job/i)),
            };
        },
    },
    {
        key: 'sapo',
        hosts: ['tuyendung.sapo.vn'],
        media: media({ file: 'sapo.svg', origin: 'https://tuyendung.sapo.vn/Themes/Portal/Default/Styles/Images/logo/Sapo-logo.svg' },
            { file: 'sapo.jpg', origin: 'https://tuyendung.sapo.vn/Themes/Portal/Default/Styles/images/job-detail/article-image.png' }),
        profile: { employer: 'Công ty Cổ phần Công nghệ Sapo', sourceName: 'Sapo – Tuyển dụng chính thức' },
        async discover(get) {
            const html = await get('https://tuyendung.sapo.vn/co-hoi-viec-lam.html');
            return linksIn(html, 'https://tuyendung.sapo.vn/', /(?:https:\/\/tuyendung\.sapo\.vn)?\/co-hoi-viec-lam\/[a-z0-9-]+-a\d+\.html/g);
        },
        extract(doc) {
            const info = linesOf(doc, '.article-detail .info');
            const body = linesOf(doc, '.article-detail .col-lg-8');
            return {
                title: text(doc, '.article-detail h1'),
                location: listPlace(valueAfter(info, /^Địa điểm/i)),
                deadline: lastDate(valueAfter(info, /^Thời gian ứng tuyển/i)),
                salaryText: normalizeSalary(valueAfter(info, /^Thu nhập/i)),
                facts: facts(fact('Ngành nghề', valueAfter(info, /^Ngành nghề/i))),
                sections: splitSections(between(body, /^Mô tả công việc$/i, /^(Liên hệ|Ứng tuyển vị trí)/i, { includeStart: true })),
                companyIntro: introFrom(linesOf(doc, '.article-detail .sapo-desc')),
            };
        },
    },
    {
        key: 'fpt-education',
        hosts: ['career.fpt.edu.vn'],
        media: media({ file: 'fpt-schools.png', origin: 'https://career.fpt.edu.vn/Content/images/logo_unit/logoFE--10-20250905154545.png' },
            { file: 'fpt-schools.jpg', origin: 'https://career.fpt.edu.vn/Content/images/banner2-min.jpg' }),
        profile: { employer: 'Tổ chức Giáo dục FPT', sourceName: 'Tuyển dụng FPT Education' },
        async discover(get) {
            const html = await get('https://career.fpt.edu.vn/Job/Search');
            return linksIn(html, 'https://career.fpt.edu.vn/', /\/Job\/Detail\/\d+/g);
        },
        extract(doc) {
            const intro = $(doc, '#job_introduction');
            const lines = domLines($(doc, '.job-detail-content')).filter(line => !intro || !intro.textContent.includes(line.text));
            const places = texts(between(lines, /^Địa điểm làm việc/i, /^Mô tả công việc/i));
            const placeCodes = places.map(provinceFromAddress);
            return {
                title: firstUpper(valueAfter(lines, /^Vị trí/i) || ogTitle(doc)),
                ...fptEducationUnit(doc),
                postedAt: lastDate((valueAfter(lines, /^Ngày đăng - Ngày hết hạn/i) || '').split(/\s+-\s+/)[0]),
                location: place(places.join('; '), places.length && placeCodes.every(Boolean) ? unique(placeCodes) : null),
                deadline: lastDate(valueAfter(lines, /^Ngày đăng - Ngày hết hạn/i)),
                salaryText: normalizeSalary(valueAfter(lines, /^Mức lương/i)),
                quantity: normalizeQuantity(valueAfter(lines, /^Số lượng/i)),
                facts: facts(fact('Ngành nghề', valueAfter(lines, /^Ngành nghề/i))),
                sections: splitSections(between(lines, /^Địa điểm làm việc/i, /^Số lượng/i, { includeStart: true })),
                companyIntro: introFrom(domLines(intro)),
            };
        },
    },
    {
        key: 'tokyolife',
        hosts: ['tuyendung.tokyolife.vn'],
        media: media({ file: 'tokyolife.png', origin: 'https://tuyendung.tokyolife.vn/frontend/images/logo-tkl.png' },
            { file: 'tokyolife.jpg', origin: 'https://tuyendung.tokyolife.vn/frontend/images/image.jpg' }),
        profile: { employer: 'TokyoLife', sourceName: 'Tuyển dụng TokyoLife' },
        async discover(get) {
            const html = await get('https://tuyendung.tokyolife.vn/');
            return linksIn(html, 'https://tuyendung.tokyolife.vn/', /(?:https:\/\/tuyendung\.tokyolife\.vn)?\/jobs\/\d+/g);
        },
        extract(doc) {
            const table = linesOf(doc, 'table.information-table');
            const address = valueAfter(table, /^Nơi làm việc$/i);
            const code = provinceFromAddress(address);
            return {
                title: text(doc, '.breadcrumb .breadcrumb-item.active'),
                location: place(address, code ? [code] : null),
                deadline: lastDate(valueAfter(table, /^Hạn nộp hồ sơ$/i)),
                salaryText: normalizeSalary(valueAfter(table, /^Thu nhập$/i)),
                quantity: normalizeQuantity(valueAfter(table, /^Số lượng$/i)),
                facts: facts(fact('Công việc', valueAfter(table, /^Công việc$/i)), fact('Chức danh', valueAfter(table, /^Chức danh$/i))),
                sections: splitSections(between(linesOf(doc, 'main .col-sm-9'), /^Mô tả công việc$/i, /^Đăng ký hồ sơ/i, { includeStart: true })),
            };
        },
    },
    {
        key: 'rohto-mentholatum',
        hosts: ['rohto.com.vn'],
        media: media({ file: 'rohto-mentholatum.png', origin: 'https://rohto.com.vn/images/logo_rohto.svg' },
            { file: 'rohto-mentholatum.jpg', origin: 'https://rohto.com.vn/images/b/hinh-1_1.jpg' }),
        extract(doc) {
            const head = linesOf(doc, '.section-detail .block-1');
            return {
                title: ogTitle(doc),
                deadline: lastDate(valueAfter(head, /^Ngày hết hạn/i)),
                quantity: normalizeQuantity(valueAfter(head, /^Số lượng/i)),
                facts: [],
                sections: splitSections(between(linesOf(doc, '.section-detail .content-detail'), null, /^Ứng tuyển ngay/i)),
            };
        },
    },
    {
        key: 'agribank',
        hosts: ['www.agribank.com.vn', 'agribank.com.vn'],
        media: media({ file: 'agribank.png', origin: 'https://www.agribank.com.vn/contenthandler/dav/themelist/custom.portal.theme.AGBank3/assets/images/logo.png' },
            { file: 'agribank.jpg', origin: 'https://www.agribank.com.vn/wcm/connect/e81cbee0-6c2a-4a58-9dd6-b1c09ac5bcd8/desktop/05+copy.jpg' },
            { logoBackground: '#9d1d26' }),
        extract(doc) {
            const lines = between(domLines(doc.body), /^Phòng\/ban$/i, /^Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam$/i, { includeStart: true });
            return {
                title: between(domLines(doc.body), /^Chương trình tuyển dụng$/i, null)[0]?.text || ogTitle(doc),
                deadline: lastDate(valueAfter(lines, /^Hạn nộp hồ sơ$/i)),
                quantity: normalizeQuantity(valueAfter(lines, /^Số lượng cần tuyển$/i)),
                facts: facts(fact('Vị trí trong đợt tuyển dụng', valueAfter(lines, /^Vị trí$/i))),
                sections: splitSections(between(lines, /^Thời gian, địa điểm tiếp nhận/i, null, { includeStart: true })),
            };
        },
    },
    {
        key: 'vieclamhatinh',
        hosts: ['vieclamhatinh.vn'],
        media: media(null),
        extract(doc) {
            const lines = between(domLines($(doc, '#body .well') || doc.body), /^1\. Thông tin tuyển dụng$/i, /^2\. Thông tin liên hệ$/i);
            return {
                title: valueAfter(lines, /^Vị trí tuyển dụng$/i),
                deadline: lastDate(valueAfter(lines, /^Thời hạn$/i)),
                salaryText: normalizeSalary(valueAfter(lines, /^Lương$/i)),
                quantity: normalizeQuantity(valueAfter(lines, /^Số lượng tuyển dụng$/i)),
                workTypeText: valueAfter(lines, /^Thời gian$/i),
                facts: facts(fact('Trình độ', valueAfter(lines, /^Trình độ$/i)), fact('Ngoại ngữ', valueAfter(lines, /^Khả năng ngoại ngữ$/i)),
                    fact('Kinh nghiệm', valueAfter(lines, /^Kinh nghiệm$/i))),
                sections: finalizeSections([
                    { title: 'Mô tả công việc', items: texts(between(lines, /^Mô tả công việc$/i, /^(Quyền lợi|Thời hạn)$/i)) },
                    { title: 'Yêu cầu', items: [valueAfter(lines, /^Yêu cầu khác$/i)].filter(Boolean) },
                ]),
            };
        },
    },
    {
        key: 'fpt-telecom',
        hosts: ['fticareer.vn'],
        media: media({ file: 'fpt-telecom.png', origin: 'https://fticareer.vn/public/img/apple-icon-180x180.png' },
            { file: 'fpt-telecom.jpg', origin: 'https://inside.fticareer.vn//Media/Images/BannerImages/6252025120000AM152434738Join us ver 2.png' }),
        extract(doc) {
            const head = linesOf(doc, '.main--content--subhead .desktop-subhead');
            const all = linesOf(doc, '.main--content');
            return {
                title: ogTitle(doc),
                deadline: lastDate(valueAfter(head, /^Hạn nộp hồ sơ/i)),
                salaryText: normalizeSalary(valueAfter(head, /^Mức lương/i)),
                quantity: normalizeQuantity(valueAfter(all, /^Số lượng cần tuyển/i)),
                workTypeText: valueAfter(all, /^Loại hình công việc/i),
                facts: [],
                sections: splitSections(between(linesOf(doc, '.main--content--body'), null, /^Ứng tuyển$/i)),
            };
        },
    },
    {
        key: 'vieclamcantho',
        hosts: ['vieclamcantho.vn', 'www.vieclamcantho.vn'],
        media: media(null),
        extract(doc) {
            const lines = domLines($(doc, '[id$="dlVD"]') || doc.body);
            const sentences = value => String(value || '').split(/(?<=\.)\s+/).filter(Boolean);
            return {
                title: firstUpper(valueAfter(lines, /^Vị trí tuyển dụng/i) || ''),
                deadline: lastDate(valueAfter(lines, /^Ngày kết thúc nhận hồ sơ/i)),
                salaryText: normalizeSalary(valueAfter(lines, /^Mức lương/i)),
                quantity: normalizeQuantity(valueAfter(lines, /^Số lượng tuyển/i)),
                workTypeText: valueAfter(lines, /^Thời gian làm việc/i),
                facts: facts(fact('Chức danh', valueAfter(lines, /^Chức danh/i)),
                    fact('Trình độ', valueAfter(lines, /^Trình độ chuyên môn kỹ thuật/i)),
                    fact('Ngành nghề đào tạo', valueAfter(lines, /^Ngành nghề đào tạo/i))),
                sections: finalizeSections([
                    { title: 'Mô tả công việc', items: sentences(valueAfter(lines, /^Mô tả công việc/i)) },
                    { title: 'Quyền lợi', items: [valueAfter(lines, /^Quyền lợi/i)].filter(value => value && !/^Yêu cầu hồ sơ/i.test(value)) },
                ]),
            };
        },
    },
    {
        key: 'dat-xanh-mien-trung',
        hosts: ['bdsnammientrung.com'],
        media: media({ file: 'dat-xanh-mien-trung.png', origin: 'https://bdsnammientrung.com/wp-content/uploads/202507140956-dxmt-0x0.png' }),
        extract(doc) {
            const lines = linesOf(doc, '.single-news .section-content');
            const head = between(lines, null, /^Ứng tuyển$/i);
            // The page has no salary field; its benefits list opens with the base-pay sentence.
            const pay = texts(lines).map(line => /Lương cơ bản[^()]*?(?=\s*\(|$)/i.exec(line)?.[0]).find(Boolean);
            return {
                title: ogTitle(doc),
                deadline: lastDate(texts(head).join(' ')),
                salaryText: normalizeSalary(pay?.replace(/^[–-]\s*/, '')),
                quantity: normalizeQuantity((valueAfter(lines, /^Vị trí tuyển dụng$/i) || '').match(/^\d+/)?.[0]),
                facts: facts(fact('Vị trí tuyển dụng', valueAfter(lines, /^Vị trí tuyển dụng$/i))),
                sections: splitSections(between(lines, /Mô tả công việc/i, /^(Ứng tuyển|Phiếu dự tuyển)$/i, { includeStart: true })),
            };
        },
    },
    {
        key: 'the-gioi-di-dong',
        hosts: ['vieclam.thegioididong.com'],
        media: media({ file: 'the-gioi-di-dong.png', origin: 'https://cdnv2.tgdd.vn/vieclam/candidate/avatar/logo-dt-1024-5507c88d-77e0-4c1a-b28c-b5ea8213ffcd.png' },
            { file: 'the-gioi-di-dong.jpg', origin: 'https://vieclam.thegioididong.com/img/web/searchv2/detail_banner/tgdd_v26.png' }),
        profile: { employer: 'Công ty Cổ phần Thế Giới Di Động', sourceName: 'Việc làm Thế Giới Di Động – Tuyển dụng chính thức' },
        async discover(get) {
            const categories = ['cong-nghe-thong-tin-it-lap-trinh', 'marketing-media-pr', 'ke-toan-kiem-toan-tai-chinh',
                'bo-phan-khac-bao-hanh-phap-che', 'kho-van-kho-trung-tam', 'ban-hang-thu-ngan-ky-thuat-kho-sieu-thi'];
            const urls = [];
            for (const category of categories) {
                const html = await get(`https://vieclam.thegioididong.com/tuyen-dung/${category}`);
                urls.push(...linksIn(html, 'https://vieclam.thegioididong.com/', /href="(\/tuyen-dung\/[a-z0-9-]+-\d+)"/g));
            }
            return unique(urls);
        },
        extract(doc) {
            const header = linesOf(doc, '.jobdetail_header');
            const titleIndex = texts(header).findIndex(line => /^Hạn nhận hồ sơ/i.test(line));
            const body = linesOf(doc, '.detaillist-center .job_content_left');
            const all = linesOf(doc, '.detaillist-center');
            // The page lists each workplace province under "Chọn địa điểm làm việc", then street addresses.
            const where = texts(between(all, /^Chọn địa điểm làm việc/i, /^Quy trình tuyển dụng$/i));
            const provinceNames = unique([...doc.querySelectorAll('.list span')].map(node => squash(node.textContent))
                .filter(name => /^(Tỉnh|Thành phố)\s/i.test(name)));
            const addresses = where.filter(line => /Việt Nam\.?$/.test(line)).map(line => line.replace(/,?\s*Việt Nam\.?$/, ''));
            const codes = provinceNames.map(provinceOf);
            return {
                title: titleIndex > 0 ? header[titleIndex - 1].text : text(doc, '.jobdetail_header h1'),
                location: place(addresses.length && addresses.length <= 4 ? addresses.join('; ') : provinceNames.join(', '),
                    codes.length && codes.every(Boolean) ? unique(codes) : null),
                deadline: lastDate(valueAfter(header, /^Hạn nhận hồ sơ/i)),
                salaryText: normalizeSalary(valueAfter(all, /^Thu nhập/i)),
                quantity: normalizeQuantity(valueAfter(all, /^Số lượng tuyển/i)),
                workTypeText: valueAfter(all, /^Hình thức/i),
                facts: facts(fact('Bằng cấp', valueAfter(all, /^Bằng cấp/i)), fact('Kinh nghiệm', valueAfter(all, /^Kinh nghiệm/i)),
                    fact('Cấp bậc', valueAfter(all, /^Cấp bậc/i))),
                sections: splitSections(between(body.length ? body : all, /^Phúc lợi$/i, /(lượt xem\.?$|^Chọn địa điểm làm việc)/i, { includeStart: true })),
            };
        },
    },
    {
        key: 'vnpay',
        hosts: ['tuyendung.vnpay.vn'],
        media: media(null),
        extract(doc) {
            return { title: ogTitle(doc) || text(doc, 'h1'), facts: [], sections: splitSections(domLines($(doc, '.job-detail, article') || doc.body)) };
        },
    },
];

/** Jollibee and Sun Group both publish through Base E-Hiring pages. */
function baseHiring(doc) {
    const head = domLines($(doc, '.detail-head') || $(doc, '.desc-job'));
    const title = text(doc, 'h1.banner--title') || (head[0]?.text ?? '') || ogTitle(doc);
    return {
        title,
        location: listPlace(valueAfter(head, /^Địa điểm/i)),
        deadline: lastDate(valueAfter(head, /^Hạn nộp hồ sơ/i)),
        salaryText: normalizeSalary(valueAfter(head, /^Lương/i)),
        workTypeText: squash($(doc, '.post-type .icon-access_time')?.parentElement?.textContent) || null,
        facts: facts(fact('Phòng ban', valueAfter(head, /^Phòng ban/i) || squash($(doc, '.post-type .icon-briefcase')?.parentElement?.textContent))),
        sections: splitSections(between(linesOf(doc, '.content-article'), null, /^(Ứng tuyển vị trí này|Công việc liên quan)$/i)),
    };
}

/** Base E-Hiring lists vacancies on /jobs?page=N. */
async function baseHiringLinks(get, origin) {
    const urls = [];
    const pattern = new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\/job\\/[a-z0-9-]+-\\d+`, 'g');
    for (let page = 1; page <= 6; page += 1) {
        const html = await get(`${origin}/jobs?page=${page}`);
        const fresh = linksIn(html, origin, pattern).filter(url => !urls.includes(url));
        if (!fresh.length) break;
        urls.push(...fresh);
    }
    return urls;
}

/** FPT Education pages name the hiring unit (university, school…) and show that unit's logo. */
function fptEducationUnit(doc) {
    const img = doc.querySelector('img[alt="Ảnh Đơn Vị Làm Việc"]');
    const src = img?.getAttribute('src');
    const name = squash(img?.parentElement?.nextElementSibling?.textContent) || null;
    if (!src) return { employer: name };
    const file = decodeURIComponent(src.split('/').pop()).replace(/-\d{8,}(?=\.\w+$)/, '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+(?=\.)/g, '').replace(/^-+/, '');
    return { employer: name, logo: { file: `logos/fpt-edu/${file}`, origin: new URL(src, 'https://career.fpt.edu.vn/').href } };
}

export const siteFor = url => {
    const host = new URL(url).hostname.toLowerCase();
    return SITES.find(site => site.hosts.includes(host)) || null;
};

/**
 * Per-vacancy exceptions, each justified in docs/verified-jobs-sources.md.
 * keepTitle: the catalogue title is more specific than the source headline.
 * omit: facts that describe the whole campaign rather than this vacancy.
 */
export const JOB_OVERRIDES = {
    // Agribank's page is the nationwide notice; the Sơn La quota comes from its official PDF annex.
    'external-4c539d8dcdf8': {
        keepTitle: true,
        omit: ['quantity'],
        facts: [{ label: 'Chỉ tiêu tại Chi nhánh Sơn La', value: '5 Tín dụng và 5 Kế toán (phụ lục chỉ tiêu Agribank công bố)' }],
    },
    // The employment centre page lists the whole campaign's head count, not this role's.
    'external-ffde361b6c94': { omit: ['quantity'] },
    'external-f3202a58d8ce': {
        jobImage: { file: 'jobs/external-f3202a58d8ce.jpg', origin: 'https://bdsnammientrung.com/wp-content/uploads/2026/08/202608200845-77563352916770954610888298167571103039248194n.jpg', alt: 'Ảnh tin tuyển dụng Chuyên viên kinh doanh Quảng Trị do Đất Xanh Miền Trung đăng' },
    },
};
