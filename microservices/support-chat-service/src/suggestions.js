import { normalize } from './knowledge.js';

// The model ends an answer with "[[GOI_Y]] câu 1 | câu 2 | câu 3". That part is never
// shown or stored as answer text; it becomes quick-reply buttons instead. Models do not
// always start a new line for it, and sometimes write the tag with Vietnamese marks.
const MARKER = /\[\[\s*g[oơờớợ]i[\s_-]*[yýỳ]\s*\]\]/i;
// "[" or "[[" plus a few characters at the end could still become the marker.
const UNDECIDED_TAIL = /\[(?:\[[^\]\n]{0,12})?$/;
const MAX_SUGGESTIONS = 3;

// Text that is safe to show so far; an undecided tail is held back until it is known.
export function visibleText(raw, done = false) {
    const cut = raw.search(MARKER);
    if (cut >= 0) return raw.slice(0, cut);
    if (done) return raw;
    const tail = raw.search(UNDECIDED_TAIL);
    return tail >= 0 ? raw.slice(0, tail) : raw;
}

const clean = value => String(value || '').replace(/[*_`#>[\]]/g, '').replace(/^\s*(?:[-•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim();
const unique = values => values.filter((value, index) => values.findIndex(other => normalize(other) === normalize(value)) === index);
export const safeSuggestions = values => unique((Array.isArray(values) ? values : []).map(clean)
    .filter(value => value.length >= 2 && value.length <= 80)).slice(0, MAX_SUGGESTIONS);

export function parseSuggestions(raw) {
    const match = MARKER.exec(raw);
    if (!match) return [];
    return safeSuggestions(raw.slice(match.index + match[0].length).split(/\||\n/));
}

const TOPIC_SUGGESTIONS = {
    account: ['Tôi không nhận được mã OTP', 'Đổi mật khẩu ở đâu?'],
    jobs: ['Có việc IT nào đang tuyển?', 'Công ty nào đang tuyển nhiều nhất?'],
    cv: ['Mẹo viết CV cho người mới đi làm', 'Theo dõi đơn ứng tuyển ở đâu?'],
    applications: ['Bao lâu thì nhà tuyển dụng phản hồi?', 'Mẹo chuẩn bị phỏng vấn'],
    saved: ['Có việc IT nào đang tuyển?', 'Làm sao ứng tuyển một tin đã lưu?'],
    employer: ['Mua gói đăng tin thế nào?', 'Vì sao tin chưa được duyệt?'],
    payment: ['Xem hạn mức gói ở đâu?', 'Đã thanh toán nhưng chưa nhận gói'],
    chat: ['Gặp nhân viên hỗ trợ JobFind', 'Làm sao nhắn tin với nhà tuyển dụng?'],
    privacy: ['Xóa lịch sử trò chuyện thế nào?', 'Dữ liệu của tôi được lưu bao lâu?']
};
const DEFAULT_SUGGESTIONS = ['Có việc IT nào đang tuyển?', 'Mẹo phỏng vấn xin việc', 'Làm sao tạo CV trên JobFind?'];

// Used when the model omitted the line, or when no model answered at all.
export function fallbackSuggestions({ sources = [], tools = [] } = {}) {
    const search = tools.filter(item => item.name === 'search_jobs').at(-1);
    const values = [];
    if (search) {
        if (search.count > 0) values.push('Xem chi tiết tin đầu tiên', 'Tìm việc tương tự ở tỉnh khác');
        else values.push('Xem các việc mới nhất', 'Công ty nào đang tuyển nhiều nhất?');
    }
    if (tools.some(item => item.name === 'get_job_details' && item.found)) values.push('Tin này yêu cầu kinh nghiệm gì?', 'Tìm việc tương tự');
    if (tools.some(item => item.name === 'job_market_overview')) values.push('Xem các việc mới nhất', 'Ở Hà Nội có bao nhiêu việc?');
    // Job tools describe this turn better than reviewed articles matched by keywords.
    for (const source of tools.length ? [] : sources) values.push(...(TOPIC_SUGGESTIONS[source.id] || []));
    return safeSuggestions([...values, ...DEFAULT_SUGGESTIONS]);
}
