// Design system chung cho email transactional cua Job Finder.
// Khong dung anh ngoai; bo cuc table va CSS inline giup email hien thi on dinh
// tren Gmail, Outlook va ung dung mail di dong.

const CANDIDATE_APPLICATIONS_PATH = '/candidate/cv-post/';
const JOBS_PATH = '/job';
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

const PIPELINE_STEPS = ['Đã nộp', 'Xem xét', 'Phỏng vấn', 'Đề nghị', 'Kết quả'];

const STAGE_MESSAGES = {
    dang_xem_xet: {
        accent: '#2563eb',
        softAccent: '#eff6ff',
        icon: 'i',
        progressStep: 2,
        eyebrow: 'CẬP NHẬT HỒ SƠ',
        status: 'Đang xem xét',
        headline: 'Hồ sơ của bạn đang được xem xét',
        short: (job) => `Hồ sơ của bạn ứng tuyển "${job}" đang được xem xét`,
        subject: (job) => `Hồ sơ ứng tuyển ${job} đang được xem xét`,
        body: ({ name, jobContext }) => [
            `Chào ${name}, hồ sơ ứng tuyển ${jobContext} đã được chuyển sang bước xem xét trên Job Finder. Đây là cập nhật tiến trình, chưa phải kết quả tuyển dụng cuối cùng.`
        ],
        nextStep: 'Bạn chưa cần thực hiện thêm bước nào. Hãy giữ thông tin liên hệ và CV cập nhật, đồng thời theo dõi email và Job Finder.',
        ctaLabel: 'Theo dõi hồ sơ',
        ctaPath: CANDIDATE_APPLICATIONS_PATH
    },
    phong_van: {
        accent: '#7c3aed',
        softAccent: '#f5f3ff',
        icon: '&rarr;',
        progressStep: 3,
        eyebrow: 'BƯỚC TIẾP THEO',
        status: 'Mời phỏng vấn',
        headline: 'Bạn được mời tham gia phỏng vấn',
        short: (job) => `Bạn được mời phỏng vấn vị trí "${job}"`,
        subject: (job) => `Mời phỏng vấn vị trí ${job}`,
        body: ({ name, jobContext }) => [
            `Chào ${name}, nhà tuyển dụng đã chuyển hồ sơ của bạn cho ${jobContext} sang bước phỏng vấn. Thông báo này chưa bao gồm thời gian, hình thức hoặc địa điểm cụ thể.`
        ],
        nextStep: 'Hãy kiểm tra email hoặc tin nhắn từ nhà tuyển dụng. Trước buổi phỏng vấn, hãy xác nhận lại thời gian, hình thức và địa điểm.',
        ctaLabel: 'Xem hồ sơ ứng tuyển',
        ctaPath: CANDIDATE_APPLICATIONS_PATH
    },
    de_nghi: {
        accent: '#92400e',
        softAccent: '#fffbeb',
        icon: '+',
        progressStep: 4,
        eyebrow: 'TIN VUI TỪ NHÀ TUYỂN DỤNG',
        status: 'Đề nghị nhận việc',
        headline: 'Bạn đang ở bước đề nghị nhận việc',
        short: (job) => `Bạn nhận được đề nghị nhận việc cho vị trí "${job}"`,
        subject: (job) => `Đề nghị nhận việc — ${job}`,
        body: ({ name, jobContext }) => [
            `Chào ${name}, nhà tuyển dụng đã chuyển hồ sơ cho ${jobContext} sang bước đề nghị nhận việc. Đây là cập nhật tiến trình; lương, phúc lợi, ngày bắt đầu và thời hạn phản hồi cần được xác nhận trong trao đổi hoặc thư đề nghị chính thức.`
        ],
        nextStep: 'Đọc kỹ các điều khoản và hỏi lại những nội dung chưa rõ trước khi phản hồi.',
        ctaLabel: 'Xem tiến trình hồ sơ',
        ctaPath: CANDIDATE_APPLICATIONS_PATH
    },
    nhan_viec: {
        accent: '#15803d',
        softAccent: '#ecfdf3',
        icon: '&#10003;',
        progressStep: 5,
        eyebrow: 'KẾT QUẢ HỒ SƠ',
        status: 'Đã nhận việc',
        headline: 'Hồ sơ đã được cập nhật sang bước nhận việc',
        short: (job) => `Bạn đã nhận việc vị trí "${job}"`,
        subject: (job) => `Cập nhật nhận việc — ${job}`,
        body: ({ name, jobContext }) => [
            `Chào ${name}, nhà tuyển dụng đã đánh dấu hồ sơ cho ${jobContext} ở trạng thái “Đã nhận việc” trên Job Finder. Các điều khoản và ngày bắt đầu vẫn theo xác nhận trực tiếp giữa bạn và nhà tuyển dụng.`
        ],
        nextStep: 'Hãy xác nhận bằng văn bản ngày bắt đầu, hình thức hoặc địa điểm làm việc và giấy tờ cần chuẩn bị.',
        ctaLabel: 'Xem trạng thái hồ sơ',
        ctaPath: CANDIDATE_APPLICATIONS_PATH
    },
    tu_choi: {
        accent: '#be123c',
        softAccent: '#fff1f2',
        icon: 'i',
        progressStep: 5,
        eyebrow: 'KẾT QUẢ HỒ SƠ',
        status: 'Chưa phù hợp',
        headline: 'Cảm ơn bạn đã dành thời gian ứng tuyển',
        short: (job) => `Hồ sơ ứng tuyển "${job}" chưa phù hợp lần này`,
        subject: (job) => `Kết quả ứng tuyển vị trí ${job}`,
        body: ({ name, jobContext }) => [
            `Chào ${name}, hồ sơ cho ${jobContext} chưa được lựa chọn trong đợt tuyển dụng này. Kết quả này chỉ áp dụng cho vị trí và lần tuyển dụng hiện tại.`
        ],
        nextStep: 'Bạn có thể cập nhật CV và tiếp tục khám phá những vị trí phù hợp hơn trên Job Finder.',
        ctaLabel: 'Khám phá việc làm',
        ctaPath: JOBS_PATH,
        secondaryLink: { label: 'Xem hồ sơ đã nộp', path: CANDIDATE_APPLICATIONS_PATH }
    }
};

