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
export const repostJob = (sourceId, timeEnd, options) => {
    if (!/^[1-9][0-9]*$/.test(String(sourceId)) || !Number.isSafeInteger(Number(sourceId))) {
        return Promise.reject(new Error('Mã tin nguồn không hợp lệ'));
    }
    return postJob(`/api/jobs/${sourceId}/repost`, { timeEnd }, options);
};
