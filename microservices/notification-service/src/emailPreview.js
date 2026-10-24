import { assertEventPayload } from '../../shared/eventContract.js';
import { APPLICATION_EMAIL_EVENTS, applicationEventTemplate } from './templates.js';
import { planEmail } from './libs/channels.js';

// Ban xem truoc thong bao/email cua mot su kien ho so ung tuyen, cho che do dryRun cua
// Application Service. Cung mau, cung quy tac nguoi nhan voi luong gui that; khong luu
// thong bao, khong tao hang doi, khong gui gi.
export class PreviewError extends Error {}

export const previewApplicationEmail = (eventType, payload) => {
    if (!APPLICATION_EMAIL_EVENTS.includes(eventType)) throw new PreviewError('Sự kiện không hỗ trợ xem trước');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PreviewError('Thiếu dữ liệu sự kiện');
    try {
        assertEventPayload(eventType, payload, { aggregateId: String(payload.applicationId) });
    } catch {
        throw new PreviewError('Dữ liệu sự kiện không đúng hợp đồng');
    }
    const template = applicationEventTemplate(eventType, payload);
    // Vi du: chuyen ve "moi ung tuyen" khong bao cho ung vien.
    if (!template) return { inApp: null, email: null };
    const inApp = { typeCode: template.typeCode, content: template.content, link: template.link };
    if (!template.email) return { inApp, email: null };
    const plan = planEmail({ to: payload.candidateEmail, subject: template.email.subject, replyTo: template.email.replyTo });
    return {
        inApp,
        email: {
            willSend: !plan.skipped,
            ...plan,
            text: template.email.text,
            html: template.email.html
        }
    };
};
