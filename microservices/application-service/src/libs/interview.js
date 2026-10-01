import { interviewSchema } from '../../../shared/contracts/interviewSchema.js';
import { validDate, validTime, validMeetingUrl, validContactEmail } from './offer.js';

export const INTERVIEW_MODES = ['onsite', 'online', 'phone'];

// Thu moi phong van phai du de ung vien den dung gio, dung cho ma khong can hoi lai:
// thoi gian o tuong lai, dia diem/duong dan/so dien thoai theo hinh thuc, va nguoi
// lien he nhan phan hoi. Truong tuy chon de trong thi bo khoi snapshot.
export const validateInterview = (input, now = Date.now()) => {
    const fail = (error) => ({ error });
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Vui lòng điền thông tin thư mời phỏng vấn');
    const interview = {};
    for (const [key, value] of Object.entries(input)) {
        const rule = interviewSchema.properties[key];
        if (!Object.hasOwn(interviewSchema.properties, key) || typeof value !== 'string' || value.length > (rule.maxLength || 100)) return fail('Thông tin thư mời phỏng vấn không hợp lệ hoặc quá dài');
        if (value.trim()) interview[key] = value.trim();
    }
    if (interviewSchema.required.some((key) => !interview[key])) return fail('Vui lòng điền đủ ngày giờ phỏng vấn, hình thức và người liên hệ');
    if (interview.timeZone !== 'Asia/Ho_Chi_Minh') return fail('Thời gian phỏng vấn phải theo giờ Việt Nam (UTC+7)');
    if (!validDate(interview.interviewDate) || !validTime(interview.interviewTime)) return fail('Ngày hoặc giờ phỏng vấn không hợp lệ');
    const start = Date.parse(`${interview.interviewDate}T${interview.interviewTime}:00+07:00`);
    if (start <= now) return fail('Thời gian phỏng vấn phải ở tương lai');
    if (interview.durationMinutes !== undefined) {
        const minutes = Number(interview.durationMinutes);
        if (!/^[1-9][0-9]{1,2}$/.test(interview.durationMinutes) || minutes < 15 || minutes > 480) return fail('Thời lượng phỏng vấn phải từ 15 đến 480 phút');
    }
    if (!INTERVIEW_MODES.includes(interview.interviewMode)) return fail('Hình thức phỏng vấn không hợp lệ');
    // Chi giu thong tin cua hinh thuc da chon de email khong dua ra hai noi hen.
    if (interview.interviewMode !== 'onsite') delete interview.location;
    if (interview.interviewMode !== 'online') delete interview.meetingUrl;
    if (interview.interviewMode === 'onsite' && !interview.location) return fail('Vui lòng nhập địa điểm phỏng vấn cụ thể');
    if (interview.interviewMode === 'online' && !interview.meetingUrl) return fail('Vui lòng nhập đường dẫn phỏng vấn trực tuyến');
    if (interview.interviewMode === 'phone' && !interview.contactPhone) return fail('Vui lòng nhập số điện thoại sẽ liên hệ phỏng vấn');
    if (interview.meetingUrl && !validMeetingUrl(interview.meetingUrl)) return fail('Đường dẫn trực tuyến phải là URL http hoặc https hợp lệ');
    if (!validContactEmail(input.contactEmail, interview.contactEmail)) return fail('Email người liên hệ không hợp lệ');
    if (interview.confirmBy !== undefined) {
        const [date, time, extra] = interview.confirmBy.split('T');
        if (extra !== undefined || !validDate(date) || !validTime(time || '')) return fail('Hạn xác nhận tham gia không hợp lệ');
        const confirmBy = Date.parse(`${interview.confirmBy}:00+07:00`);
        if (confirmBy <= now || confirmBy > start) return fail('Hạn xác nhận phải ở tương lai và không sau giờ phỏng vấn');
    }
    return { interview };
};