export const applicationStageTemplate = ({ toStage, jobTitle, candidateName, companyName }) => {
    const config = STAGE_MESSAGES[toStage];
    // Buoc moi ung tuyen khong can bao lai cho ung vien: chinh ho vua bam nop.
    if (!config) return null;

    const job = displayText(jobTitle, 'vị trí đã ứng tuyển');
    const name = displayText(candidateName, 'bạn');
    const company = displayText(companyName);
    const jobContext = `vị trí “${job}”${company ? ` tại ${company}` : ''}`;
    const subject = sanitizeSubject(config.subject(job));
    const email = renderNotificationEmail({
        subject,
        preheader: config.short(job),
        eyebrow: config.eyebrow,
        status: config.status,
        headline: config.headline,
        icon: config.icon,
        accent: config.accent,
        softAccent: config.softAccent,
        progressStep: config.progressStep,
        body: config.body({ name, jobContext }),
        details: [
            { label: 'Vị trí', value: job },
            ...(company ? [{ label: 'Công ty', value: company }] : [])
        ],
        nextStep: config.nextStep,
        ctaLabel: config.ctaLabel,
        ctaPath: config.ctaPath,
        secondaryLink: config.secondaryLink
    });

    return {
        typeCode: 'APPLICATION_STAGE',
        content: config.short(job),
        link: CANDIDATE_APPLICATIONS_PATH,
        email
    };
};

