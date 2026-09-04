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
    vi.resetModules();
    mocks.createPool.mockReturnValue(mocks.mysqlPool);
    mocks.mysqlPool.query.mockReset();
    mocks.mysqlPool.getConnection.mockReset();
    mocks.createTransport.mockReturnValue(mocks.transporter);
    mocks.transporter.sendMail.mockReset();
    mocks.axiosPost.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

const expectRichEmail = (email, { ctaUrl, progressCurrent } = {}) => {
    expect(email).toEqual(expect.objectContaining({
        subject: expect.any(String),
        html: expect.any(String),
        text: expect.any(String)
    }));
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html.trimStart()).toMatch(/^<!doctype html>/i);
    expect(email.html).toMatch(/<meta[^>]+name=["']viewport["']/i);
    expect(email.html).toMatch(/<(?:div|span)[^>]+(?:data-preheader|class=["'][^"']*preheader|display\s*:\s*none)/i);
    expect(email.html).toMatch(/<table[^>]+role=["']presentation["']/i);
    expect(email.text.trim()).not.toBe('');

    if (ctaUrl) {
        expect(email.html).toContain(`href="${ctaUrl}"`);
        expect(email.text).toContain(ctaUrl);
    }

    if (progressCurrent) {
        expect(email.html).toMatch(new RegExp(
            `data-progress-current=["']${progressCurrent}["']|aria-label=["'][^"']*(?:bước\\s*${progressCurrent}|${progressCurrent}\\s*(?:/|trên)\\s*5)`,
            'i'
        ));
        for (const label of ['Đã nộp', 'Xem xét', 'Phỏng vấn', 'Đề nghị', 'Kết quả']) {
            expect(email.html).toContain(label);
        }
    }
};

describe('notification delivery channels', () => {
    it('uses the supplied transaction connection for notification writes and email lookup', async () => {
        const db = { query: vi.fn().mockResolvedValueOnce([{ insertId: 8 }]).mockResolvedValueOnce([[{ email: 'user@x.com' }]]) };
        const { saveNotification, getUserEmail } = await import('../notification-service/src/libs/channels.js');
        expect((await saveNotification({ userId: 2, typeCode: 'X', content: 'C' }, db)).id).toBe(8);
        expect((await getUserEmail(2, db)).email).toBe('user@x.com');
        expect(mocks.mysqlPool.query).not.toHaveBeenCalled();
    });

    it('preserves the stable SMTP message ID and error details for safe delivery decisions', async () => {
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        const { sendEmail } = await import('../notification-service/src/libs/channels.js');
        mocks.transporter.sendMail.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', command: 'CONN' }));
        expect(await sendEmail({ to: 'user@realmail.com', subject: 'S', html: 'H', messageId: '<stable@jobfind.local>' }))
            .toEqual({ error: 'timeout', code: 'ETIMEDOUT', command: 'CONN' });
        expect(mocks.transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({ messageId: '<stable@jobfind.local>' }));
    });

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

    it('normalizes, validates, and recognizes explicit placeholder recipients', async () => {
        const {
            normalizeEmailRecipient, isValidEmailRecipient, isPlaceholderEmailRecipient
        } = await import('../notification-service/src/libs/channels.js');

        expect(normalizeEmailRecipient('  Candidate@RealMail.COM ')).toBe('candidate@realmail.com');
        expect(isValidEmailRecipient('candidate@realmail.com')).toBe(true);
        expect(isValidEmailRecipient('not-an-email')).toBe(false);

        for (const placeholder of [
            'example@gmail.com',
            'candidate@example.com',
            'candidate@mail.example.net',
            'candidate@example.org',
            'candidate@demo.example',
            'candidate@demo.invalid',
            'candidate@demo.test',
            'candidate@demo.local'
        ]) {
            expect(isPlaceholderEmailRecipient(placeholder), placeholder).toBe(true);
        }
        expect(isPlaceholderEmailRecipient('candidate@realmail.com')).toBe(false);
    });

    it('skips email with a reason when configuration or recipient is invalid', async () => {
        vi.stubEnv('EMAIL_APP', 'youremail@gmail.com');
        const { sendEmail, isEmailConfigured, EMAIL_SKIP_REASONS } = await import('../notification-service/src/libs/channels.js');
        expect(isEmailConfigured()).toBe(false);
        await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })).resolves.toEqual({
            skipped: true, reason: EMAIL_SKIP_REASONS.NOT_CONFIGURED
        });
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        expect(isEmailConfigured()).toBe(true);
        vi.stubEnv('EMAIL_DEMO_RECIPIENT', 'demo@realmail.com');
        await expect(sendEmail({ to: 'not-an-email', subject: 's', html: 'h' })).resolves.toEqual({
            skipped: true, reason: EMAIL_SKIP_REASONS.INVALID_RECIPIENT
        });
        expect(mocks.transporter.sendMail).not.toHaveBeenCalled();
    });

    it('normalizes a real recipient without redirecting or changing its subject', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_APP_PASSWORD', 'pass');
        const { sendEmail } = await import('../notification-service/src/libs/channels.js');
        mocks.transporter.sendMail.mockResolvedValueOnce({
            messageId: 'message-1',
            accepted: ['candidate@realmail.com'],
            rejected: []
        }).mockRejectedValueOnce(new Error('smtp'));
        await expect(sendEmail({
            to: ' Candidate@RealMail.COM ', subject: 'S', html: '<p>H</p>', text: 'H'
        })).resolves.toEqual({
            sent: true,
            messageId: 'message-1',
            accepted: ['candidate@realmail.com'],
            rejected: []
        });
        expect(mocks.createTransport).toHaveBeenCalledWith({
            service: 'gmail', auth: { user: 'sender@gmail.com', pass: 'pass' },
            connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
        });
        expect(mocks.transporter.sendMail).toHaveBeenNthCalledWith(1, {
            from: 'sender@gmail.com',
            to: 'candidate@realmail.com',
            subject: 'S',
            html: '<p>H</p>',
            text: 'H'
        });
        await expect(sendEmail({ to: 'c@d.com', subject: 'S2', html: 'H2' })).resolves.toEqual({ error: 'smtp' });
        expect(mocks.createTransport).toHaveBeenCalledOnce();
    });

    it('redirects a placeholder to EMAIL_DEMO_RECIPIENT in non-production and marks the subject', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_APP_PASSWORD', 'pass');
        vi.stubEnv('EMAIL_DEMO_RECIPIENT', ' DemoInbox@RealMail.COM ');
        const { sendEmail } = await import('../notification-service/src/libs/channels.js');
        mocks.transporter.sendMail.mockResolvedValueOnce({});

        await expect(sendEmail({
            to: ' EXAMPLE@GMAIL.COM ', subject: 'Mời phỏng vấn', html: '<p>H</p>', text: 'H'
        })).resolves.toMatchObject({ sent: true });
        expect(mocks.transporter.sendMail).toHaveBeenCalledWith({
            from: 'sender@gmail.com',
            to: 'demoinbox@realmail.com',
            subject: '[DEMO] Mời phỏng vấn',
            html: '<p>H</p>',
            text: 'H'
        });
    });

    it('falls back to a valid EMAIL_APP when the demo recipient is missing or invalid', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_DEMO_RECIPIENT', 'broken-address');
        const { sendEmail } = await import('../notification-service/src/libs/channels.js');
        mocks.transporter.sendMail.mockResolvedValueOnce({});

        await expect(sendEmail({
            to: 'candidate@example.org', subject: 'Kết quả', html: 'H'
        })).resolves.toMatchObject({ sent: true });
        expect(mocks.transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'sender@gmail.com', subject: '[DEMO] Kết quả'
        }));
    });

    it('skips placeholders in production with a reason', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('EMAIL_APP', 'sender@gmail.com');
        vi.stubEnv('EMAIL_DEMO_RECIPIENT', 'demo@realmail.com');
        const { sendEmail, EMAIL_SKIP_REASONS } = await import('../notification-service/src/libs/channels.js');

        await expect(sendEmail({
            to: 'candidate@demo.test', subject: 'S', html: 'H'
        })).resolves.toEqual({
            skipped: true, reason: EMAIL_SKIP_REASONS.PLACEHOLDER_IN_PRODUCTION
        });
        expect(mocks.transporter.sendMail).not.toHaveBeenCalled();
    });

    it('skips a development placeholder when no safe redirect target exists', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('EMAIL_APP', 'youremail@gmail.com');
        vi.stubEnv('EMAIL_DEMO_RECIPIENT', 'demo@example.com');
        const { sendEmail, EMAIL_SKIP_REASONS } = await import('../notification-service/src/libs/channels.js');

        await expect(sendEmail({
            to: 'example@gmail.com', subject: 'S', html: 'H'
        })).resolves.toEqual({
            skipped: true, reason: EMAIL_SKIP_REASONS.NO_SAFE_DEMO_RECIPIENT
        });
        expect(mocks.transporter.sendMail).not.toHaveBeenCalled();
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
        ['dang_xem_xet', 'đang được xem xét', 2],
        ['phong_van', 'phỏng vấn', 3],
        ['de_nghi', 'đề nghị nhận việc', 4],
        ['nhan_viec', 'nhận việc', 5],
        ['tu_choi', 'chưa phù hợp', 5]
    ])('renders stage %s as a complete, trackable email', async (stage, expected, progressCurrent) => {
        vi.stubEnv('FRONTEND_URL', 'https://jobs.example.test');
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationStageTemplate({ toStage: stage, jobTitle: 'Node Dev', candidateName: 'Lan', companyName: 'ACME' });
        expect(template.typeCode).toBe('APPLICATION_STAGE');
        expect(template.content.toLowerCase()).toContain(expected);
        expect(template.link).toBe('/candidate/cv-post/');
        expectRichEmail(template.email, {
            ctaUrl: 'https://jobs.example.test/candidate/cv-post/',
            progressCurrent
        });
        expect(template.email.html).toContain('Job Finder');
        expect(template.email.html).toContain('Node Dev');
        expect(template.email.text).toContain('Node Dev');
    });

    it('escapes every stage field and strips subject header injection characters', async () => {
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationStageTemplate({
            toStage: 'phong_van',
            jobTitle: '<Dev & Ops>\r\nBcc: victim@example.com',
            candidateName: '<img src=x onerror=alert(1)>',
            companyName: 'ACME & <script>alert(1)</script>'
        });

        expectRichEmail(template.email, {
            ctaUrl: 'http://localhost:3000/candidate/cv-post/',
            progressCurrent: 3
        });
        expect(template.email.html).toContain('&lt;Dev &amp; Ops&gt;');
        expect(template.email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(template.email.html).toContain('ACME &amp; &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(template.email.html).not.toMatch(/<(?:script|img)\b/i);
    });

    it('uses safe defaults for missing stage context', async () => {
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationStageTemplate({ toStage: 'dang_xem_xet' });
        expect(template.content).toContain('vị trí đã ứng tuyển');
        expect(template.email.subject).toContain('đã ứng tuyển');
        expectRichEmail(template.email, {
            ctaUrl: 'http://localhost:3000/candidate/cv-post/',
            progressCurrent: 2
        });
    });

    it.each([
        ['accepted', 'APPLICATION_ACCEPTED', 'trúng tuyển'],
        ['rejected', 'APPLICATION_REJECTED', 'Kết quả ứng tuyển']
    ])('renders %s decisions and escapes all user-controlled HTML', async (decision, typeCode, expected) => {
        vi.stubEnv('FRONTEND_URL', 'https://jobs.example.test');
        const { applicationDecisionTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationDecisionTemplate({
            decision,
            jobTitle: '<Dev & Ops>\r\nBcc: victim@example.com',
            candidateName: '"Lan" <img src=x>',
            message: '<script>x</script>\nNext'
        });
        expect(template.typeCode).toBe(typeCode);
        expect(template.content).toContain(expected);
        expect(template.link).toBe('/candidate/cv-post/');
        expectRichEmail(template.email, {
            ctaUrl: 'https://jobs.example.test/candidate/cv-post/',
            progressCurrent: 5
        });
        expect(template.email.html).toContain('&lt;Dev &amp; Ops&gt;');
        expect(template.email.html).toContain('&quot;Lan&quot;');
        expect(template.email.html).toMatch(/&lt;script&gt;x&lt;\/script&gt;<br\s*\/?>(?:\s*)Next/);
        expect(template.email.html).not.toMatch(/<(?:script|img)\b/i);
    });

    it('renders decision defaults and omits an empty custom-message section', async () => {
        const { applicationDecisionTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationDecisionTemplate({ decision: 'rejected' });
        expect(template.content).toContain('đã ứng tuyển');
        expect(template.email.html).not.toContain('Lời nhắn từ nhà tuyển dụng');
        expectRichEmail(template.email, {
            ctaUrl: 'http://localhost:3000/candidate/cv-post/',
            progressCurrent: 5
        });
    });

    it.each([true, false])('renders moderation result for approved=%s', async (approved) => {
        vi.stubEnv('FRONTEND_URL', 'https://jobs.example.test');
        const { jobModeratedTemplate } = await import('../notification-service/src/templates.js');
        const template = jobModeratedTemplate({
            approved,
            jobTitle: '<Dev>\r\nBcc: victim@example.com',
            reason: approved ? null : '<script>spam</script>'
        });
        expect(template.typeCode).toBe(approved ? 'POST_APPROVED' : 'POST_REJECTED');
        expectRichEmail(template.email, { ctaUrl: 'https://jobs.example.test/admin/list-post/' });
        expect(template.email.html).toContain('&lt;Dev&gt;');
        expect(template.email.html).not.toContain('<script>');
        if (!approved) {
            expect(template.content).toContain('spam');
            expect(template.email.html).toContain('&lt;script&gt;spam&lt;/script&gt;');
        }
    });

    it('renders and escapes the new-application email with an absolute pipeline CTA', async () => {
        vi.stubEnv('FRONTEND_URL', 'https://jobs.example.test');
        const { newApplicationTemplate } = await import('../notification-service/src/templates.js');
        const application = newApplicationTemplate({
            candidateName: '<Candidate & Co>',
            jobTitle: '<Dev>\r\nBcc: victim@example.com'
        });
        expect(application.typeCode).toBe('NEW_CV');
        expectRichEmail(application.email, { ctaUrl: 'https://jobs.example.test/admin/pipeline/' });
        expect(application.email.html).toContain('&lt;Candidate &amp; Co&gt;');
        expect(application.email.html).toContain('&lt;Dev&gt;');
        expect(application.email.html).not.toMatch(/<(?:script|img)\b/i);
    });

    it('renders and escapes a followed-company job email with an absolute job CTA', async () => {
        vi.stubEnv('FRONTEND_URL', 'https://jobs.example.test');
        const { newJobFromFollowedCompanyTemplate } = await import('../notification-service/src/templates.js');
        const job = newJobFromFollowedCompanyTemplate({
            jobTitle: '<Dev & Ops>\r\nBcc: victim@example.com',
            companyName: '<ACME>',
            jobId: 4
        });
        expect(job.typeCode).toBe('NEW_POST');
        expect(job.link).toBe('/detail-job/4');
        expectRichEmail(job.email, { ctaUrl: 'https://jobs.example.test/detail-job/4' });
        expect(job.email.html).toContain('&lt;Dev &amp; Ops&gt;');
        expect(job.email.html).toContain('&lt;ACME&gt;');
    });

    it('keeps safe defaults for recruiter and followed-company notifications', async () => {
        const { newApplicationTemplate, newJobFromFollowedCompanyTemplate } = await import('../notification-service/src/templates.js');
        const application = newApplicationTemplate({});
        expect(application.content).toContain('Một ứng viên');
        expectRichEmail(application.email, { ctaUrl: 'http://localhost:3000/admin/pipeline/' });

        const job = newJobFromFollowedCompanyTemplate({ jobTitle: 'Dev', jobId: 4 });
        expect(job.content).toContain('Công ty bạn theo dõi');
        expectRichEmail(job.email, { ctaUrl: 'http://localhost:3000/detail-job/4' });
    });

    it('falls back to the local frontend URL when FRONTEND_URL is unsafe', async () => {
        vi.stubEnv('FRONTEND_URL', 'javascript:alert(1)');
        const { applicationStageTemplate } = await import('../notification-service/src/templates.js');
        const template = applicationStageTemplate({ toStage: 'phong_van', jobTitle: 'Dev' });
        expect(template.email.html).not.toContain('href="javascript:');
        expectRichEmail(template.email, {
            ctaUrl: 'http://localhost:3000/candidate/cv-post/',
            progressCurrent: 3
        });
    });
});
