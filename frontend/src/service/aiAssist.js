import { createAiRequestOptions, getAiTask } from './aiSearchService';
import { pollAiTask } from './aiTaskPolling';
import { validateAiResult } from './candidateWorkspace';

// Ban nhap AI ngan (loi gioi thieu, loi nhan email, goi y chat) va cham CV da nop.
// Mot lan bam = mot Idempotency-Key: gui lai do loi mang dung lai cung khoa nen
// may chu khong tao them tac vu AI co tinh phi. Ket qua chi hien de nguoi dung
// sua; khong luu vao bo nho trinh duyet va khong tu gui di dau.

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const transient = response => [408, 429, 500, 502, 503, 504].includes(response?.httpStatus)
    || ['network', 'timeout', 'unavailable'].includes(response?.errorType);
const cancelled = () => Object.assign(new Error('Đã dừng yêu cầu AI.'), { code: 'AI_POLL_CANCELLED' });
const pause = (ms, signal) => new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
});

// submit(options) must call one aiSearchService helper with the given options.
export const submitAiTask = async (submit, { signal, attempts = 3 } = {}) => {
    const options = { ...createAiRequestOptions(), ...(signal && { signal }) };
    let response;
    for (let attempt = 1; ; attempt += 1) {
        try { response = await submit(options); } catch (error) { response = { errorType: error?.code === 'ERR_CANCELED' ? 'cancelled' : 'network' }; }
        if (signal?.aborted) throw cancelled();
        if (response?.errCode === 0 && !(response.httpStatus >= 400)) break;
        if (!transient(response) || attempt >= attempts) {
            throw Object.assign(new Error(response?.errMessage || 'Chưa gửi được yêu cầu AI. Vui lòng thử lại.'),
                { code: 'AI_SUBMIT_FAILED', httpStatus: response?.httpStatus });
        }
        await pause(1000 * attempt, signal);
    }
    if (typeof response.taskId !== 'string' || !TASK_ID.test(response.taskId)) throw new Error('Máy chủ trả mã tác vụ AI không hợp lệ.');
    return response.taskId;
};

export const waitAiTask = (taskId, type, { signal, timeoutMs = 180000 } = {}) => pollAiTask(async (id, options) => {
    const response = await getAiTask(id, options);
    if (response?.errCode === 0 && (response.data?.id !== taskId || response.data?.type !== type)) {
        return { errCode: 400, httpStatus: 400, errMessage: 'Kết quả không thuộc yêu cầu AI đang chờ.' };
    }
    return response;
}, taskId, { signal, timeoutMs });

export const validateSuggestions = (result, maxLength) => {
    const items = Array.isArray(result?.suggestions) ? result.suggestions : [];
    const suggestions = items.filter(item => typeof item === 'string' && item.trim() && Array.from(item).length <= maxLength).map(item => item.trim());
    if (!suggestions.length) throw new Error('AI chưa trả về bản nháp hợp lệ. Vui lòng thử lại.');
    return suggestions;
};

// Submit, wait and validate in one call for short drafts.
export const requestAiDraft = async (submit, maxLength, options) => {
    const taskId = await submitAiTask(submit, options);
    return validateSuggestions(await waitAiTask(taskId, 'write_assist', options), maxLength);
};

// The model's own verdict wins; score bands are only a fallback for results without one.
const VERDICTS = {
    rat_phu_hop: ['Rất phù hợp', 'high'], phu_hop: ['Phù hợp', 'good'],
    can_can_nhac: ['Cần cân nhắc', 'mid'], chua_phu_hop: ['Chưa phù hợp', 'low']
};
export const verdictInfo = ({ score, verdict }) => VERDICTS[verdict]
    || (score >= 80 ? VERDICTS.rat_phu_hop : score >= 65 ? VERDICTS.phu_hop : score >= 45 ? VERDICTS.can_can_nhac : VERDICTS.chua_phu_hop);

export const validateScreening = result => ({
    ...validateAiResult('match_cv', result),
    verdict: Object.hasOwn(VERDICTS, result?.verdict) ? result.verdict : null
});

export const aiErrorMessage = error => error?.code === 'AI_POLL_CANCELLED'
    ? 'Đã dừng chờ AI.'
    : error?.message || 'AI chưa xử lý được yêu cầu. Vui lòng thử lại.';

// Recent text-only chat history for the assistant, oldest first.
export const chatHistoryForAi = (messages, userId, limit = 12) => (messages || [])
    .filter(item => typeof item?.content === 'string' && item.content.trim())
    .slice(-limit)
    .map(item => ({ from: Number(item.senderId) === Number(userId) ? 'me' : 'partner', text: item.content.trim().slice(0, 2000) }));
