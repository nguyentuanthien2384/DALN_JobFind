/* global globalThis */
import axios from '../axios';

// Prepare once BEFORE sending, retain with an immutable payload for every retry.
// No automatic POST retries and no fallback to the non-idempotent legacy writer.
export const createJobRequestOptions = () => {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Trình duyệt chưa hỗ trợ tạo mã yêu cầu an toàn');
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Object.freeze({ idempotencyKey: Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('') });
};

const postJob = async (path, body, options) => {
    const key = options?.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
        throw new Error('Cần tạo và giữ mã thao tác trước khi đăng tin');
    }
    try {
        const result = await axios.post(path, body, {
            headers: { 'Idempotency-Key': key }, timeout: 15000,
            ...(options.signal && { signal: options.signal })
        });
        return { ...result, idempotencyKey: key };
    } catch (error) {
        error.idempotencyKey = key;
        throw error;
    }
};

export const createJob = (body, options) => postJob('/api/jobs', body, options);
const validJobId = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
export const getManagedJob = (id, options = {}) => {
    if (!validJobId(id)) return Promise.reject(new Error('Mã tin không hợp lệ'));
    return axios.get(`/api/jobs/${id}/manage`, { timeout: 15000, ...(options.signal && { signal: options.signal }) });
};
export const updateJob = (id, patch, options = {}) => {
    if (!validJobId(id)) return Promise.reject(new Error('Mã tin không hợp lệ'));
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) {
        return Promise.reject(new Error('Không có thay đổi để gửi'));
    }
    return axios.put(`/api/jobs/${id}`, patch, { timeout: 15000, ...(options.signal && { signal: options.signal }) });
};
export const repostJob = (sourceId, timeEnd, options) => {
    if (!validJobId(sourceId)) {
        return Promise.reject(new Error('Mã tin nguồn không hợp lệ'));
    }
    return postJob(`/api/jobs/${sourceId}/repost`, { timeEnd }, options);
};
