const TRANSIENT_CODES = new Set(['SEARCH_PROJECTION_CONFLICT', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN']);
const TRANSIENT_NAMES = new Set(['ConnectionError', 'TimeoutError', 'NoLivingConnectionsError']);

export const searchRetry = Object.freeze({
    delaysMs: Object.freeze([2000, 10000, 30000]),
    shouldRetry: (error, { metadata }) => {
        if (!metadata?.eventId) return false;
        const status = error?.meta?.statusCode ?? error?.response?.status;
        if (status !== undefined) return [429, 500, 502, 503, 504].includes(status);
        return TRANSIENT_CODES.has(error?.code) || TRANSIENT_NAMES.has(error?.name);
    }
});
