import { normalizeApiError } from './apiError';

const taskError = (code, message, taskId, details = {}) => Object.assign(new Error(message), { code, taskId, ...details });
const pause = (ms, signal) => new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
});

// Only GET is retried. Stopping or timing out does not cancel a server-side task,
// discard its ID, or create a replacement paid task.
export const pollAiTask = async (getTask, taskId, { intervalMs = 2000, timeoutMs = 120000, signal } = {}) => {
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 60000
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3600000) {
        throw taskError('AI_POLL_OPTIONS_INVALID', 'Thời gian chờ không hợp lệ', taskId);
    }
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const checkStopped = () => {
        if (timedOut || Date.now() >= deadline) throw taskError('AI_POLL_TIMEOUT', 'Quá thời gian chờ kết quả AI. Tác vụ có thể vẫn đang xử lý; hãy kiểm tra lại bằng mã tác vụ hiện tại.', taskId);
        if (controller.signal.aborted) throw taskError('AI_POLL_CANCELLED', 'Đã dừng chờ kết quả AI; tác vụ trên máy chủ không bị hủy.', taskId);
    };
    let failures = 0;
    try {
        while (true) {
            checkStopped();
            let response;
            try {
                response = await getTask(taskId, { signal: controller.signal, timeout: Math.max(1, Math.min(15000, deadline - Date.now())) });
            } catch (error) { response = normalizeApiError(error); }
            checkStopped();
            let delayMs = Math.max(250, intervalMs);
            if (response?.errCode === 0 && (!response.httpStatus || response.httpStatus < 400)) {
                failures = 0;
                if (response.data?.status === 'done' && response.data.result !== undefined) return response.data.result;
                if (response.data?.status === 'failed') throw taskError('AI_TASK_FAILED',
                    typeof response.data.error === 'string' && response.data.error ? response.data.error.slice(0, 2000) : 'Xử lý AI thất bại', taskId);
                if (response.data?.status !== 'pending') throw taskError('AI_RESPONSE_INVALID', 'Phản hồi trạng thái AI không hợp lệ', taskId);
            } else {
                const status = response?.httpStatus || (Number.isInteger(response?.errCode) && response.errCode >= 400 ? response.errCode : 0);
                const transient = [408, 429, 500, 502, 503, 504].includes(status)
                    || (!status && ['network', 'timeout', 'unavailable'].includes(response?.errorType));
                if (!transient) throw taskError('AI_POLL_REJECTED', response?.errMessage || 'Không đọc được trạng thái tác vụ AI', taskId,
                    { httpStatus: status, errorType: response?.errorType || 'unknown' });
                failures += 1;
                delayMs = Math.min(30000, Math.max(1000, intervalMs) * 2 ** Math.min(failures - 1, 5));
                if (Number.isFinite(response.retryAfterSeconds) && response.retryAfterSeconds >= 0) {
                    delayMs = Math.max(delayMs, Math.min(86400, response.retryAfterSeconds) * 1000);
                }
            }
            try { await pause(Math.min(delayMs, Math.max(0, deadline - Date.now())), controller.signal); }
            catch { checkStopped(); }
        }
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
};
