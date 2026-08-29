import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createPool: vi.fn(),
    mysqlPool: { query: vi.fn(), getConnection: vi.fn() },
    createTransport: vi.fn(),
    transporter: { sendMail: vi.fn() },
    axiosPost: vi.fn()
}));

vi.mock('mysql2/promise', () => ({ default: { createPool: mocks.createPool } }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));
vi.mock('axios', () => ({ default: { post: mocks.axiosPost } }));

beforeEach(() => {
    mocks.createPool.mockReturnValue(mocks.mysqlPool);
    mocks.mysqlPool.query.mockReset();
    mocks.mysqlPool.getConnection.mockReset();
    mocks.createTransport.mockReturnValue(mocks.transporter);
    mocks.transporter.sendMail.mockReset();
    mocks.axiosPost.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe('notification delivery channels', () => {
    it('persists bounded notifications and returns the created shape', async () => {
        mocks.mysqlPool.query.mockResolvedValue([{ insertId: 17 }]);
        const { saveNotification } = await import('../notification-service/src/libs/channels.js');
        const saved = await saveNotification({ userId: 2, typeCode: 'NEW', content: 'x'.repeat(600), link: '' });
        expect(mocks.mysqlPool.query.mock.calls[0][1][2]).toHaveLength(500);
        expect(mocks.mysqlPool.query.mock.calls[0][1][3]).toBeNull();
        expect(saved).toMatchObject({ id: 17, userId: 2, typeCode: 'NEW', isChecked: 0 });
        expect(saved.createdAt).toBeInstanceOf(Date);
    });

    it('looks up user emails/names and company follower ids', async () => {
        const { getUserEmail, getCompanyFollowers } = await import('../notification-service/src/libs/channels.js');
        mocks.mysqlPool.query.mockResolvedValueOnce([[]]);
        await expect(getUserEmail(1)).resolves.toBeNull();
        mocks.mysqlPool.query.mockResolvedValueOnce([[{ email: 'a@b.com', firstName: 'Lan', lastName: null }]]);
        await expect(getUserEmail(2)).resolves.toEqual({ email: 'a@b.com', name: 'Lan' });
        mocks.mysqlPool.query.mockResolvedValueOnce([[{ userId: 2 }, { userId: 3 }]]);
        await expect(getCompanyFollowers(9)).resolves.toEqual([2, 3]);
    });

    it('skips email when unconfigured or recipient is absent', async () => {
        vi.stubEnv('EMAIL_APP', 'youremail@gmail.com');
        const { sendEmail, isEmailConfigured } = await import('../notification-service/src/libs/channels.js');
        expect(isEmailConfigured()).toBe(false);
        await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })).resolves.toEqual({ skipped: true });
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        expect(isEmailConfigured()).toBe(true);
        await expect(sendEmail({ to: '', subject: 's', html: 'h' })).resolves.toEqual({ skipped: true });
        expect(mocks.transporter.sendMail).not.toHaveBeenCalled();
    });

    it('reuses an SMTP transporter and reports success/failure without throwing', async () => {
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_APP_PASSWORD', 'pass');
        const { sendEmail } = await import('../notification-service/src/libs/channels.js');
        mocks.transporter.sendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('smtp'));
        await expect(sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' })).resolves.toEqual({ sent: true });
        expect(mocks.createTransport).toHaveBeenCalledWith({ service: 'gmail', auth: { user: 'sender@gmail.com', pass: 'pass' } });
        await expect(sendEmail({ to: 'c@d.com', subject: 'S2', html: 'H2' })).resolves.toEqual({ error: 'smtp' });
        expect(mocks.createTransport).toHaveBeenCalledOnce();
    });

    it('skips realtime without a secret and posts with trusted headers when configured', async () => {
        const { pushRealtime } = await import('../notification-service/src/libs/channels.js');
        await expect(pushRealtime({ userId: 1, notification: { id: 2 } })).resolves.toEqual({ skipped: true });
        vi.stubEnv('INTERNAL_SECRET', 'secret');
        vi.stubEnv('LEGACY_URL', 'http://legacy');
        mocks.axiosPost.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('down'));
        await expect(pushRealtime({ userId: 1, notification: { id: 2 } })).resolves.toEqual({ sent: true });
        expect(mocks.axiosPost).toHaveBeenCalledWith(
            'http://legacy/internal/emit-notification', { userId: 1, notification: { id: 2 } },
            { headers: { 'x-internal-secret': 'secret' }, timeout: 5000 }
        );
        await expect(pushRealtime({ userId: 1, notification: {} })).resolves.toEqual({ error: 'down' });
    });

    it('pings MySQL and always releases the connection', async () => {
        const conn = { ping: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
        mocks.mysqlPool.getConnection.mockResolvedValue(conn);
        const { testMysql } = await import('../notification-service/src/libs/channels.js');
        await testMysql();
        expect(conn.ping).toHaveBeenCalledOnce();
        expect(conn.release).toHaveBeenCalledOnce();
    });
});

