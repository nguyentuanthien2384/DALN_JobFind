import db from '../models';
import { Op, literal } from 'sequelize';
import { randomUUID, createHash } from 'crypto';
import { validateChatPdf } from '../utils/chatPdf';
const limiter = require('../utils/realtimeLimiter');
const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const error = (errMessage, httpStatus = 400) => ({ errCode: httpStatus === 403 ? 5 : 1, httpStatus, errMessage });
export const attachmentMetadata = row => ({ id: row.id, name: row.name, mimeType: row.mimeType, size: row.size, pageCount: row.pageCount });
export const richRelationship = async (senderId, receiverId) => {
    const relation = await require('./chatService').canParticipantsChat(senderId, receiverId);
    return relation.allowed && relation.waitingReply ? relation : null;
};
export const hydrateChatMessages = async rows => {
    const messages = rows.map(row => {
        const message = row?.get ? row.get({ plain: true }) : { ...row };
        // MariaDB exposes JSON columns as text through the MySQL driver.
        if (typeof message.jobSnapshot === 'string') {
            try { message.jobSnapshot = JSON.parse(message.jobSnapshot); }
            catch { message.jobSnapshot = null; }
        }
        return message;
    });
    const ids = [...new Set(messages.map(row => row.attachmentId).filter(Boolean))];
    if (!ids.length) return messages;
    const attachments = await db.ChatAttachment.findAll({ where: { id: { [Op.in]: ids } },
        attributes: ['id', 'name', 'mimeType', 'size', 'pageCount', 'senderId', 'receiverId'], raw: true });
    return messages.map(message => {
        const file = attachments.find(row => row.id === message.attachmentId && Number(row.senderId) === Number(message.senderId) && Number(row.receiverId) === Number(message.receiverId));
        return { ...message, ...(file ? { attachment: attachmentMetadata(file) } : {}) };
    });
};

export const uploadChatAttachment = async (userId, data) => {
    const receiverId = Number(data.receiverId);
    if (!Number.isSafeInteger(receiverId) || receiverId <= 0 || !await richRelationship(userId, receiverId)) return error('Bạn không có quyền gửi tài liệu trong cuộc trò chuyện này.', 403);
    const rate = await limiter.consume(`chat-upload:${userId}`, 10, 60000);
    const daily = await limiter.consume(`chat-upload-daily:${userId}`, 100, 86400000);
    if (!rate.allowed || !daily.allowed) return error('Bạn tải tài liệu quá nhanh. Vui lòng thử lại sau.', 429);
    if (typeof data.fileName !== 'string' || data.fileName.length > 255 || !/\.pdf$/i.test(data.fileName) || /[\x00-\x1f\\/]/.test(data.fileName)) return error('Tên tài liệu PDF không hợp lệ.');
    const encoded = data.fileBase64;
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return error('PDF tối đa 5 MB và phải có định dạng hợp lệ.');
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== encoded || bytes.subarray(0, 5).toString() !== '%PDF-') return error('Tệp không phải PDF hợp lệ hoặc vượt quá 5 MB.');
    const sha256 = createHash('sha256').update(data.fileName).update('\0').update(bytes).digest('hex');
    const where = { senderId: userId, receiverId, sha256 };
    const existing = await db.ChatAttachment.findOne({ where, raw: true });
    if (existing) return { errCode: 0, data: attachmentMetadata(existing) };
    let validated;
    try { validated = await validateChatPdf(bytes); } catch (failure) { return error(failure.message); }
    try {
        const row = await db.ChatAttachment.create({ id: randomUUID(), ...where, name: data.fileName, mimeType: 'application/pdf',
            size: bytes.length, pageCount: validated.pageCount, bytes });
        return { errCode: 0, data: attachmentMetadata(row) };
    } catch (failure) {
        if (failure.name !== 'SequelizeUniqueConstraintError') throw failure;
        const row = await db.ChatAttachment.findOne({ where, raw: true });
        if (!row) throw failure;
        return { errCode: 0, data: attachmentMetadata(row) };
    }
};

export const readChatAttachment = async (userId, id) => {
    if (typeof id !== 'string' || !UUID.test(id)) return error('Không tìm thấy tài liệu.', 404);
    const row = await db.ChatAttachment.findOne({ where: { id }, raw: true });
    if (!row || ![Number(row.senderId), Number(row.receiverId)].includes(Number(userId))) return error('Không tìm thấy tài liệu.', 404);
    if (!await richRelationship(row.senderId, row.receiverId)) return error('Bạn không còn quyền xem tài liệu trong cuộc trò chuyện này.', 403);
    if (Number(userId) !== Number(row.senderId)) {
        const sent = await db.ChatMessage.findOne({ where: { attachmentId: id, senderId: row.senderId, receiverId: row.receiverId }, attributes: ['id'], raw: true });
        if (!sent) return error('Không tìm thấy tài liệu.', 404);
    }
    const file = await db.ChatAttachment.unscoped().findOne({ where: { id }, attributes: ['bytes'], raw: true });
    if (!Buffer.isBuffer(file?.bytes)) return error('Không tìm thấy tài liệu.', 404);
    return { errCode: 0, data: { ...attachmentMetadata(row), fileBase64: file.bytes.toString('base64') } };
};

