import { createAiRequestOptions, matchCvPdfAi, getAiTask } from './aiSearchService';
import { resolvePdfSource } from '../components/documents/documentSource';
import { fingerprint, validateAiResult } from './candidateWorkspace';
import { pollAiTask } from './aiTaskPolling';

const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && /^[1-9][0-9]*$/.test(String(value));
const taskPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
export const recruiterIntentKey = (userId, candidateId) => `jobfind.recruiter.ai.v1.${userId}.${candidateId}`;
const validIntent = value => value?.version === 1 && validId(value.jobId)
    && /^[a-f0-9]{32}$/.test(value.key) && /^[a-f0-9]{64}$/.test(value.digest)
    && (value.taskId === null || (typeof value.taskId === 'string' && taskPattern.test(value.taskId)));

export const readRecruiterIntent = key => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('Mã phân tích đã lưu bị hỏng. Không thể tự gửi yêu cầu thay thế.'); }
    if (!validIntent(value)) throw new Error('Mã phân tích đã lưu không hợp lệ. Không thể tự gửi yêu cầu thay thế.');
    return value;
};
export const saveRecruiterIntent = (key, value) => {
    if (!validIntent(value)) throw new Error('Không lưu được mã phân tích.');
    const previous = readRecruiterIntent(key);
    if (previous && previous.key !== value.key) throw new Error('Một yêu cầu phân tích khác đang được giữ. Hãy kiểm tra kết quả trước.');
    // Persist only recovery metadata; never store PDF bytes, text or AI results.
    sessionStorage.setItem(key, JSON.stringify({ version: 1, key: value.key, digest: value.digest, jobId: value.jobId, taskId: value.taskId }));
};
export const clearRecruiterIntent = (key, requestKey) => {
    if (readRecruiterIntent(key)?.key !== requestKey) throw new Error('Yêu cầu phân tích đang giữ đã thay đổi.');
    sessionStorage.removeItem(key);
};

const readBase64 = (blob, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Đã dừng tải CV.', 'AbortError')); return; }
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Không đọc được nội dung CV.'));
    reader.onabort = () => reject(new DOMException('Đã dừng tải CV.', 'AbortError'));
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    reader.readAsDataURL(blob);
});

export const prepareRecruiterReview = async (source, jobId, storageKey, signal) => {
    if (!validId(jobId)) throw new Error('Hãy chọn tin tuyển dụng của công ty để phân tích.');
    const blob = await resolvePdfSource(source, { signal });
    if (blob.size > 5 * 1024 * 1024) throw new Error('AI hỗ trợ CV PDF không quá 5 MiB. Hãy dùng tệp nhỏ hơn.');
    const payload = { fileBase64: await readBase64(blob, signal), jobId: Number(jobId) };
    const digest = await fingerprint('match_cv_pdf', payload);
    const previous = readRecruiterIntent(storageKey);
    if (previous && (previous.taskId || previous.digest !== digest || previous.jobId !== payload.jobId)) {
        throw new Error('CV hoặc tin tuyển dụng đã thay đổi so với yêu cầu đang giữ. Không thể tự gửi một yêu cầu AI khác.');
    }
    const intent = previous || { version: 1, key: createAiRequestOptions().idempotencyKey, digest, jobId: payload.jobId, taskId: null };
    return { payload, intent };
};

export const submitRecruiterReview = (payload, intent, signal) =>
    matchCvPdfAi(payload.fileBase64, payload.jobId, { idempotencyKey: intent.key, signal });

export const acceptRecruiterReview = (response, intent) => {
    if (response?.errCode !== 0 || response.httpStatus >= 400 || typeof response.taskId !== 'string' || !taskPattern.test(response.taskId)) {
        throw new Error(response?.errMessage || 'Chưa xác nhận được yêu cầu AI. Thử đối chiếu lại bằng cùng mã yêu cầu.');
    }
    return { ...intent, taskId: response.taskId };
};

export const waitRecruiterReview = async (intent, signal, onComplete) => {
    const result = await pollAiTask(async (id, options) => {
        const response = await getAiTask(id, options);
        if (response?.errCode === 0 && (response.data?.id !== intent.taskId || response.data?.type !== 'match_cv')) {
            return { errCode: 400, httpStatus: 400, errMessage: 'Kết quả không thuộc yêu cầu phân tích đang xem.' };
        }
        return response;
    }, intent.taskId, { signal });
    onComplete();
    return validateAiResult('match_cv', result);
};
