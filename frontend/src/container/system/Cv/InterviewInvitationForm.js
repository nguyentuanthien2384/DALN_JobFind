import React, { useState } from 'react';

// key, nhãn, kiểu, độ dài tối đa, bắt buộc, chỉ hiện với hình thức
const fields = [
    ['companyName', 'Tên công ty', 'text', 255, true],
    ['interviewDate', 'Ngày phỏng vấn', 'date', 10, true],
    ['interviewTime', 'Giờ bắt đầu', 'time', 5, true],
    ['location', 'Địa điểm phỏng vấn cụ thể', 'text', 1000, false, 'onsite'],
    ['meetingUrl', 'Link phòng họp trực tuyến (Google Meet, Zoom, Teams…)', 'url', 2000, false, 'online'],
    ['round', 'Vòng phỏng vấn', 'text', 150],
    ['interviewers', 'Người phỏng vấn', 'text', 500],
    ['contactName', 'Người liên hệ HR', 'text', 150, true],
    ['contactEmail', 'Email HR nhận phản hồi', 'email', 254, true],
    ['contactPhone', 'Số điện thoại HR', 'tel', 50],
    ['confirmBy', 'Hạn xác nhận tham gia', 'datetime-local', 16],
    ['preparation', 'Ứng viên cần chuẩn bị / mang theo', 'textarea', 3000],
];
export const interviewModes = { onsite: 'Trực tiếp tại văn phòng', online: 'Trực tuyến (video call)', phone: 'Qua điện thoại' };
const durations = ['30', '45', '60', '90', '120'];
const weekdays = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const validTime = (time) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time);
const visible = (key, mode) => {
    const only = fields.find(([name]) => name === key)?.[5];
    return !only || only === mode;
};

// Cùng quy tắc với application-service: giờ Việt Nam, ở tương lai, đủ nơi hẹn theo hình thức.
export const validateInterviewForm = (interview, now = Date.now()) => {
    for (const [key, label, , max, required] of fields) {
        const value = interview[key] || '';
        if ((required && !value.trim()) || value.length > max) return `Vui lòng kiểm tra ${label.toLowerCase()}`;
    }
    if (!validDate(interview.interviewDate) || !validTime(interview.interviewTime)) return 'Ngày hoặc giờ phỏng vấn không hợp lệ';
    const start = Date.parse(`${interview.interviewDate}T${interview.interviewTime}:00+07:00`);
    if (start <= now) return 'Thời gian phỏng vấn phải ở tương lai';
    if (!Object.prototype.hasOwnProperty.call(interviewModes, interview.interviewMode)) return 'Hình thức phỏng vấn không hợp lệ';
    if (interview.interviewMode === 'onsite' && !interview.location?.trim()) return 'Vui lòng nhập địa điểm phỏng vấn cụ thể';
    if (interview.interviewMode === 'online' && !interview.meetingUrl?.trim()) return 'Vui lòng nhập link phòng họp trực tuyến';
    if (interview.interviewMode === 'phone' && !interview.contactPhone?.trim()) return 'Vui lòng nhập số điện thoại sẽ gọi cho ứng viên';
    if (interview.interviewMode === 'online') {
        try {
            const url = new URL(interview.meetingUrl);
            if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(interview.meetingUrl)) throw new Error();
        } catch { return 'Link trực tuyến phải là URL http hoặc https hợp lệ'; }
    }
    const [localPart, domain = ''] = interview.contactEmail.split('@');
    if (localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..') || domain.split('.').some((label) => label.length > 63)
        || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(interview.contactEmail)) return 'Email người liên hệ không hợp lệ';
    if (interview.confirmBy) {
        const [date, time] = interview.confirmBy.split('T');
        if (!validDate(date) || !validTime(time || '')) return 'Hạn xác nhận tham gia không hợp lệ';
        const confirmBy = Date.parse(`${interview.confirmBy}:00+07:00`);
        if (confirmBy <= now || confirmBy > start) return 'Hạn xác nhận phải ở tương lai và không sau giờ phỏng vấn';
    }
    return '';
};

// Chỉ gửi thông tin của hình thức đã chọn; bỏ các ô tùy chọn để trống.
const payloadOf = (interview) => Object.fromEntries(Object.entries(interview)
    .map(([key, value]) => [key, String(value).trim()])
    .filter(([key, value]) => value && (['timeZone', 'interviewMode', 'durationMinutes'].includes(key) || visible(key, interview.interviewMode))));

export const formatInterviewTime = ({ interviewDate, interviewTime }) => {
    if (!validDate(interviewDate || '') || !validTime(interviewTime || '')) return '';
    return `${weekdays[new Date(`${interviewDate}T00:00:00Z`).getUTCDay()]}, ${interviewDate.split('-').reverse().join('/')} lúc ${interviewTime}`;
};
const formatDeadline = (value) => {
    const [date, time] = value.split('T');
    return `${date.split('-').reverse().join('/')} lúc ${time}`;
};