export const applicationDecisionTemplate = ({
    decision, jobTitle, candidateName, companyName, message
}) => {
    const accepted = decision === 'accepted';
    const job = displayText(jobTitle, 'vị trí bạn đã ứng tuyển');
    const name = displayText(candidateName, 'bạn');
    const company = displayText(companyName);
    const subject = sanitizeSubject(accepted
        ? `Chúc mừng bạn đã trúng tuyển — ${jobTitle || 'Job Finder'}`
        : `Kết quả ứng tuyển — ${jobTitle || 'Job Finder'}`);
    const accent = accepted ? '#15803d' : '#be123c';
    const softAccent = accepted ? '#ecfdf3' : '#fff1f2';
    const status = accepted ? 'Trúng tuyển' : 'Chưa trúng tuyển';
    const headline = accepted
        ? (name === 'bạn' ? 'Chúc mừng, bạn đã trúng tuyển' : `Chúc mừng ${name}, bạn đã trúng tuyển`)
        : 'Cảm ơn bạn đã dành thời gian cho vị trí này';
    const body = accepted
        ? [`Nhà tuyển dụng đã xác nhận bạn được chọn cho vị trí “${job}”${company ? ` tại ${company}` : ''}. Thông báo này ghi nhận kết quả trên Job Finder; lương, ngày bắt đầu và các điều khoản cần được hai bên xác nhận trực tiếp.`]
        : [`Chào ${name}, nhà tuyển dụng chưa lựa chọn hồ sơ của bạn cho vị trí “${job}”${company ? ` tại ${company}` : ''} trong đợt tuyển dụng này. Kết quả này chỉ áp dụng cho vị trí và lần tuyển dụng hiện tại.`];
    const ctaPath = accepted ? CANDIDATE_APPLICATIONS_PATH : JOBS_PATH;
    const email = renderNotificationEmail({
        subject,
        preheader: accepted
            ? `Chúc mừng! Bạn đã trúng tuyển vị trí ${job}`
            : `Kết quả ứng tuyển vị trí ${job}`,
        eyebrow: 'KẾT QUẢ TUYỂN DỤNG',
        status,
        headline,
        icon: accepted ? '&#10003;' : 'i',
        accent,
        softAccent,
        progressStep: 5,
        body,
        details: [
            { label: 'Vị trí', value: job },
            ...(company ? [{ label: 'Công ty', value: company }] : [])
        ],
        nextStep: accepted
            ? 'Đọc lời nhắn từ nhà tuyển dụng nếu có, sau đó xác nhận thời hạn phản hồi, ngày bắt đầu và giấy tờ cần chuẩn bị.'
            : 'Xem lời nhắn từ nhà tuyển dụng nếu có. Bạn có thể cập nhật CV và khám phá thêm cơ hội phù hợp trên Job Finder.',
        ctaLabel: accepted ? 'Xem hồ sơ ứng tuyển' : 'Khám phá việc làm',
        ctaPath,
        secondaryLink: accepted ? null : { label: 'Xem hồ sơ đã nộp', path: CANDIDATE_APPLICATIONS_PATH },
        customMessage: displayMultilineText(message)
    });

    return {
        typeCode: accepted ? 'APPLICATION_ACCEPTED' : 'APPLICATION_REJECTED',
        content: accepted
            ? `Chúc mừng! Bạn đã trúng tuyển vị trí "${job}"`
            : `Kết quả ứng tuyển vị trí "${job}"`,
        link: CANDIDATE_APPLICATIONS_PATH,
        email
    };
};

export const jobModeratedTemplate = ({ approved, jobTitle, reason }) => {
    const job = displayText(jobTitle, 'tin tuyển dụng');
    const rejectionReason = displayMultilineText(reason);
    const subject = sanitizeSubject(approved
        ? `Tin tuyển dụng đã được duyệt — ${job}`
        : `Tin tuyển dụng chưa được duyệt — ${job}`);
    const email = renderNotificationEmail({
        subject,
        preheader: approved ? `Tin ${job} đã hiển thị với ứng viên` : `Tin ${job} cần được chỉnh sửa`,
        eyebrow: 'KIỂM DUYỆT TIN TUYỂN DỤNG',
        status: approved ? 'Đã được duyệt' : 'Cần chỉnh sửa',
        headline: approved ? 'Tin tuyển dụng đã sẵn sàng' : 'Tin tuyển dụng chưa qua kiểm duyệt',
        icon: approved ? '&#10003;' : '!',
        accent: approved ? '#15803d' : '#92400e',
        softAccent: approved ? '#ecfdf3' : '#fffbeb',
        body: [approved
            ? 'Tin tuyển dụng của bạn đã qua kiểm duyệt và đang hiển thị với ứng viên trên Job Finder.'
            : 'Tin tuyển dụng của bạn chưa qua kiểm duyệt. Bạn có thể chỉnh sửa nội dung rồi gửi duyệt lại.'],
        details: [{ label: 'Tin tuyển dụng', value: job }],
        nextStep: approved
            ? 'Kiểm tra trang tin để bảo đảm thông tin hiển thị đúng như mong muốn.'
            : 'Xem lý do kiểm duyệt, cập nhật nội dung và đăng lại khi đã sẵn sàng.',
        ctaLabel: approved ? 'Xem tin tuyển dụng' : 'Chỉnh sửa tin',
        ctaPath: '/admin/list-post/',
        customMessage: approved ? null : rejectionReason,
        customMessageLabel: 'LÝ DO KIỂM DUYỆT'
    });

    return {
        typeCode: approved ? 'POST_APPROVED' : 'POST_REJECTED',
        content: approved
            ? `Tin tuyển dụng "${job}" đã được duyệt và đang hiển thị`
            : `Tin tuyển dụng "${job}" bị từ chối${rejectionReason ? `: ${rejectionReason.replace(/\s+/g, ' ')}` : ''}`,
        link: '/admin/list-post/',
        email
    };
};