const plainDescription = value => String(value || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:p|div|h[1-6]|li|br|ul|ol)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }[entity]))
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => { const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; })
    .replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n').trim().slice(0, 20000);
const jobSnapshot = row => {
    const detail = row.postDetailData;
    return { id: Number(row.id), name: detail.name, companyName: row.userPostData.userCompanyData.name,
        descriptionText: plainDescription(detail.descriptionHTML || detail.descriptionMarkdown),
        salary: detail.salaryTypePostData?.value || '', experience: detail.expTypePostData?.value || '',
        location: detail.provincePostData?.value || '', workType: detail.workTypePostData?.value || '',
        updatedAt: row.updatedAt, sharedAt: new Date().toISOString() };
};
export const listChatJobs = async (userId, data) => {
    const partnerId = Number(data.partnerId);
    if (!Number.isSafeInteger(partnerId) || partnerId <= 0) return error('Người nhận không hợp lệ.');
    const relation = await richRelationship(userId, partnerId);
    if (!relation) return error('Không có quyền xem tin trong cuộc trò chuyện này.', 403);
    const recruiter = await db.User.findOne({ where: { id: relation.waitingReply.recruiterId }, attributes: ['companyId'], raw: true });
    const limit = Number(data.limit ?? 10), offset = Number(data.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
        (data.search !== undefined && (typeof data.search !== 'string' || data.search.length > 120)) ||
        (data.jobPostId !== undefined && (!Number.isSafeInteger(Number(data.jobPostId)) || Number(data.jobPostId) <= 0))) return error('Tham số tìm kiếm không hợp lệ.');
    if (!recruiter?.companyId) return error('Không tìm thấy công ty.', 403);
    const where = { statusCode: 'PS1', [Op.and]: [literal(`CAST(\`Post\`.timeEnd AS UNSIGNED) > ${Date.now()}`)] };
    if (data.jobPostId) where.id = data.jobPostId;
    const result = await db.Post.findAndCountAll({ where, attributes: ['id', 'updatedAt'],
        include: [
            { model: db.User, as: 'userPostData', attributes: ['companyId'], required: true, where: { companyId: recruiter.companyId },
                include: [{ model: db.Company, as: 'userCompanyData', attributes: ['name'], required: true, where: { statusCode: 'S1', censorCode: 'CS1' } }] },
            { model: db.DetailPost, as: 'postDetailData', required: true, attributes: ['name', 'descriptionHTML', 'descriptionMarkdown'],
                ...(data.search ? { where: literal(`LOCATE(${db.sequelize.escape(data.search)}, \`postDetailData\`.name) > 0`) } : {}),
                include: [['salaryTypePostData', 'salary'], ['expTypePostData', 'experience'], ['provincePostData', 'location'], ['workTypePostData', 'workType']]
                    .map(([as]) => ({ model: db.Allcode, as, attributes: ['value'] })) },
        ], order: [['id', 'DESC']], limit, offset, distinct: true, raw: true, nest: true });
    return { errCode: 0, data: result.rows.map(jobSnapshot), count: result.count };
};

export const prepareChatMedia = async (senderId, receiverId, data) => {
    if (!data.attachmentId && !data.jobPostId) return { errCode: 0, values: {} };
    if (!await richRelationship(senderId, receiverId)) return error('Chỉ cuộc trò chuyện tuyển dụng mới hỗ trợ tài liệu và tin công việc.', 403);
    if (data.attachmentId) {
        const file = await db.ChatAttachment.findOne({ where: { id: data.attachmentId, senderId, receiverId }, raw: true });
        if (!file) return error('Tài liệu không thuộc người gửi và cuộc trò chuyện này.', 403);
        return { errCode: 0, values: { attachmentId: file.id } };
    }
    const jobs = await listChatJobs(senderId, { partnerId: receiverId, jobPostId: data.jobPostId });
    if (jobs.errCode !== 0) return jobs;
    const job = jobs.data.find(item => item.id === Number(data.jobPostId));
    if (!job) return error('Tin không còn công khai, đã hết hạn hoặc không thuộc công ty trong cuộc trò chuyện.', 403);
    return { errCode: 0, values: { jobPostId: job.id, jobSnapshot: job } };
};
