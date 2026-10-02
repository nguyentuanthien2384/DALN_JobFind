import dayjs from 'dayjs';

// Phep tinh thuan cho dashboard quan tri: khoang thoi gian, so sanh voi ky
// truoc, chuoi theo ngay va mo ta su kien. Tach rieng de kiem thu khong can
// dung giao dien.

export const DAY = 'YYYY-MM-DD';

export const PERIODS = [
    { key: 'today', label: 'Hôm nay', days: 1 },
    { key: '7d', label: '7 ngày', days: 7 },
    { key: '30d', label: '30 ngày', days: 30 },
    { key: '90d', label: '90 ngày', days: 90 },
];
export const DEFAULT_PERIOD = '30d';
const MAX_CUSTOM_DAYS = 366;

const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && dayjs(value).isValid() && dayjs(value).format(DAY) === value;

/**
 * Khoang dang xem va khoang lien truoc co cung do dai (de so sanh).
 * `custom` can from/to hop le, khong vuot qua hom nay va toi da 366 ngay;
 * sai thi quay ve mac dinh thay vi gui khoang ngay hong len may chu.
 */
export const resolvePeriod = ({ period, from, to } = {}, now = dayjs()) => {
    const today = dayjs(now).startOf('day');
    let start;
    let end = today;
    let key = period;
    if (period === 'custom' && isDay(from) && isDay(to) && from <= to && !dayjs(to).isAfter(today)
        && dayjs(to).diff(dayjs(from), 'day') < MAX_CUSTOM_DAYS) {
        start = dayjs(from);
        end = dayjs(to);
    } else {
        const preset = PERIODS.find(item => item.key === period) || PERIODS.find(item => item.key === DEFAULT_PERIOD);
        key = preset.key;
        start = today.subtract(preset.days - 1, 'day');
    }
    const days = end.diff(start, 'day') + 1;
    const previousEnd = start.subtract(1, 'day');
    return {
        key,
        days,
        from: start.format(DAY),
        to: end.format(DAY),
        previous: { from: previousEnd.subtract(days - 1, 'day').format(DAY), to: previousEnd.format(DAY) },
    };
};

/**
 * Khoang ve bieu do xu huong. Ky ngan hon 7 ngay (vd: "Hom nay") chi co mot
 * diem, khong the hien duoc xu huong, nen bieu do mo rong thanh 14 ngay gan nhat.
 */
export const trendPeriodFor = (period) => (period.days >= 7 ? period : resolvePeriod({
    period: 'custom',
    from: dayjs(period.to).subtract(13, 'day').format(DAY),
    to: period.to,
}, dayjs(period.to)));

/** Phan tram thay doi so voi ky truoc; null khi ky truoc bang 0 (khong co moc so sanh). */
export const percentChange = (current, previous) => {
    const now = Number(current) || 0;
    const before = Number(previous) || 0;
    if (before === 0) return now === 0 ? 0 : null;
    return ((now - before) / before) * 100;
};

const dayOf = (value) => {
    if (isDay(value)) return value;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format(DAY) : null;
};

/** Gom cac dong {ngay, soLuong|tien} vao Map theo ngay (cong don neu trung ngay). */
export const byDay = (rows, valueKey = 'soLuong') => {
    const map = new Map();
    (rows || []).forEach(row => {
        const day = dayOf(row?.ngay);
        if (day) map.set(day, (map.get(day) || 0) + (Number(row[valueKey]) || 0));
    });
    return map;
};

export const eachDay = (from, to) => {
    const days = [];
    for (let day = dayjs(from); !day.isAfter(dayjs(to)); day = day.add(1, 'day')) days.push(day.format(DAY));
    return days;
};

export const sumRange = (map, from, to) => eachDay(from, to).reduce((total, day) => total + (map.get(day) || 0), 0);

/**
 * Chuoi theo ngay cho bieu do xu huong: moi ngay trong ky co mot diem (ngay
 * khong co du lieu la 0), kem gia tri cung vi tri cua ky truoc de ve duong
 * so sanh.
 */
export const buildTrend = (map, period) => {
    const previousDays = eachDay(period.previous.from, period.previous.to);
    return eachDay(period.from, period.to).map((day, index) => ({
        day,
        label: dayjs(day).format('DD/MM'),
        current: map.get(day) || 0,
        previous: map.get(previousDays[index]) || 0,
    }));
};

/** "vừa xong", "5 phút trước", "3 giờ trước", "Hôm qua 14:05" hoặc "28/09 09:12". */
export const relativeTime = (value, now = dayjs()) => {
    const time = dayjs(value);
    if (!time.isValid()) return '';
    const minutes = dayjs(now).diff(time, 'minute');
    if (minutes < 1) return 'vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    if (minutes < 24 * 60 && time.isSame(now, 'day')) return `${Math.floor(minutes / 60)} giờ trước`;
    if (time.isSame(dayjs(now).subtract(1, 'day'), 'day')) return `Hôm qua ${time.format('HH:mm')}`;
    return time.format(time.isSame(now, 'year') ? 'DD/MM HH:mm' : 'DD/MM/YYYY');
};

