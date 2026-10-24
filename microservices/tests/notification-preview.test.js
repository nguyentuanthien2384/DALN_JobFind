import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offerFixture } from './offerFixture.js';
import { interviewFixture } from './interviewFixture.js';

const mocks = vi.hoisted(() => ({
    createPool: vi.fn(),
    mysqlPool: { query: vi.fn(), getConnection: vi.fn() },
    createTransport: vi.fn(),
    transporter: { sendMail: vi.fn() }
}));

vi.mock('mysql2/promise', () => ({ default: { createPool: mocks.createPool } }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));

beforeEach(() => {
    vi.resetModules();
    mocks.createPool.mockReturnValue(mocks.mysqlPool);
    mocks.createTransport.mockReturnValue(mocks.transporter);
    mocks.transporter.sendMail.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

const applicant = { applicationId: 31, candidateId: 7, candidateEmail: 'lan@realmail.com', candidateName: 'Lan', jobId: 4, jobTitle: 'Frontend Developer' };
const interviewEvent = { ...applicant, companyId: 3, companyName: interviewFixture.companyName, message: 'Hẹn gặp bạn', interview: interviewFixture,
    fromStage: 'dang_xem_xet', toStage: 'phong_van' };
const load = () => import('../notification-service/src/emailPreview.js');

describe('application email preview', () => {
    it('renders the same template and recipient decision as the real delivery, without sending', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_APP_PASSWORD', 'pass');
        const { previewApplicationEmail } = await load();
        const { applicationInterviewTemplate } = await import('../notification-service/src/templates.js');
        const real = applicationInterviewTemplate(interviewEvent);
        const preview = previewApplicationEmail('application.interview_invitation_requested', interviewEvent);
        expect(preview.inApp).toEqual({ typeCode: real.typeCode, content: real.content, link: real.link });
        expect(preview.email).toEqual({ willSend: true, to: 'lan@realmail.com', demo: false, subject: real.email.subject,
            replyTo: 'hr@example.com', text: real.email.text, html: real.email.html });
        expect(mocks.transporter.sendMail).not.toHaveBeenCalled();
        expect(mocks.mysqlPool.query).not.toHaveBeenCalled();
    });

    it('shows a dev redirect of placeholder addresses and a missing sender configuration', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_DEMO_RECIPIENT', 'demo@realmail.com');
        const { previewApplicationEmail } = await load();
        const redirected = previewApplicationEmail('application.interview_invitation_requested', { ...interviewEvent, candidateEmail: 'candidate.001@example.test' });
        expect(redirected.email).toMatchObject({ willSend: true, to: 'demo@realmail.com', demo: true, originalTo: 'candidate.001@example.test' });
        expect(redirected.email.subject).toMatch(/^\[DEMO\] /);

        vi.stubEnv('EMAIL_APP', '');
        vi.resetModules();
        const reloaded = await load();
        const unconfigured = reloaded.previewApplicationEmail('application.interview_invitation_requested', interviewEvent);
        expect(unconfigured.email).toMatchObject({ willSend: false, skipped: true, reason: 'email_not_configured', to: 'lan@realmail.com' });
    });

    it('explains production skips of placeholder recipients', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        const { previewApplicationEmail } = await load();
        const decision = { ...applicant, candidateEmail: 'example@gmail.com', companyId: 3, companyName: offerFixture.companyName,
            decision: 'accepted', message: null, offer: offerFixture, fromStage: 'phong_van', toStage: 'de_nghi' };
        expect(previewApplicationEmail('application.decision_email_requested', decision).email)
            .toMatchObject({ willSend: false, skipped: true, reason: 'placeholder_recipient_in_production' });
    });

    it('returns nothing for stages that do not notify and rejects unsupported or malformed events', async () => {
        const { previewApplicationEmail, PreviewError } = await load();
        expect(previewApplicationEmail('application.stage_changed', { ...applicant, fromStage: 'dang_xem_xet', toStage: 'moi_ung_tuyen', reason: null }))
            .toEqual({ inApp: null, email: null });
        expect(() => previewApplicationEmail('job.created', {})).toThrow(PreviewError);
        expect(() => previewApplicationEmail('application.interview_invitation_requested', [])).toThrow(PreviewError);
        expect(() => previewApplicationEmail('application.interview_invitation_requested', { ...interviewEvent, toStage: 'tu_choi' }))
            .toThrow('Dữ liệu sự kiện không đúng hợp đồng');
    });
});
