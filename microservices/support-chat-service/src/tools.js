import { failure } from './policy.js';
import { hasApprovedCompany } from '../../shared/accessControl.js';
import { normalize } from './knowledge.js';

export const privateToolNames = [
    'getMyProfileSummary',
    'getMyApplications',
    'getMySavedJobs',
    'getMyCompanyJobs',
    'getSubscriptionStatus',
    'getMyRewards',
    'getMyInterviews',
    'getAdminOverview'
];

export function privateIntent(text) {
    const value = normalize(text);
    if (!/\b(toi|minh)\b/.test(value)) return null;
    // A how-to question is public guidance even if the speaker says "tôi".
    if (/\b(lam sao|cach|o dau|huong dan|bat dau|can lam gi)\b/.test(value)) return null;
    if (/lich phong van/.test(value)) return 'getMyInterviews';
    if (/diem thuong|top point|so du diem|vi diem|hang thanh vien|quy luot/.test(value)) return 'getMyRewards';
    if (/viec can duyet|tin cho duyet|hang doi ho tro|can kiem duyet/.test(value)) return 'getAdminOverview';
    if (/don ung tuyen|da ung tuyen|trang thai ho so/.test(value)) return 'getMyApplications';
    if (/viec.*da luu|tin.*da luu/.test(value)) return 'getMySavedJobs';
    if (/han muc|goi cuoc|goi dang tin|luot xem cv/.test(value)) return 'getSubscriptionStatus';
    if (/tin.*cong ty|bai dang.*cong ty/.test(value)) return 'getMyCompanyJobs';
    if (/ho so cua (toi|minh)|thong tin tai khoan/.test(value)) return 'getMyProfileSummary';
    return null;
}

const INTERVIEW_MODES = { online: 'Trực tuyến', onsite: 'Trực tiếp', phone: 'Điện thoại' };
const formatInterviewTime = value => {
    const time = Date.parse(value || '');
    return Number.isFinite(time)
        ? new Date(time).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
        : 'Chưa rõ giờ';
};

