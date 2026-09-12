import React, { useState } from 'react';

const fields = [
    ['companyName', 'Tên công ty', 'text', 255, true],
    ['startDate', 'Ngày nhận việc', 'date', 10, true],
    ['startTime', 'Giờ nhận việc', 'time', 5, true],
    ['location', 'Địa điểm nhận việc cụ thể', 'text', 1000],
    ['meetingUrl', 'Đường dẫn nhận việc trực tuyến', 'url', 2000],
    ['responseDeadline', 'Hạn phản hồi', 'datetime-local', 16, true],
    ['contactName', 'Người liên hệ HR', 'text', 150, true],
    ['contactEmail', 'Email HR nhận phản hồi', 'email', 254, true],
    ['contactPhone', 'Số điện thoại HR', 'tel', 50],
    ['workSchedule', 'Lịch làm việc', 'textarea', 500],
    ['salary', 'Lương / thu nhập (ghi rõ gross hoặc net)', 'textarea', 1000],
    ['probation', 'Thời gian và lương thử việc', 'textarea', 1000],
    ['benefits', 'Phúc lợi', 'textarea', 3000],
    ['requiredDocuments', 'Giấy tờ cần chuẩn bị', 'textarea', 3000],
    ['onboardingInstructions', 'Hướng dẫn ngày đầu nhận việc', 'textarea', 3000],
];
const modes = { onsite: 'Tại văn phòng', remote: 'Trực tuyến / từ xa', hybrid: 'Kết hợp văn phòng và từ xa' };
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const validTime = (time) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time);
export const validateOfferForm = (offer, now = Date.now()) => {
    for (const [key, label, , max, required] of fields) {
        const value = offer[key] || '';
        if ((required && !value.trim()) || value.length > max) return `Vui lòng kiểm tra ${label.toLowerCase()}`;
    }
    if (!validDate(offer.startDate) || !validTime(offer.startTime)) return 'Ngày hoặc giờ nhận việc không hợp lệ';
    const [date, time] = (offer.responseDeadline || '').split('T');
    if (!validDate(date) || !validTime(time)) return 'Hạn phản hồi không hợp lệ';
    const start = Date.parse(`${offer.startDate}T${offer.startTime}:00+07:00`);
    const deadline = Date.parse(`${offer.responseDeadline}:00+07:00`);
    if (start <= now) return 'Thời gian nhận việc phải ở tương lai';
    if (deadline <= now || deadline > start) return 'Hạn phản hồi phải ở tương lai và không sau thời gian nhận việc';
    if (offer.workMode !== 'remote' && !offer.location?.trim()) return 'Vui lòng nhập địa điểm nhận việc cụ thể';
    if (offer.workMode === 'remote' && !offer.meetingUrl?.trim()) return 'Vui lòng nhập đường dẫn nhận việc trực tuyến';
    if (offer.meetingUrl) {
        try {
            const url = new URL(offer.meetingUrl);
            if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(offer.meetingUrl)) throw new Error();
        } catch { return 'Đường dẫn trực tuyến phải là URL http hoặc https hợp lệ'; }
    }
    const [localPart, domain = ''] = offer.contactEmail.split('@');
    if (localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..') || domain.split('.').some((label) => label.length > 63)
        || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(offer.contactEmail)) return 'Email người liên hệ không hợp lệ';
    return '';
};

const formatted = (key, value) => {
    if (key === 'startDate') return value.split('-').reverse().join('/');
    if (key === 'responseDeadline') {
        const [date, time] = value.split('T');
        return `${date.split('-').reverse().join('/')} lúc ${time}`;
    }
    return value;
};

export function OfferSummary({ offer }) {
    return <dl className="kb-offer-summary">
        <dt>Hình thức làm việc</dt><dd>{modes[offer.workMode]}</dd>
        {fields.filter(([key]) => offer[key]).map(([key, label]) => <React.Fragment key={key}>
            <dt>{label}</dt><dd>{formatted(key, offer[key])}</dd>
        </React.Fragment>)}
        <dt>Múi giờ</dt><dd>Giờ Việt Nam (UTC+7)</dd>
    </dl>;
}

