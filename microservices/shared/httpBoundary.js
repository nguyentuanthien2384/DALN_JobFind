// Explicit payload budgets; keep large legacy upload routes compatible during migration.
const uploadPaths = new Set([
    '/api/create-new-cv', '/api/update-user', '/api/create-new-user',
    '/api/create-new-company', '/api/update-company'
]);
export const bodyBudget = (path) => {
    const normalized = String(path).toLowerCase().replace(/\/+$/, '');
    if (['/api/ai/parse-resume', '/ai/parse-resume'].includes(normalized)) return '12mb';
    if (uploadPaths.has(normalized)) return '50mb';
    return '1mb';
};

export const requestBodies = (express) => {
    const parsers = Object.fromEntries(['1mb', '12mb', '50mb'].map((limit) => [limit, [
        express.json({ limit }), express.urlencoded({ extended: false, limit, parameterLimit: 1000 })
    ]]));
    return (req, res, next) => {
        const [json, form] = parsers[bodyBudget(req.path)];
        json(req, res, (error) => error ? next(error) : form(req, res, next));
    };
};

export const jsonBodies = (express) => {
    const parsers = { '1mb': express.json({ limit: '1mb' }), '12mb': express.json({ limit: '12mb' }) };
    return (req, res, next) => (parsers[bodyBudget(req.path)] || parsers['1mb'])(req, res, next);
};

export const safeHttpError = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status === 413 || err.type === 'entity.too.large' ? 413 : err.status === 400 ? 400 : err.status === 415 ? 415 : 500;
    res.status(status).json({ errCode: status, errMessage: {
        400: 'Invalid request body', 413: 'Request body too large', 415: 'Unsupported content encoding', 500: 'Internal server error'
    }[status] });
};