export function InterviewSummary({ interview }) {
    return <dl className="kb-offer-summary">
        <dt>Thời gian</dt><dd>{formatInterviewTime(interview)} (giờ Việt Nam, UTC+7)</dd>
        {interview.durationMinutes && <><dt>Thời lượng dự kiến</dt><dd>{interview.durationMinutes} phút</dd></>}
        <dt>Hình thức</dt><dd>{interviewModes[interview.interviewMode]}</dd>
        {fields.filter(([key]) => !['interviewDate', 'interviewTime'].includes(key) && interview[key]).map(([key, label]) => <React.Fragment key={key}>
            <dt>{label}</dt><dd>{key === 'confirmBy' ? formatDeadline(interview[key]) : interview[key]}</dd>
        </React.Fragment>)}
    </dl>;
}

export default function InterviewInvitationForm({ detail, user, company, message, busy, onSend, onCancel }) {
    const [interview, setInterview] = useState(() => {
        // Gửi lại (đổi lịch) bắt đầu từ thư mời gần nhất; lần đầu điền sẵn công ty và HR.
        const previous = (detail.timeline || []).find((event) => event.decision_snapshot?.decision === 'interview')?.decision_snapshot?.interview;
        return { ...Object.fromEntries(fields.map(([key]) => [key, ''])), timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'onsite', durationMinutes: '60',
            companyName: company?.name || user.companyName || '', location: company?.address || '',
            contactName: [user.firstName, user.lastName].filter(Boolean).join(' '), contactEmail: user.email || '', ...previous };
    });
    const [preview, setPreview] = useState(false);
    const [error, setError] = useState('');
    const cleaned = () => payloadOf(interview);
    const review = () => {
        const problem = validateInterviewForm(interview);
        setError(problem);
        if (!problem) setPreview(true);
    };
    const send = () => {
        const problem = validateInterviewForm(interview);
        setError(problem);
        if (!problem) onSend(cleaned());
    };
    const update = (key, value) => { setError(''); setInterview({ ...interview, [key]: value }); };
    const data = cleaned();
    return <section className="kb-offer kb-interview" aria-label="Soạn thư mời phỏng vấn">
        <h5>{preview ? 'Xem trước thư mời phỏng vấn' : 'Thông tin thư mời phỏng vấn'}</h5>
        <p className="kb-hint">Các mục có * là bắt buộc. Ngày giờ theo giờ Việt Nam (UTC+7). Sau khi gửi, hồ sơ chuyển sang bước Phỏng vấn; ứng viên trả lời email để xác nhận với HR.</p>
        {error && <p role="alert" className="kb-offer-error">{error}</p>}
        {preview ? <div className="kb-offer-preview">
            <p><b>Đến:</b> {detail.candidate_name} · {detail.candidate_email}</p>
            <p><b>Tiêu đề:</b> Thư mời phỏng vấn — {detail.job_title}</p>
            <p>Chào {detail.candidate_name || 'bạn'}, cảm ơn bạn đã ứng tuyển vị trí <b>{detail.job_title}</b>{data.companyName ? ` tại ${data.companyName}` : ''}. Chúng tôi trân trọng mời bạn tham gia buổi phỏng vấn với thông tin dưới đây.</p>
            <InterviewSummary interview={data} />
            {message && <p className="kb-cover">{message}</p>}
            <p>Vui lòng trả lời email này đến <b>{data.contactEmail}</b>{data.confirmBy ? ` trước ${formatDeadline(data.confirmBy)}` : ''} để xác nhận tham gia hoặc đề xuất thời gian khác.</p>
            <p>Trân trọng,<br />{data.contactName}<br />{data.companyName}</p>
            <p className="kb-hint">Email có nút xem hồ sơ ứng tuyển, liên kết thêm lịch vào Google Calendar và phản hồi trực tiếp đến HR.</p>
        </div> : <fieldset disabled={busy} className="kb-offer-fields">
            <label>Hình thức phỏng vấn *<select value={interview.interviewMode} onChange={(event) => update('interviewMode', event.target.value)}>
                {Object.entries(interviewModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Thời lượng dự kiến<select value={interview.durationMinutes} onChange={(event) => update('durationMinutes', event.target.value)}>
                {durations.map((value) => <option key={value} value={value}>{value} phút</option>)}
            </select></label>
            {fields.filter(([key]) => visible(key, interview.interviewMode)).map(([key, label, type, maxLength, required]) => {
                const needed = required || ['location', 'meetingUrl'].includes(key) || (key === 'contactPhone' && interview.interviewMode === 'phone');
                const props = { value: interview[key], maxLength, required: needed, onChange: (event) => update(key, event.target.value) };
                return <label key={key} className={type === 'textarea' || key === 'location' || key === 'meetingUrl' ? 'kb-offer-wide' : ''}>{label}{needed ? ' *' : ''}
                    {type === 'textarea' ? <textarea {...props} rows={2} /> : <input {...props} type={type} />}
                </label>;
            })}
        </fieldset>}
        <div className="kb-decision-actions">
            {preview ? <><button type="button" className="kb-btn" disabled={busy} onClick={() => setPreview(false)}>Chỉnh sửa thư</button>
                <button type="button" className="kb-btn interview" disabled={busy} onClick={send}>{busy ? 'Đang gửi…' : 'Xác nhận gửi thư mời phỏng vấn'}</button></>
                : <button type="button" className="kb-btn interview" disabled={busy} onClick={review}>Xem trước thư mời phỏng vấn</button>}
            <button type="button" className="kb-btn" disabled={busy} onClick={onCancel}>Đóng phần soạn thư</button>
        </div>
    </section>;
}
