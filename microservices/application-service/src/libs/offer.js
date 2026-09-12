import { offerSchema } from '../../../shared/contracts/offerSchema.js';

const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validTime = (value) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);

export const validateOffer = (input, now = Date.now()) => {
    const fail = (error) => ({ error });
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Vui lòng điền thông tin thư mời nhận việc');
    const offer = {};
    for (const [key, value] of Object.entries(input)) {
        const rule = offerSchema.properties[key];
        if (!Object.hasOwn(offerSchema.properties, key) || typeof value !== 'string' || value.length > (rule.maxLength || 100)) return fail('Thông tin thư mời không hợp lệ hoặc quá dài');
        offer[key] = value.trim();
    }
    if (offerSchema.required.some((key) => !offer[key])) return fail('Vui lòng điền đủ ngày giờ nhận việc, hình thức, người liên hệ và hạn phản hồi');
    if (offer.timeZone !== 'Asia/Ho_Chi_Minh') return fail('Thời gian nhận việc phải theo giờ Việt Nam (UTC+7)');
    if (!validDate(offer.startDate) || !validTime(offer.startTime)) return fail('Ngày hoặc giờ nhận việc không hợp lệ');
    const deadline = offer.responseDeadline.split('T');
    if (deadline.length !== 2 || !validDate(deadline[0]) || !validTime(deadline[1])) return fail('Hạn phản hồi không hợp lệ');
    const start = Date.parse(`${offer.startDate}T${offer.startTime}:00+07:00`);
    const end = Date.parse(`${offer.responseDeadline}:00+07:00`);
    if (start <= now) return fail('Thời gian nhận việc phải ở tương lai');
    if (end <= now || end > start) return fail('Hạn phản hồi phải ở tương lai và không sau thời gian nhận việc');
    if (!['onsite', 'remote', 'hybrid'].includes(offer.workMode)) return fail('Hình thức làm việc không hợp lệ');
    if (offer.workMode !== 'remote' && !offer.location) return fail('Vui lòng nhập địa điểm nhận việc cụ thể');
    if (offer.workMode === 'remote' && !offer.meetingUrl) return fail('Vui lòng nhập đường dẫn nhận việc trực tuyến');
    if (offer.meetingUrl) {
        try {
            const url = new URL(offer.meetingUrl);
            if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(offer.meetingUrl)) throw new Error();
        } catch { return fail('Đường dẫn trực tuyến phải là URL http hoặc https hợp lệ'); }
    }
    const localPart = offer.contactEmail.split('@')[0];
    const domain = offer.contactEmail.split('@')[1] || '';
    if (/[\u0000-\u001f\u007f]/.test(input.contactEmail) || localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')
        || domain.split('.').some((label) => label.length > 63)
        || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(offer.contactEmail)) return fail('Email người liên hệ không hợp lệ');
    return { offer };
};
