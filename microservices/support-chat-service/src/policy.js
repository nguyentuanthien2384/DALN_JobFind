import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const failure = (status, message) => Object.assign(new Error(message), { status });
export const uuid = (value) => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
export const redact = (text = '') => String(text).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]')
    .replace(/\b(?:\+?84|0)(?:[ .-]?\d){9,10}\b/g, '[số điện thoại đã ẩn]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|eyJ[a-zA-Z0-9_.-]{25,})\b/g, '[khóa đã ẩn]');

// Guest capability expires, is signed, and only its hash is stored in MySQL.
export function guestIdentity(token, secret, now = Date.now()) {
    if (!secret) throw failure(503, 'Dịch vụ chưa được cấu hình.');
    const valid = typeof token === 'string' && /^\d{13}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token);
    if (valid) {
        const [stamp, nonce, signature] = token.split('.');
        const expected = createHmac('sha256', secret).update(`${stamp}.${nonce}`).digest('hex');
        if (Number(stamp) > now || now - Number(stamp) > 30 * 86400000 || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
            throw failure(401, 'Phiên hỗ trợ đã hết hạn. Hãy mở một phiên mới.');
    } else if (token) throw failure(401, 'Phiên hỗ trợ không hợp lệ.');
    else {
        const body = `${now}.${randomBytes(32).toString('hex')}`;
        token = `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
    }
    return { token, owner: `guest:${createHash('sha256').update(token).digest('hex')}` };
}

export function validateTurn(body) {
    if (!body || !uuid(body.requestId) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1400)
        throw failure(400, 'Câu hỏi không hợp lệ hoặc vượt quá 1.400 ký tự.');
    for (const key of ['conversationId', 'replaceFrom', 'parentId']) if (body[key] != null && !uuid(body[key])) throw failure(400, 'Mã hội thoại không hợp lệ.');
    if (body.conversationId && (!Number.isSafeInteger(body.version) || body.version < 0)) throw failure(400, 'Thiếu phiên bản hội thoại.');
    return { ...body, text: redact(body.text.trim()) };
}

// Compatibility for callers of the earlier stateless /api/support-chat API.
// History is supplied by the client, so keep it bounded and strip sensitive
// credentials before any text reaches a provider.
export function validateLegacyMessages(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 12)
        throw failure(400, 'Cuộc trò chuyện phải có từ 1 đến 12 tin nhắn.');
    let total = 0;
    const messages = input.map(message => {
        if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string')
            throw failure(400, 'Định dạng tin nhắn không hợp lệ.');
        const text = message.text.trim();
        if (!text || text.length > (message.role === 'user' ? 1400 : 12000))
            throw failure(400, 'Tin nhắn vượt quá giới hạn độ dài.');
        total += text.length;
        return { role: message.role, text: redact(text), status: 'complete' };
    });
    if (total > 8500 || messages[0].role !== 'user' || messages.at(-1).role !== 'user'
        || messages.some((message, index) => index > 0 && message.role === messages[index - 1].role))
        throw failure(400, 'Thứ tự hoặc độ dài cuộc trò chuyện không hợp lệ.');
    return messages;
}