const numberFormat = new Intl.NumberFormat('vi-VN');
const moneyFormat = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export const formatNumber = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : numberFormat.format(Number(value)));
export const formatMoney = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : moneyFormat.format(Number(value)));
export const formatPercent = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : `${percentFormat.format(Number(value))}%`);

export const STAGE_LABELS = {
    moi_ung_tuyen: 'Mới ứng tuyển', dang_xem_xet: 'Đang xem xét', phong_van: 'Phỏng vấn',
    de_nghi: 'Đề nghị nhận việc', nhan_viec: 'Đã nhận việc', tu_choi: 'Từ chối',
};

const AI_TASKS = {
    parse_resume: 'đọc CV', generate_cv: 'tạo CV', match_cv: 'chấm độ phù hợp CV',
    cover_letter: 'viết thư ứng tuyển', write_assist: 'soạn nội dung', moderate_job: 'kiểm duyệt tin',
};

const EVENTS = {
    'job.created': { title: 'Tin tuyển dụng mới được đăng', icon: 'fas fa-briefcase', tone: 'primary' },
    'job.updated': { title: 'Tin tuyển dụng được cập nhật', icon: 'fas fa-pen', tone: 'neutral' },
    'job.deleted': { title: 'Tin tuyển dụng bị xóa', icon: 'fas fa-trash-alt', tone: 'danger' },
    'job.moderated': { title: 'Tin đã qua kiểm duyệt tự động', icon: 'fas fa-shield-alt', tone: 'success' },
    'company.updated': { title: 'Hồ sơ công ty thay đổi', icon: 'far fa-building', tone: 'neutral' },
    'notification.manual_moderation_requested': { title: 'Tin cần quản trị viên duyệt thủ công', icon: 'fas fa-user-shield', tone: 'warning' },
    'notification.job_approved_requested': { title: 'Gửi thông báo tin đã được duyệt', icon: 'far fa-bell', tone: 'neutral' },
    'application.submitted': { title: 'Ứng viên nộp hồ sơ', icon: 'fas fa-file-import', tone: 'primary' },
    'application.stage_changed': { title: 'Hồ sơ chuyển bước tuyển dụng', icon: 'fas fa-exchange-alt', tone: 'neutral' },
    'application.interview_invitation_requested': { title: 'Gửi thư mời phỏng vấn', icon: 'far fa-calendar-check', tone: 'success' },
    'application.decision_email_requested': { title: 'Gửi email kết quả tuyển dụng', icon: 'far fa-envelope', tone: 'success' },
};

/** Mo ta mot ban ghi nhat ky su kien bang tieng Viet de quan tri vien doc duoc. */
export const describeEvent = (log = {}) => {
    const name = String(log.name || '');
    const payload = log.payload || {};
    let event = EVENTS[name];
    if (!event && name === 'ai.result') {
        const task = AI_TASKS[payload.type] || 'xử lý';
        event = payload.ok === false
            ? { title: `AI ${task} thất bại`, icon: 'fas fa-robot', tone: 'danger' }
            : { title: `AI ${task} hoàn tất`, icon: 'fas fa-robot', tone: 'success' };
    } else if (!event && name.startsWith('ai.')) {
        event = { title: `Yêu cầu AI ${AI_TASKS[name.slice(3)] || 'xử lý'}`, icon: 'fas fa-robot', tone: 'neutral' };
    }
    if (name === 'application.stage_changed' && STAGE_LABELS[payload.toStage]) {
        event = { ...event, title: `Hồ sơ chuyển sang “${STAGE_LABELS[payload.toStage]}”` };
    }
    if (!event) event = { title: name || 'Sự kiện hệ thống', icon: 'fas fa-circle', tone: 'neutral' };
    const target = log.targetType === 'job' && log.targetId ? { label: `Tin #${log.targetId}`, to: `/detail-job/${log.targetId}` }
        : log.targetType === 'application' && log.targetId ? { label: `Hồ sơ #${log.targetId}` }
            : null;
    return { ...event, target };
};

export const SERVICE_LABELS = {
    legacy: 'Backend nghiệp vụ',
    identity: 'Tài khoản & hồ sơ',
    jobs: 'Tin tuyển dụng & AI',
    search: 'Tìm kiếm',
    applications: 'Hồ sơ ứng tuyển',
    admin: 'Báo cáo & nhật ký',
    support: 'Chatbot hỗ trợ',
};

/** Top N muc va gop phan con lai thanh "Khac". */
export const topWithOther = (rows, limit = 6, otherLabel = 'Khác') => {
    const clean = (rows || []).map(row => ({ name: row.ten || 'Chưa phân loại', value: Number(row.soLuong) || 0 }))
        .filter(row => row.value > 0)
        .sort((a, b) => b.value - a.value);
    const total = clean.reduce((sum, row) => sum + row.value, 0);
    const head = clean.slice(0, limit);
    const rest = clean.slice(limit).reduce((sum, row) => sum + row.value, 0);
    const list = rest > 0 ? [...head, { name: otherLabel, value: rest, other: true }] : head;
    return { total, rows: list.map(row => ({ ...row, share: total ? (row.value / total) * 100 : 0 })) };
};
