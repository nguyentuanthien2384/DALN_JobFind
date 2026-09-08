import { pool } from '../libs/db.js';
import { createLogger } from '../../../shared/logger.js';
import { moderationContentHash } from '../libs/moderationState.js';

const logger = createLogger('job-core-service.workspace');
const validId = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const identity = req => {
    const userId = req.headers['x-user-id'], companyId = req.headers['x-company-id'];
    if (!['COMPANY', 'EMPLOYER'].includes(req.headers['x-user-role']) || !validId(userId) || !validId(companyId)) return null;
    return { userId: Number(userId), companyId: Number(companyId) };
};
const pageQuery = query => {
    const limit = query.limit ?? '5', offset = query.offset ?? '0';
    if (![limit, offset].every(value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))
        || Number(limit) < 1 || Number(limit) > 50 || Number(offset) > 1000000) return null;
    return { limit: Number(limit), offset: Number(offset) };
};
const countOf = value => {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid workspace count');
    return count;
};
const actorScope = `FROM users actor JOIN companies company ON company.id = actor.companyId
    WHERE actor.id = ? AND actor.companyId = ? AND company.statusCode = 'S1' AND company.censorCode = 'CS1'`;

// Read-only company workspace, including non-public/expired posts. ADMIN keeps
// its separate legacy moderation list; no cross-company selector is accepted.
export const listManagedJobs = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const actor = identity(req);
    if (!actor) return res.status(403).json({ errCode: 3, errMessage: 'Danh sách này chỉ dành cho nhà tuyển dụng trong công ty' });
    const page = pageQuery(req.query), search = req.query.search ?? '', status = req.query.statusCode ?? '';
    if (!page || typeof search !== 'string' || search.length > 255 || !['', 'PS1', 'PS2', 'PS3', 'PS4'].includes(status)
        || Object.keys(req.query).some(key => !['limit', 'offset', 'search', 'statusCode'].includes(key))) {
        return res.status(400).json({ errCode: 1, errMessage: 'Bộ lọc danh sách không hợp lệ' });
    }
    const filters = ['owner.companyId = ?'], args = [actor.companyId];
    if (status) { filters.push('p.statusCode = ?'); args.push(status); }
    if (search) {
        // Treat %, _ and ! as literal user text, not wildcard expansion.
        const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
        filters.push("(d.name LIKE ? ESCAPE '!' OR CAST(p.id AS CHAR) LIKE ? ESCAPE '!')"); args.push(pattern, pattern);
    }
    const from = `FROM posts p JOIN users owner ON owner.id = p.userId
        LEFT JOIN detailposts d ON d.id = p.detailPostId WHERE ${filters.join(' AND ')}`;
    try {
        // One statement/snapshot for live tenant authorization, count AND page.
        // LEFT JOIN preserves the authorized empty/out-of-range page and count.
        const [rows] = await pool.query(`SELECT totals.total, page.*
            FROM (SELECT actor.id ${actorScope}) authorized
            CROSS JOIN (SELECT COUNT(*) AS total ${from}) totals
            LEFT JOIN (SELECT p.id, d.name, p.statusCode, p.timeEnd, p.isHot, p.updatedAt, p.userId,
                owner.companyId, owner.firstName AS authorFirstName, owner.lastName AS authorLastName
                ${from} ORDER BY p.updatedAt DESC, p.id DESC LIMIT ? OFFSET ?) page ON 1 = 1
            ORDER BY page.updatedAt DESC, page.id DESC`,
        [actor.userId, actor.companyId, ...args, ...args, page.limit, page.offset]);
        if (!rows.length) return res.status(403).json({ errCode: 3, errMessage: 'Không đọc được danh sách trong phạm vi công ty hiện tại' });
        const data = rows.filter(row => row.id != null).map(row => ({ id: row.id, name: row.name, statusCode: row.statusCode,
            timeEnd: row.timeEnd, isHot: row.isHot, updatedAt: row.updatedAt, userId: row.userId, companyId: row.companyId,
            authorFirstName: row.authorFirstName, authorLastName: row.authorLastName }));
        return res.json({ errCode: 0, data, count: countOf(rows[0].total) });
    } catch (error) {
        logger.error('doc danh sach quan ly that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được danh sách tin qua Job Core' });
    }
};

