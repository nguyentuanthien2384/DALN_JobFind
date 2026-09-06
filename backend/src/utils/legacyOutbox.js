import { randomUUID } from 'crypto';
import db from '../models/index';
import { serializeEventPayload } from './eventContract';
import { PostingQuotaError } from './postingQuota';

// Shared-DB transition only: the existing Job Core relay drains these rows.
// Never create/repair schema here, fall back to direct publishing, or use a
// connection outside the transaction that changes the job.
export const assertTransactionalLegacyOutbox = async transaction => {
    if (!transaction) throw new Error('Legacy outbox requires the posting transaction');
    const [tables] = await db.sequelize.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events'`, { transaction });
    if (tables.length !== 1 || tables[0].engine?.toUpperCase() !== 'INNODB') {
        throw new PostingQuotaError('Chưa thể lưu tin: nơi lưu yêu cầu đồng bộ chưa sẵn sàng');
    }
};

const POST_FIELDS = ['id', 'statusCode', 'timePost', 'timeEnd', 'isHot', 'userId'];
const DETAIL_FIELDS = ['name', 'descriptionHTML', 'descriptionMarkdown', 'amount',
    'categoryJobCode', 'addressCode', 'salaryJobCode', 'categoryJoblevelCode',
    'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode'];
const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field] ?? null]));

// Inputs are current rows already locked by the create/moderation/edit writer, AFTER save.
// An ORM instance/body spread can leak private fields or overwrite post.id with
// detail.id. This allowlist matches the old job.created/updated payload explicitly.
const enqueueLegacyJob = async (eventType, { post, detail, owner, company }, transaction) => {
    await assertTransactionalLegacyOutbox(transaction);
    const job = { ...pick(post, POST_FIELDS), ...pick(detail, DETAIL_FIELDS),
        companyId: owner?.companyId ?? null, companyName: company?.name ?? null,
        companyLogo: company?.thumbnail ?? null, companyStatusCode: company?.statusCode ?? null,
        companyCensorCode: company?.censorCode ?? null };
    const { json, aggregateId } = serializeEventPayload(eventType, { job }, { aggregateId: post.id });
    const eventId = randomUUID();
    await db.sequelize.query(`INSERT INTO outbox_events
        (id, aggregateType, aggregateId, eventType, payload, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)`, {
        // Reserved discriminator, not a new domain aggregate or authorization.
        // Old rows retain their existing producer; no pending payload is rewritten.
        replacements: [eventId, 'legacy-job', aggregateId, eventType, json, new Date()], transaction
    });
    return eventId;
};

export const enqueueLegacyJobUpdated = (rows, transaction) => enqueueLegacyJob('job.updated', rows, transaction);
export const enqueueLegacyJobCreated = (rows, transaction) => enqueueLegacyJob('job.created', rows, transaction);
