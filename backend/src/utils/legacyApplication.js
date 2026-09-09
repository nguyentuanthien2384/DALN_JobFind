import { randomUUID } from 'crypto';
import db from '../models/index';
import { serializeEventPayload } from './eventContract';
import { isPostOpenForApplications } from './publicResources';

const id = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const failure = (errCode, errMessage, httpStatus = 400) => ({ errCode, errMessage, httpStatus });
const unavailable = () => Object.assign(new Error('Chưa thể nộp hồ sơ: cấu hình giao dịch và đồng bộ chưa sẵn sàng'), { applicationUnavailable: true });

// No runtime DDL or direct-publish fallback. Both the saved PDF and its delivery
// intent must survive together. This shared outbox is drained by the Core relay.
export const assertApplicationStorage = async transaction => {
    const required = ['cvs', 'users', 'accounts', 'companies', 'posts', 'detailposts', 'outbox_events'];
    const [tables] = await db.sequelize.query(`SELECT LOWER(TABLE_NAME) AS name, ENGINE AS engine
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN (:tables)`,
    { replacements: { tables: required }, transaction });
    if (required.some(name => !tables.some(table => table.name === name && table.engine?.toUpperCase() === 'INNODB'))) throw unavailable();
    const [indexes] = await db.sequelize.query(`SELECT INDEX_NAME AS name, COLUMN_NAME AS col, SEQ_IN_INDEX AS position, SUB_PART AS prefixLength
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'cvs'
        AND NON_UNIQUE = 0 ORDER BY INDEX_NAME, SEQ_IN_INDEX`, { transaction });
    const groups = new Map();
    // Inspect every column: filtering prefix columns in SQL could mistake a
    // three-column unique index for the required two-column constraint.
    for (const row of indexes) groups.set(row.name, [...(groups.get(row.name) || []), row]);
    if (![...groups.values()].some(columns => columns.length === 2
        && columns.every(column => column.prefixLength == null && typeof column.col === 'string')
        && columns.some(column => column.col.toLowerCase() === 'userid')
        && columns.some(column => column.col.toLowerCase() === 'postid'))) throw unavailable();
};

export const submitLegacyApplication = async data => {
    if (!id(data.userId) || !id(data.postId) || typeof data.file !== 'string' || !data.file.trim()
        || typeof data.description !== 'string' || !data.description.trim() || Array.from(data.description).length > 255) {
        return failure(1, 'Cần CV và lời giới thiệu từ 1 đến 255 ký tự cho công việc hợp lệ');
    }
    const initial = await db.Post.findOne({ where: { id: data.postId }, attributes: ['id', 'userId'], raw: true });
    if (!initial) return failure(3, 'Không tìm thấy tin tuyển dụng đang công khai', 404);
    try {
        return await db.sequelize.transaction(async transaction => {
            await assertApplicationStorage(transaction);
            // Same user -> company -> post lock order as job writers. All event
            // identities/titles below come from current locked rows, never body.
            const ids = [...new Set([Number(data.userId), Number(initial.userId)])].sort((a,b) => a-b);
            const users = await db.User.findAll({ where: { id: ids }, attributes: ['id','companyId','firstName','lastName','email'],
                order: [['id','ASC']], transaction, lock: transaction.LOCK.UPDATE, raw: true });
            const candidate = users.find(user => user.id === Number(data.userId));
            const owner = users.find(user => user.id === initial.userId);
            if (!candidate || !owner?.companyId) return failure(3, 'Không tìm thấy tin tuyển dụng đang công khai', 404);
            const company = await db.Company.findOne({ where: { id: owner.companyId }, attributes: ['id','statusCode','censorCode'],
                transaction, lock: transaction.LOCK.UPDATE, raw: true });
            const accounts = await db.Account.findAll({ where: { userId: ids }, attributes: ['id','userId','roleCode','statusCode','phonenumber'],
                order: [['userId','ASC'],['id','ASC']], transaction, lock: transaction.LOCK.UPDATE, raw: true });
            const candidateAccount = accounts.find(account => account.userId === candidate.id);
            if (!candidateAccount || candidateAccount.statusCode !== 'S1' || candidateAccount.roleCode !== 'CANDIDATE') return failure(3, 'Chỉ ứng viên đang hoạt động được nộp CV', 403);
            const existing = await db.Cv.findOne({ where: { userId: candidate.id, postId: Number(data.postId) }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (existing) return { ...failure(5, 'Bạn đã ứng tuyển tin này', 409), cvId: existing.id };
            const post = await db.Post.findOne({ where: { id: data.postId }, attributes: ['id','userId','detailPostId','statusCode','timeEnd'],
                transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!post || post.userId !== initial.userId || post.statusCode !== 'PS1' || company?.statusCode !== 'S1'
                || company?.censorCode !== 'CS1' || !accounts.some(account => account.userId === owner.id && account.statusCode === 'S1')) {
                return failure(3, 'Không tìm thấy tin tuyển dụng đang công khai', 404);
            }
            const detail = await db.DetailPost.findOne({ where: { id: post.detailPostId }, attributes: ['id','name'], transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!detail) return failure(3, 'Không tìm thấy nội dung tin tuyển dụng', 404);
            if (!isPostOpenForApplications(post)) return failure(4, 'Tin tuyển dụng đã hết hạn ứng tuyển', 409);
            const appliedAt = new Date();
            const cv = await db.Cv.create({ userId: candidate.id, file: data.file, postId: post.id, isChecked: 0,
                description: data.description, createdAt: appliedAt, updatedAt: appliedAt }, { transaction });
            if (!cv?.id) throw unavailable();
            const { json, aggregateId } = serializeEventPayload('application.submitted', {
                cvId: cv.id, jobId: post.id, jobTitle: detail.name, candidateId: candidate.id,
                candidateName: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || null,
                candidateEmail: candidate.email ?? null, candidatePhone: candidateAccount.phonenumber ?? null,
                companyId: company.id, posterId: owner.id, coverLetter: data.description, appliedAt: appliedAt.toISOString()
            });
            await db.sequelize.query(`INSERT INTO outbox_events (id, aggregateType, aggregateId, eventType, payload, createdAt)
                VALUES (?, ?, ?, ?, ?, ?)`, { replacements: [randomUUID(), 'legacy-application', aggregateId, 'application.submitted', json, appliedAt], transaction });
            return { errCode: 0, cvId: cv.id, errMessage: 'Đã gửi CV thành công' };
        });
    } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') return failure(5, 'Bạn đã ứng tuyển tin này', 409);
        if (error.applicationUnavailable) return failure(2, error.message, 503);
        throw error;
    }
};