describe('notification templates', () => {
    it('returns null for stages that should not notify', async () => {
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        expect(applicationStageTemplate({ toStage: 'moi_ung_tuyen' })).toBeNull();
        expect(applicationStageTemplate({ toStage: 'unknown' })).toBeNull();
    });

    it.each([
        ['dang_xem_xet', 'đang được xem xét'],
        ['phong_van', 'phỏng vấn'],
        ['de_nghi', 'đề nghị nhận việc'],
        ['nhan_viec', 'nhận việc'],
        ['tu_choi', 'chưa phù hợp']
    ])('renders stage %s with in-app and email content', async (stage, expected) => {
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationStageTemplate({ toStage: stage, jobTitle: 'Node Dev', candidateName: 'Lan', companyName: 'ACME' });
        expect(template.typeCode).toBe('APPLICATION_STAGE');
        expect(template.content.toLowerCase()).toContain(expected);
        expect(template.email.html).toContain('Job Finder');
        expect(template.email.html).toContain('Node Dev');
    });

    it('uses safe defaults for missing stage context', async () => {
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationStageTemplate({ toStage: 'dang_xem_xet' });
        expect(template.content).toContain('vị trí đã ứng tuyển');
        expect(template.email.subject).toContain('đã ứng tuyển');
    });

    it.each([
        ['accepted', 'APPLICATION_ACCEPTED', 'trúng tuyển'],
        ['rejected', 'APPLICATION_REJECTED', 'Kết quả ứng tuyển']
    ])('renders %s decisions and escapes all user-controlled HTML', async (decision, typeCode, text) => {
        const { applicationDecisionTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationDecisionTemplate({
            decision, jobTitle: '<Dev & Ops>', candidateName: '"Lan"', message: '<script>x</script>\nNext'
        });
        expect(template.typeCode).toBe(typeCode);
        expect(template.content).toContain(text);
        expect(template.email.html).toContain('&lt;Dev &amp; Ops&gt;');
        expect(template.email.html).toContain('&quot;Lan&quot;');
        expect(template.email.html).toContain('&lt;script&gt;x&lt;/script&gt;<br>Next');
        expect(template.email.html).not.toContain('<script>');
    });

    it('renders decision defaults and omits an empty custom-message section', async () => {
        const { applicationDecisionTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationDecisionTemplate({ decision: 'rejected' });
        expect(template.content).toContain('đã ứng tuyển');
        expect(template.email.html).not.toContain('Lời nhắn từ nhà tuyển dụng');
    });

    it.each([true, false])('renders moderation result for approved=%s', async (approved) => {
        const { jobModeratedTemplate } = await import('../notification-service/src/templates.js');
        const template = jobModeratedTemplate({ approved, jobTitle: 'Dev', reason: approved ? null : 'spam' });
        expect(template.typeCode).toBe(approved ? 'POST_APPROVED' : 'POST_REJECTED');
        expect(template.email.html).toContain('Dev');
        if (!approved) expect(template.content).toContain('spam');
    });

    it('renders new-application and followed-company defaults', async () => {
        const { newApplicationTemplate, newJobFromFollowedCompanyTemplate } = await import('../notification-service/src/templates.js');
        const application = newApplicationTemplate({});
        expect(application.typeCode).toBe('NEW_CV');
        expect(application.content).toContain('Một ứng viên');
        const job = newJobFromFollowedCompanyTemplate({ jobTitle: 'Dev', jobId: 4 });
        expect(job.typeCode).toBe('NEW_POST');
        expect(job.link).toBe('/detail-job/4');
        expect(job.content).toContain('Công ty bạn theo dõi');
    });
});
