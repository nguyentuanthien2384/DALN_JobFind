const header = (headers, name) => headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()];
const text = (value) => typeof value === 'string' && value.trim() ? value.slice(0, 2000) : null;

export const readRetryAfter = (value, now = Date.now()) => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const raw = String(value).trim();
    const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - now) / 1000);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 86400) : undefined;
};

// Preserve errCode/errMessage for existing screens; add only selected metadata,
// never Axios config, request bodies, credentials, or a raw HTML response.
export const normalizeApiError = (error) => {
    const response = error?.response;
    const httpStatus = Number.isInteger(response?.status) ? response.status : 0;
    const data = response?.data && typeof response.data === 'object' && !Array.isArray(response.data) ? response.data : {};
    let errorType = 'unknown';
    if (error?.code === 'ERR_CANCELED') errorType = 'cancelled';
    else if (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code)) errorType = 'timeout';
    else if (!response) errorType = 'network';
    else if (httpStatus === 401 || (data.refresh === true && [403, 404].includes(httpStatus))) errorType = 'authentication';
    else if (httpStatus === 403) errorType = 'forbidden';
    else if (httpStatus === 404) errorType = 'not_found';
    else if (httpStatus === 409) errorType = 'conflict';
    else if (httpStatus === 429) errorType = 'rate_limit';
    else if (httpStatus >= 500) errorType = 'unavailable';
    else if (httpStatus === 408) errorType = 'timeout';
    else if ([400, 413, 415, 422].includes(httpStatus)) errorType = 'validation';
    const fallback = {
        network: 'Không kết nối được máy chủ. Vui lòng kiểm tra lại kết nối.',
        cancelled: 'Đã dừng chờ yêu cầu.', timeout: 'Yêu cầu quá thời gian chờ. Vui lòng thử lại sau.',
        authentication: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.',
        forbidden: 'Bạn không có quyền thực hiện thao tác này.',
        rate_limit: 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.',
        unavailable: 'Dịch vụ đang tạm gián đoạn. Vui lòng thử lại sau.'
    };
    const businessCode = data.errCode;
    const validCode = (typeof businessCode === 'number' && Number.isFinite(businessCode) && businessCode !== 0)
        || (typeof businessCode === 'string' && businessCode.trim() && businessCode !== '0');
    const result = { errCode: validCode ? businessCode : -1,
        errMessage: text(data.errMessage) || text(data.message) || fallback[errorType] || `Lỗi máy chủ (${httpStatus})`,
        httpStatus, errorType };
    const retryAfterSeconds = readRetryAfter(header(response?.headers, 'retry-after'));
    if (retryAfterSeconds !== undefined) result.retryAfterSeconds = retryAfterSeconds;
    const requestId = header(response?.headers, 'x-correlation-id');
    if (typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(requestId)) result.requestId = requestId;
    return result;
};

export const sentSessionToken = (config) => {
    const authorization = header(config?.headers, 'authorization');
    return typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
};

export const isLoginRequest = (config) => {
    try { return /^\/api\/login\/?$/i.test(new URL(config?.url || '', config?.baseURL || 'http://localhost').pathname); }
    catch { return false; }
};