export const newApplicationTemplate = ({ candidateName, jobTitle }) => {
    const candidate = displayText(candidateName, 'Một ứng viên');
    const job = displayText(jobTitle, 'tin tuyển dụng của bạn');
    const subject = sanitizeSubject(`Hồ sơ ứng tuyển mới — ${job}`);
    const email = renderNotificationEmail({
        subject,
        preheader: `${candidate} vừa ứng tuyển vị trí ${job}`,
        eyebrow: 'HỒ SƠ MỚI',
        status: 'Ứng viên mới',
        headline: 'Bạn vừa nhận được một hồ sơ',
        icon: '+',
        accent: '#2563eb',
        softAccent: '#eff6ff',
        body: ['Một ứng viên vừa gửi hồ sơ qua Job Finder. Thông tin tóm tắt ở bên dưới.'],
        details: [
            { label: 'Ứng viên', value: candidate },
            { label: 'Vị trí', value: job }
        ],
        nextStep: 'Mở Quy trình tuyển dụng để xem CV, ghi chú và cập nhật trạng thái hồ sơ.',
        ctaLabel: 'Xem hồ sơ mới',
        ctaPath: '/admin/pipeline/'
    });

    return {
        typeCode: 'NEW_CV',
        content: `${candidate} vừa ứng tuyển vị trí "${job}"`,
        link: '/admin/pipeline/',
        email
    };
};

export const newJobFromFollowedCompanyTemplate = ({ jobTitle, companyName, jobId }) => {
    const company = displayText(companyName, 'Công ty bạn theo dõi');
    const job = displayText(jobTitle, 'một vị trí mới');
    const jobPath = safeJobPath(jobId);
    const subject = sanitizeSubject(`${company} vừa đăng tin mới`);
    const email = renderNotificationEmail({
        subject,
        preheader: `${company} vừa đăng tin tuyển dụng ${job}`,
        eyebrow: 'CƠ HỘI MỚI',
        status: 'Tin tuyển dụng mới',
        headline: 'Công ty bạn theo dõi vừa có vị trí mới',
        icon: '+',
        accent: '#7c3aed',
        softAccent: '#f5f3ff',
        body: [`${company} vừa đăng một cơ hội việc làm mới trên Job Finder.`],
        details: [
            { label: 'Vị trí', value: job },
            { label: 'Công ty', value: company }
        ],
        nextStep: 'Đọc mô tả công việc, yêu cầu và quyền lợi trước khi ứng tuyển.',
        ctaLabel: 'Xem chi tiết công việc',
        ctaPath: jobPath
    });

    return {
        typeCode: 'NEW_POST',
        content: `${company} vừa đăng tin tuyển dụng: ${job}`,
        link: jobPath,
        email
    };
};