export default function OfferLetterForm({ detail, user, message, busy, onSend, onCancel }) {
    const [offer, setOffer] = useState(() => {
        const previous = (detail.timeline || []).find((event) => event.decision_snapshot?.decision === 'accepted')?.decision_snapshot?.offer
            || (detail.latestDecision?.decision === 'accepted' && detail.latestDecision.offer);
        return { ...Object.fromEntries(fields.map(([key]) => [key, ''])), timeZone: 'Asia/Ho_Chi_Minh', workMode: 'onsite',
            companyName: detail.company_name || user.companyName || '',
            contactName: [user.firstName, user.lastName].filter(Boolean).join(' '), contactEmail: user.email || '', ...previous };
    });
    const [preview, setPreview] = useState(false);
    const [error, setError] = useState('');
    const cleaned = () => Object.fromEntries(Object.entries(offer).map(([key, value]) => [key, String(value).trim()]));
    const review = () => {
        const data = cleaned();
        const problem = validateOfferForm(data);
        setError(problem);
        if (!problem) { setOffer(data); setPreview(true); }
    };
    const send = () => {
        const data = cleaned();
        const problem = validateOfferForm(data);
        setError(problem);
        if (!problem) onSend(data);
    };
    return <section className="kb-offer" aria-label="Soạn thư mời nhận việc">
        <h5>{preview ? 'Xem trước nội dung thư mời' : 'Thông tin thư mời nhận việc'}</h5>
        <p className="kb-hint">Các mục có * là bắt buộc. Ngày giờ theo giờ Việt Nam (UTC+7). Sau khi gửi, hồ sơ ở bước đề nghị; HR cập nhật “Đã nhận việc” khi đã xác nhận với ứng viên.</p>
        {error && <p role="alert" className="kb-offer-error">{error}</p>}
        {preview ? <div className="kb-offer-preview">
            <p><b>Đến:</b> {detail.candidate_name} · {detail.candidate_email}</p>
            <p><b>Tiêu đề:</b> Thư mời nhận việc — {detail.job_title}</p>
            <p>Chào {detail.candidate_name || 'bạn'}, {offer.companyName} trân trọng mời bạn nhận việc ở vị trí <b>{detail.job_title}</b>.</p>
            <OfferSummary offer={offer} />
            {message && <p className="kb-cover">{message}</p>}
            <p>Vui lòng trả lời email này đến <b>{offer.contactEmail}</b>, ghi rõ đồng ý hoặc từ chối trước hạn phản hồi và xác nhận thời gian bắt đầu.</p>
            <p>Trân trọng,<br />{offer.contactName}<br />{offer.companyName}</p>
            <p className="kb-hint">Email sẽ có nút xem hồ sơ ứng tuyển và thông tin phản hồi trực tiếp đến HR.</p>
        </div> : <fieldset disabled={busy} className="kb-offer-fields">
            <label>Hình thức làm việc *<select value={offer.workMode} onChange={(event) => { setError(''); setOffer({ ...offer, workMode: event.target.value }); }}>
                {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {fields.map(([key, label, type, maxLength, required]) => {
                const needed = required || (key === 'location' && offer.workMode !== 'remote') || (key === 'meetingUrl' && offer.workMode === 'remote');
                const props = { value: offer[key], maxLength, required: needed, onChange: (event) => { setError(''); setOffer({ ...offer, [key]: event.target.value }); } };
                return <label key={key} className={type === 'textarea' ? 'kb-offer-wide' : ''}>{label}{needed ? ' *' : ''}
                    {type === 'textarea' ? <textarea {...props} rows={2} /> : <input {...props} type={type} />}
                </label>;
            })}
        </fieldset>}
        <div className="kb-decision-actions">
            {preview ? <><button type="button" className="kb-btn" disabled={busy} onClick={() => setPreview(false)}>Chỉnh sửa thư</button>
                <button type="button" className="kb-btn success" disabled={busy} onClick={send}>{busy ? 'Đang gửi…' : 'Xác nhận gửi thư mời'}</button></>
                : <button type="button" className="kb-btn success" disabled={busy} onClick={review}>Xem trước thư mời</button>}
            <button type="button" className="kb-btn" disabled={busy} onClick={onCancel}>Đóng phần soạn thư</button>
        </div>
    </section>;
}
