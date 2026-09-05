// Log JSON mot dong moi ban ghi. Khi nhieu service cung do log ra stdout, dinh
// dang nay giup loc theo service/requestId bang jq hoac day thang vao Loki.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

const sensitiveKey = /^(authorization|cookie|set-cookie|password|secret|token|apiKey|accessToken|refreshToken|email|phone|phonenumber|cv|resume|file|fileBase64|body|payload|headers)$/i;
export const redactLog = (value, depth = 0, seen = new WeakSet()) => {
    if (typeof value === 'string') return value
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
        .slice(0, 4000);
    if (value === null || typeof value !== 'object') return value;
    if (depth > 5 || seen.has(value)) return '[TRUNCATED]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => redactLog(item, depth + 1, seen));
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
        key, sensitiveKey.test(key) || /secret|password|api[_-]?key/i.test(key)
            ? '[REDACTED]' : redactLog(item, depth + 1, seen)
    ]));
};

const write = (level, service, message, meta = {}) => {
    if (LEVELS[level] < threshold) return;
    const line = {
        time: new Date().toISOString(),
        level,
        service,
        message,
        ...meta
    };
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    out(JSON.stringify(redactLog(line)));
};

export const createLogger = (service) => ({
    debug: (message, meta) => write('debug', service, message, meta),
    info: (message, meta) => write('info', service, message, meta),
    warn: (message, meta) => write('warn', service, message, meta),
    error: (message, meta) => write('error', service, message, meta)
});
