const ZONE = 'Asia/Ho_Chi_Minh';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const vietnamDate = (value = new Date()) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(dateFormat.formatToParts(date).map(({ type, value: part }) => [type, part]));
    return `${parts.year}-${parts.month}-${parts.day}`;
};
export const vietnamTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('vi-VN', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '';
};
export const dateLabel = (date) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));
const dateKey = (date) => date.toISOString().slice(0, 10);
export const calendarDays = (month) => {
    const [year, number] = month.split('-').map(Number);
    const first = new Date(Date.UTC(year, number - 1, 1));
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => dateKey(new Date(first.getTime() + index * 86400000)));
};
export const adjacentMonth = (month, direction) => {
    const [year, number] = month.split('-').map(Number);
    return dateKey(new Date(Date.UTC(year, number - 1 + direction, 1))).slice(0, 7);
};
export const safeMeetingUrl = (value) => {
    try {
        if (!value || /\s/.test(value)) return null;
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
    } catch { return null; }
};

const escapeIcs = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const utcStamp = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Fold at 75 UTF-8 bytes, including the continuation space (RFC 5545).
const foldLine = (line) => {
    const chunks = [];
    let current = '';
    let bytes = 0;
    for (const character of line) {
        const size = character.codePointAt(0) <= 0x7f ? 1 : character.codePointAt(0) <= 0x7ff ? 2 : character.codePointAt(0) <= 0xffff ? 3 : 4;
        if (bytes + size > 75) { chunks.push(current); current = ' '; bytes = 1; }
        current += character; bytes += size;
    }
    return [...chunks, current].join('\r\n');
};
export const createInterviewIcs = (event, now = new Date()) => {
    const start = new Date(event.startAt).getTime();
    const end = new Date(event.endAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Thời gian lịch phỏng vấn không hợp lệ');
    const interview = event.interview || {};
    const location = interview.interviewMode === 'online' ? safeMeetingUrl(interview.meetingUrl) || '' : interview.interviewMode === 'phone' ? interview.contactPhone : interview.location;
    const description = [interview.round, interview.interviewers && `Người phỏng vấn: ${interview.interviewers}`, interview.contactName && `Liên hệ: ${interview.contactName}`, interview.contactEmail, interview.contactPhone, interview.preparation, event.message].filter(Boolean).join('\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JobFind//Interview Calendar//VI', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
        `UID:interview-${escapeIcs(event.applicationId)}-${escapeIcs(event.id)}@jobfind`, `DTSTAMP:${utcStamp(now)}`,
        `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`, `SUMMARY:${escapeIcs(`Phỏng vấn ${event.jobTitle || ''} — ${event.companyName || interview.companyName || ''}`)}`,
        `LOCATION:${escapeIcs(location)}`, `DESCRIPTION:${escapeIcs(description)}`, 'END:VEVENT', 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
};
export const downloadInterviewIcs = (event) => {
    const url = URL.createObjectURL(new Blob([createInterviewIcs(event)], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `phong-van-${String(event.applicationId).replace(/[^a-zA-Z0-9_-]/g, '')}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