// Do not infer manual/AI provenance from PS3, nor worker execution from an
// accepted request. Cancelled, old content and unknown state cannot claim AI
// approval of the current post. Never return hashes/request IDs/prompts/results.
export const reviewState = row => {
    if (row.aiState === 'cancelled') return 'no_active_ai';
    if (typeof row.name !== 'string' || typeof row.descriptionHTML !== 'string') return 'untracked';
    if (row.aiContentHash !== moderationContentHash(row)) return 'untracked';
    if (row.aiState === 'pending' && row.statusCode === 'PS3') return 'ai_requested';
    if (row.aiState === 'failed' && row.statusCode === 'PS3') return 'ai_failed';
    if (row.aiState === 'applied' && ['PS1', 'PS2'].includes(row.statusCode)) return 'ai_applied';
    return 'untracked';
};
export const getManagedJobReview = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const actor = identity(req);
    if (!actor) return res.status(403).json({ errCode: 3, errMessage: 'Thông tin này chỉ dành cho nhà tuyển dụng trong công ty' });
    const page = pageQuery(req.query), id = req.params.id;
    if (!page || !validId(id) || Object.keys(req.query).some(key => !['limit', 'offset'].includes(key))) {
        return res.status(400).json({ errCode: 1, errMessage: 'Tin hoặc phân trang không hợp lệ' });
    }
    try {
        const [rows] = await pool.query(`SELECT p.id AS jobId, d.name, d.descriptionHTML, p.statusCode, owner.companyId,
                m.state AS aiState, m.contentHash AS aiContentHash, totals.total, page.*
            FROM posts p JOIN users owner ON owner.id = p.userId
            JOIN users actor ON actor.id = ? AND actor.companyId = owner.companyId
            JOIN companies company ON company.id = actor.companyId
            LEFT JOIN detailposts d ON d.id = p.detailPostId
            LEFT JOIN job_moderation_state m ON m.jobId = p.id
            CROSS JOIN (SELECT COUNT(*) AS total FROM notes WHERE postId = ?) totals
            LEFT JOIN (SELECT n.id AS noteId, n.note, n.createdAt, n.userId AS authorId,
                    writer.firstName AS authorFirstName, writer.lastName AS authorLastName
                FROM notes n LEFT JOIN users writer ON writer.id = n.userId WHERE n.postId = ?
                ORDER BY n.createdAt DESC, n.id DESC LIMIT ? OFFSET ?) page ON 1 = 1
            WHERE p.id = ? AND actor.companyId = ? AND company.statusCode = 'S1' AND company.censorCode = 'CS1'
            ORDER BY page.createdAt DESC, page.noteId DESC`,
        [actor.userId, Number(id), Number(id), page.limit, page.offset, Number(id), actor.companyId]);
        if (!rows.length) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin trong phạm vi quản lý' });
        const first = rows[0];
        return res.json({ errCode: 0, data: {
            job: { id: first.jobId, name: first.name, statusCode: first.statusCode, companyId: first.companyId, reviewState: reviewState(first) },
            notes: rows.filter(row => row.noteId != null).map(row => ({ id: row.noteId, note: row.note, createdAt: row.createdAt,
                authorId: row.authorId, authorFirstName: row.authorFirstName, authorLastName: row.authorLastName })), count: countOf(first.total)
        } });
    } catch (error) {
        logger.error('doc thong tin kiem duyet that bai', { error: error.message, postId: id });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được thông tin kiểm duyệt qua Job Core' });
    }
};