export function createTools({ pool, env = process.env, fetcher = fetch }) {
    const headersFor = user => ({ 'Content-Type': 'application/json', 'x-internal-secret': env.INTERNAL_SECRET,
        ...(user && { 'x-user-id': String(user.id), 'x-user-role': user.roleCode, 'x-company-id': String(user.companyId || ''), 'x-company-status': user.companyStatusCode || '', 'x-company-censor': user.companyCensorCode || '' }) });
    async function internal(base, path, user, options = {}) {
        const response = await fetcher(`${base.replace(/\/$/, '')}${path}`, { ...options, headers: headersFor(user), signal: options.signal || AbortSignal.timeout(8000) });
        if (!response.ok) throw failure(response.status === 401 || response.status === 403 ? response.status : 503, 'Chưa đọc được dữ liệu hiện tại. Vui lòng thử lại hoặc liên hệ hỗ trợ.');
        const result = await response.json();
        if (result.errCode) throw failure(503, 'Dữ liệu chưa sẵn sàng.');
        return result.data;
    }
    return {
        async publicTool(name, args, signal) {
            return internal(env.LEGACY_URL || 'http://host.docker.internal:5000', '/internal/support/public-tool', null,
                { method: 'POST', body: JSON.stringify({ name, args }), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(8000)]) });
        },
        async privateTool(name, user) {
            if (!user) throw failure(401, 'Bạn cần đăng nhập để tra cứu dữ liệu cá nhân.');
            if (!privateToolNames.includes(name)) throw failure(400, 'Công cụ không hợp lệ.');
            const candidateOnly = ['getMyApplications', 'getMySavedJobs'];
            if (candidateOnly.includes(name) && user.roleCode !== 'CANDIDATE') throw failure(403, 'Chức năng này dành cho tài khoản ứng viên.');
            const isApprovedEmployer = ['COMPANY', 'EMPLOYER'].includes(user.roleCode) && hasApprovedCompany(user);
            if (['getMyCompanyJobs', 'getSubscriptionStatus'].includes(name) && !isApprovedEmployer)
                throw failure(403, 'Bạn cần thuộc công ty đang hoạt động và đã được duyệt.');
            if (['getMyRewards', 'getMyInterviews'].includes(name) && user.roleCode !== 'CANDIDATE' && !isApprovedEmployer)
                throw failure(403, 'Chức năng này dành cho ứng viên hoặc thành viên công ty đã được duyệt.');
            if (name === 'getAdminOverview' && user.roleCode !== 'ADMIN')
                throw failure(403, 'Chức năng này chỉ dành cho Quản trị viên hệ thống.');

            if (name === 'getMyProfileSummary') {
                const profile = await internal(env.IDENTITY_URL || 'http://identity-service:4001', '/profile', user);
                return { title: 'Hồ sơ của tôi', lines: [`Vai trò: ${user.roleCode}`, `Đã có tiêu đề nghề nghiệp: ${profile.headline ? 'Có' : 'Chưa'}`, `Kỹ năng đã khai báo: ${profile.skills?.length || 0}`, `CV đã tạo: ${profile.cvs?.length || 0}`], href: user.roleCode === 'CANDIDATE' ? '/candidate/info' : '/admin/user-info' };
            }
            if (name === 'getMyApplications') {
                const rows = await internal(env.APPLICATION_URL || 'http://application-service:4004', '/my-applications', user);
                return { title: 'Đơn ứng tuyển của tôi', lines: rows.slice(0, 10).map(row => `${row.job_title || `Tin #${row.job_id}`}: ${row.stageLabel || row.stage}`), count: rows.length, href: '/candidate/cv-post' };
            }
            if (name === 'getMySavedJobs') {
                const [rows] = await pool.query(`SELECT p.id,d.name,p.statusCode,p.timeEnd FROM favoriteposts f JOIN posts p ON p.id=f.postId JOIN detailposts d ON d.id=p.detailPostId WHERE f.userId=? ORDER BY f.id DESC LIMIT 10`, [user.id]);
                return { title: 'Việc làm đã lưu', lines: rows.map(row => `${row.name} (#${row.id})${row.statusCode !== 'PS1' || Number(row.timeEnd) < Date.now() ? ' — không còn mở tuyển' : ''}`), href: '/candidate/saved-jobs' };
            }
            if (name === 'getMyRewards') {
                return internal(env.LEGACY_URL || 'http://host.docker.internal:5000', '/internal/support/private-tool', user,
                    { method: 'POST', body: JSON.stringify({ name: 'getMyRewards' }) });
            }
            if (name === 'getMyInterviews') {
                const isCandidate = user.roleCode === 'CANDIDATE';
                const rows = await internal(env.APPLICATION_URL || 'http://application-service:4004', isCandidate ? '/my-interviews' : '/applications/interviews', user);
                const active = (Array.isArray(rows) ? rows : []).filter(row => row.status !== 'inactive');
                const lines = active.slice(0, 10).map(row => {
                    const jobLabel = row.jobTitle || `Tin #${row.jobId}`;
                    const party = isCandidate ? (row.companyName || 'Doanh nghiệp') : (row.candidateName || `Ứng viên #${row.candidateId}`);
                    const mode = INTERVIEW_MODES[row.interview?.mode] || 'Phỏng vấn';
                    return `${formatInterviewTime(row.startAt || row.scheduledAt)} · ${jobLabel} (${party}) — ${mode}`;
                });
                return {
                    title: isCandidate ? 'Lịch phỏng vấn của tôi' : 'Lịch phỏng vấn công ty',
                    lines,
                    count: active.length,
                    href: isCandidate ? '/candidate/interviews' : '/admin/interviews'
                };
            }
            if (name === 'getAdminOverview') {
                const now = Date.now();
                const [[postRow]] = await pool.query("SELECT COUNT(*) AS count FROM posts WHERE statusCode='PS3'");
                const [[companyRow]] = await pool.query("SELECT COUNT(*) AS count FROM companies WHERE censorCode='CS3'");
                const [[handoffRow]] = await pool.query("SELECT COUNT(*) AS count FROM support_handoffs h JOIN support_conversations c ON c.id=h.conversation_id WHERE h.status='waiting' AND c.expires_at>?", [now]);
                const pendingPosts = Number(postRow?.count || 0);
                const pendingCompanies = Number(companyRow?.count || 0);
                const waitingHandoffs = Number(handoffRow?.count || 0);
                const href = waitingHandoffs > 0 ? '/admin/support' : pendingPosts > 0 ? '/admin/list-post-admin' : '/admin/list-company-admin';
                return {
                    title: 'Hàng đợi kiểm duyệt & hỗ trợ',
                    lines: [
                        `Yêu cầu hỗ trợ chờ tiếp nhận: ${waitingHandoffs}`,
                        `Tin tuyển dụng chờ duyệt: ${pendingPosts}`,
                        `Công ty chờ kiểm duyệt: ${pendingCompanies}`
                    ],
                    count: waitingHandoffs + pendingPosts + pendingCompanies,
                    href
                };
            }
            if (name === 'getMyCompanyJobs') {
                const [rows] = await pool.query(`SELECT p.id,d.name,p.statusCode FROM posts p JOIN detailposts d ON d.id=p.detailPostId JOIN users u ON u.id=p.userId WHERE u.companyId=? ORDER BY p.id DESC LIMIT 10`, [user.companyId]);
                return { title: 'Tin đăng của công ty', lines: rows.map(row => `${row.name} (#${row.id}): ${row.statusCode}`), href: '/admin/list-post' };
            }
            const [rows] = await pool.query('SELECT allowPost,allowHotPost,allowCv,allowCvFree FROM companies WHERE id=? AND statusCode=? AND censorCode=?', [user.companyId, 'S1', 'CS1']);
            if (!rows[0]) throw failure(403, 'Công ty không còn đủ điều kiện truy cập.');
            const quota = rows[0];
            return {
                title: 'Hạn mức hiện tại của công ty',
                lines: [`Tin thường: ${quota.allowPost ?? 0}`, `Tin nổi bật: ${quota.allowHotPost ?? 0}`, `Lượt xem CV: ${quota.allowCv ?? 0}`, `Lượt xem CV miễn phí: ${quota.allowCvFree ?? 0}`],
                href: user.roleCode === 'COMPANY' ? '/admin/buy-post' : '/admin/rewards'
            };
        },
        async deliver(ticket, user) {
            return internal(env.LEGACY_URL || 'http://host.docker.internal:5000', '/internal/support/handoff', user, { method: 'POST', body: JSON.stringify({ ticketId: ticket.id }) });
        }
    };
}
