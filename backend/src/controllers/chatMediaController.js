import { uploadChatAttachment, readChatAttachment, listChatJobs } from '../services/chatMediaService';

const respond = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    try {
        const result = await handler(req);
        return res.status(result.httpStatus || 200).json(result);
    } catch {
        return res.status(503).json({ errCode: -1, errMessage: 'Chưa xử lý được tài liệu hoặc tin tuyển dụng. Vui lòng thử lại.' });
    }
};
export const upload = respond(req => uploadChatAttachment(req.user.id, req.body ?? {}));
export const read = respond(req => readChatAttachment(req.user.id, req.params?.id));
export const jobs = respond(req => listChatJobs(req.user.id, req.query ?? {}));
