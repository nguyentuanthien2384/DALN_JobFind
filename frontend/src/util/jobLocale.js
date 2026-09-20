import moment from 'moment';
import 'moment/locale/vi';

// Specify the locale on each instance: other screens may change Moment's default.
export const formatJobTime = value => {
    if (value === null || value === undefined || value === '') return 'Chưa cập nhật';
    const timestamp = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Chưa cập nhật';
    const date = moment(timestamp);
    return date.isValid() ? date.locale('vi').fromNow() : 'Chưa cập nhật';
};

const labels = {
    remote: 'Làm việc từ xa',
    'full-time': 'Toàn thời gian',
    fulltime: 'Toàn thời gian',
    'full time': 'Toàn thời gian',
    'part-time': 'Bán thời gian',
    parttime: 'Bán thời gian',
    'part time': 'Bán thời gian',
    internship: 'Thực tập',
    intern: 'Thực tập sinh',
    hybrid: 'Kết hợp tại văn phòng và từ xa',
    onsite: 'Làm việc tại văn phòng',
    'on-site': 'Làm việc tại văn phòng',
    freelance: 'Làm việc tự do',
    contract: 'Hợp đồng',
    negotiable: 'Thỏa thuận',
    'thoả thuận': 'Thỏa thuận',
    competitive: 'Cạnh tranh',
    fresher: 'Mới tốt nghiệp',
    junior: 'Nhân viên sơ cấp',
    senior: 'Nhân viên cao cấp',
    manager: 'Quản lý',
    director: 'Giám đốc',
    'team leader': 'Trưởng nhóm',
    staff: 'Nhân viên',
    employee: 'Nhân viên',
    'no experience': 'Không yêu cầu kinh nghiệm',
};

export const jobLabel = input => {
    const value = typeof input === 'object' ? input?.value : input;
    if (value === null || value === undefined || String(value).trim() === '') return 'Chưa cập nhật';
    const text = String(value).trim();
    return labels[text.toLocaleLowerCase('vi')] || text;
};