function renderNotificationEmail({
    subject, preheader, eyebrow, status, headline, icon, accent, softAccent,
    body = [], details = [], nextStep, ctaLabel, ctaPath, secondaryLink,
    progressStep = null, customMessage, customMessageLabel = 'LỜI NHẮN TỪ NHÀ TUYỂN DỤNG'
}) {
    const safeSubject = escapeHtml(subject);
    const safePreheader = escapeHtml(displayText(preheader, subject));
    const safeEyebrow = escapeHtml(eyebrow);
    const safeStatus = escapeHtml(status);
    const safeHeadline = escapeHtml(headline);
    const safeAccent = safeColor(accent, '#2563eb');
    const safeSoftAccent = safeColor(softAccent, '#eff6ff');
    const ctaUrl = absoluteFrontendUrl(ctaPath);
    const secondaryUrl = secondaryLink ? absoluteFrontendUrl(secondaryLink.path) : null;
    const bodyRows = body.map((paragraph) => `
                                <p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.72;mso-line-height-rule:exactly">${escapeHtml(paragraph)}</p>`).join('');
    const detailsRows = details.map(({ label, value }, index) => `
                                            <tr>
                                                <td style="padding:${index ? '12px 0 0' : '0'};color:#64748b;font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:.06em;width:120px;vertical-align:top">${escapeHtml(label)}</td>
                                                <td style="padding:${index ? '12px 0 0' : '0'};color:#0f172a;font-size:15px;font-weight:700;line-height:1.45;vertical-align:top">${escapeHtml(value)}</td>
                                            </tr>`).join('');
    const progress = progressStep ? renderProgress(progressStep, safeAccent) : '';
    const customMessageHtml = customMessage ? `
                        <tr>
                            <td class="content-pad" style="padding:0 34px 26px">
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                                    <tr>
                                        <td style="padding:17px 19px">
                                            <p style="margin:0 0 8px;color:#64748b;font-size:11px;font-weight:700;line-height:1.4;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(customMessageLabel)}</p>
                                            <p style="margin:0;color:#334155;font-size:15px;line-height:1.65;mso-line-height-rule:exactly">${escapeHtml(customMessage).replace(/\r\n?|\n/g, '<br>')}</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>` : '';
    const secondaryLinkHtml = secondaryLink ? `
                                            <p style="margin:13px 0 0;text-align:center;font-size:13px;line-height:1.5">
                                                <a href="${escapeHtml(secondaryUrl)}" style="color:${safeAccent};text-decoration:underline">${escapeHtml(secondaryLink.label)}</a>
                                            </p>` : '';

    const html = `<!doctype html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${safeSubject}</title>
    <style>
        body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
        table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
        table { border-collapse:collapse !important; }
        @media only screen and (max-width:620px) {
            .email-shell { width:100% !important; }
            .outer-pad { padding:18px 10px !important; }
            .content-pad { padding-left:22px !important; padding-right:22px !important; }
            .header-pad { padding-left:22px !important; padding-right:22px !important; }
            .headline { font-size:25px !important; }
            .progress-label { font-size:9px !important; }
            .cta-table { width:100% !important; }
            .cta-link { display:block !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div class="preheader" data-preheader="true" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${safePreheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7fb">
        <tr>
            <td class="outer-pad" align="center" style="padding:34px 14px">
                <!--[if mso]><table role="presentation" width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
                <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
                    <tr>
                        <td class="header-pad" style="padding:23px 34px;background:#0f172a">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="vertical-align:middle">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                            <tr>
                                                <td width="34" height="34" align="center" style="width:34px;height:34px;background:#2563eb;border-radius:9px;color:#ffffff;font-size:13px;font-weight:800;line-height:34px">JF</td>
                                                <td style="padding-left:11px;color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-.02em">Job Finder</td>
                                            </tr>
                                        </table>
                                    </td>
                                    <td align="right" style="vertical-align:middle">
                                        <span style="display:inline-block;background:${safeSoftAccent};color:${safeAccent};border-radius:999px;padding:7px 11px;font-size:11px;font-weight:800;line-height:1.2">${safeStatus}</span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td class="content-pad" style="padding:34px 34px 22px">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td width="46" height="46" align="center" style="width:46px;height:46px;background:${safeSoftAccent};border-radius:12px;color:${safeAccent};font-size:21px;font-weight:800;line-height:46px">${icon}</td>
                                </tr>
                            </table>
                            <p style="margin:18px 0 7px;color:${safeAccent};font-size:11px;font-weight:800;line-height:1.4;letter-spacing:.1em;text-transform:uppercase">${safeEyebrow}</p>
                            <h1 class="headline" style="margin:0 0 14px;color:#0f172a;font-size:29px;line-height:1.24;letter-spacing:-.035em">${safeHeadline}</h1>${bodyRows}
                        </td>
                    </tr>
                    ${progress}
                    <tr>
                        <td class="content-pad" style="padding:0 34px 24px">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                                <tr>
                                    <td style="padding:18px 19px">
                                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${detailsRows}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td class="content-pad" style="padding:0 34px 25px">
                            <p style="margin:0 0 7px;color:#0f172a;font-size:13px;font-weight:800;line-height:1.4">Bước tiếp theo</p>
                            <p style="margin:0;color:#475569;font-size:14px;line-height:1.65;mso-line-height-rule:exactly">${escapeHtml(nextStep)}</p>
                        </td>
                    </tr>
                    ${customMessageHtml}
                    <tr>
                        <td class="content-pad" style="padding:0 34px 32px">
                            <table class="cta-table" role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td align="center" bgcolor="${safeAccent}" style="background:${safeAccent};border-radius:10px">
                                        <a class="cta-link" href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:14px;font-weight:800;line-height:1.2;text-decoration:none">${escapeHtml(ctaLabel)}</a>
                                    </td>
                                </tr>
                            </table>${secondaryLinkHtml}
                        </td>
                    </tr>
                    <tr>
                        <td class="content-pad" style="padding:20px 34px 24px;border-top:1px solid #e2e8f0;background:#fbfdff">
                            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6">Email tự động từ Job Finder. Vui lòng không trả lời trực tiếp email này.</p>
                        </td>
                    </tr>
                </table>
                <!--[if mso]></td></tr></table><![endif]-->
            </td>
        </tr>
    </table>
</body>
</html>`;

    const text = renderPlainText({
        eyebrow, status, headline, body, details, nextStep, ctaLabel, ctaUrl,
        secondaryLink, secondaryUrl, customMessage, customMessageLabel
    });
    return { subject, html, text };
}

