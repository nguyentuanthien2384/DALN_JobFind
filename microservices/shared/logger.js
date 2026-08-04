// Log JSON mot dong moi ban ghi. Khi nhieu service cung do log ra stdout, dinh
// dang nay giup loc theo service/requestId bang jq hoac day thang vao Loki.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

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
    out(JSON.stringify(line));
};

export const createLogger = (service) => ({
    debug: (message, meta) => write('debug', service, message, meta),
    info: (message, meta) => write('info', service, message, meta),
    warn: (message, meta) => write('warn', service, message, meta),
    error: (message, meta) => write('error', service, message, meta)
});
