import moment from 'moment';
import 'moment/locale/vi';
import { canonicalJobLevel } from './jobLevels';

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
    intern: 'Intern',
    hybrid: 'Kết hợp tại văn phòng và từ xa',
    onsite: 'Làm việc tại văn phòng',
    'on-site': 'Làm việc tại văn phòng',
    freelance: 'Làm việc tự do',
    contract: 'Hợp đồng',
    negotiable: 'Thỏa thuận',
    'thoả thuận': 'Thỏa thuận',
    competitive: 'Cạnh tranh',
    fresher: 'Fresher',
    junior: 'Junior',
    middle: 'Middle',
    senior: 'Senior',
    lead: 'Lead',
    manager: 'Manager',
    director: 'Giám đốc',
    'team leader': 'Trưởng nhóm',
    staff: 'Nhân viên',
    employee: 'Nhân viên',
    'no experience': 'Không yêu cầu kinh nghiệm',
};

// Keep the IT career ladder in progression order in filters and posting forms.
const jobLevelOrder = ['Intern', 'Fresher', 'Junior', 'Middle', 'Senior', 'Lead', 'Manager'];
export const sortJobLevels = rows => {
    const rank = row => {
        const codeIndex = jobLevelOrder.findIndex(level => level.toLowerCase() === canonicalJobLevel(row.code));
        const index = codeIndex < 0 ? jobLevelOrder.indexOf(jobLabel(row)) : codeIndex;
        return index < 0 ? jobLevelOrder.length : index;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
};

export const jobLabel = input => {
    const value = typeof input === 'object' ? input?.value : input;
    if (value === null || value === undefined || String(value).trim() === '') return 'Chưa cập nhật';
    const text = String(value).trim();
    return labels[text.toLocaleLowerCase('vi')] || text;
};