function renderProgress(currentStep, accent) {
    const cells = PIPELINE_STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < currentStep ? 'completed' : step === currentStep ? 'current' : 'upcoming';
        const color = state === 'upcoming' ? '#dbe3ef' : accent;
        const labelColor = state === 'upcoming' ? '#94a3b8' : '#334155';
        return `
                                    <td width="20%" align="center" data-progress-step="${step}" data-state="${state}" style="width:20%;padding:0 3px;vertical-align:top">
                                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                            <tr><td height="6" bgcolor="${color}" style="height:6px;background:${color};border-radius:999px;font-size:0;line-height:0">&nbsp;</td></tr>
                                        </table>
                                        <p class="progress-label" style="margin:7px 0 0;color:${labelColor};font-size:10px;font-weight:${state === 'current' ? '800' : '600'};line-height:1.3">${escapeHtml(label)}</p>
                                    </td>`;
    }).join('');

    return `
                    <tr>
                        <td class="content-pad" style="padding:1px 31px 24px">
                            <table role="presentation" aria-label="Tiến trình tuyển dụng: bước ${currentStep} trên 5" data-progress-current="${currentStep}" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>${cells}
                                </tr>
                            </table>
                        </td>
                    </tr>`;
}

function renderPlainText({
    eyebrow, status, headline, body, details, nextStep, ctaLabel, ctaUrl,
    secondaryLink, secondaryUrl, customMessage, customMessageLabel
}) {
    return [
        'JOB FINDER',
        `${eyebrow} — ${status}`,
        '',
        headline,
        '',
        ...body,
        '',
        ...details.map(({ label, value }) => `${label}: ${value}`),
        '',
        'Bước tiếp theo:',
        nextStep,
        '',
        `${ctaLabel}: ${ctaUrl}`,
        ...(secondaryLink ? [`${secondaryLink.label}: ${secondaryUrl}`] : []),
        ...(customMessage ? ['', `${customMessageLabel}:`, customMessage] : []),
        '',
        'Email tự động từ Job Finder. Vui lòng không trả lời trực tiếp email này.'
    ].join('\n');
}

function absoluteFrontendUrl(path) {
    const rawBase = displayText(process.env.FRONTEND_URL, DEFAULT_FRONTEND_URL);
    let base = DEFAULT_FRONTEND_URL;
    try {
        const candidate = new URL(rawBase);
        if (!['http:', 'https:'].includes(candidate.protocol)) throw new Error('unsupported protocol');
        base = candidate.origin;
    } catch {
        base = DEFAULT_FRONTEND_URL;
    }

    const safePath = typeof path === 'string' && path.startsWith('/') ? path : '/';
    return new URL(safePath, `${base}/`).toString();
}

function safeJobPath(jobId) {
    const value = displayText(jobId);
    return value ? `/detail-job/${encodeURIComponent(value)}` : JOBS_PATH;
}

function sanitizeSubject(value) {
    return displayText(value, 'Thông báo từ Job Finder').slice(0, 180);
}

function displayText(value, fallback = '') {
    const text = value === null || value === undefined ? '' : String(value);
    const normalized = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}

function displayMultilineText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
        .trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}
