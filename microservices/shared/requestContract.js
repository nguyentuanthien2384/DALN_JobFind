import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { schemas } from './contracts/schemas.js';
import { operations, operationById, publicPath } from './contracts/operations.js';

export const createContractValidator = () => {
    const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true });
    addFormats(ajv);
    ajv.addFormat('jobfind-id', { type: 'string', validate: (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 });
    for (const max of [20, 100, 200, 10000, 1000000]) ajv.addFormat(`jobfind-uint-${max}`, {
        type: 'string', validate: (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max
    });
    return ajv;
};
const ajv = createContractValidator();
const compiled = new Map();
const checksFor = (operation) => {
    if (!compiled.has(operation.id)) compiled.set(operation.id, {
        params: ajv.compile(operation.params), query: ajv.compile(operation.query), headers: ajv.compile(operation.headers),
        ...(operation.body && { body: ajv.compile(schemas[operation.body]) })
    });
    return compiled.get(operation.id);
};

const invalid = (res, req, status = 400) => res.status(status).json({
    errCode: status,
    errMessage: status === 415 ? 'API này chỉ nhận application/json' : 'Dữ liệu yêu cầu không hợp lệ',
    ...(req.correlationId && { requestId: req.correlationId })
});

export const validateRequest = (operationId) => {
    const operation = operationById[operationId];
    if (!operation) throw new Error(`Unknown request contract: ${operationId}`);
    const checks = checksFor(operation); // Fail startup on an invalid schema, not on the first request.
    return (req, res, next) => {
        if (!checks.params(req.params || {}) || !checks.query(req.query || {}) || !checks.headers(req.headers || {})) return invalid(res, req);
        if (checks.body) {
            // Express 4 initializes req.body to {} even when there is no entity.
            const absent = req.body === undefined || (!req.headers?.['transfer-encoding'] && !Number(req.headers?.['content-length'] || 0));
            if (!(absent && operation.bodyOptional) && !req.is('application/json')) return invalid(res, req, 415);
            if (!checks.body(absent && operation.bodyOptional ? {} : req.body)) return invalid(res, req);
        }
        const q = req.query || {};
        if (q.fromDate && q.toDate && new Date(q.fromDate) > new Date(q.toDate)) return invalid(res, req);
        // Elasticsearch's default result window is shared by offset and page size.
        if (operation.searchWindow && (Number(q.offset) || 0) + (Number(q.limit) || 12) > 10000) return invalid(res, req);
        // Match existing default-on-zero behavior without changing the input object.
        return next();
    };
};

// Bind each declared contract to the actual Express route while retaining the
// service's existing permission middleware before validation and business logic.
export const contractRoute = (app, operationId, ...handlers) => {
    const operation = operationById[operationId];
    if (!operation || handlers.length === 0) throw new Error(`Invalid contract route: ${operationId}`);
    const controller = handlers.at(-1);
    // Express 4 does not forward rejected async controllers to error middleware.
    const invoke = (req, res, next) => {
        try { return Promise.resolve(controller(req, res, next)).catch(next); }
        catch (error) { return next(error); }
    };
    return app[operation.method](operation.path, ...handlers.slice(0, -1), validateRequest(operationId), invoke);
};

const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicRoutes = operations.filter((operation) => !operation.internal).map((operation) => ({
    method: operation.method.toUpperCase(),
    pattern: new RegExp(`^${publicPath(operation).split('/').map((part) => part.startsWith(':') ? '[^/]+' : escaped(part)).join('/')}\\/?$`, 'i')
}));
const modernNamespace = /^\/api\/(profile|search|jobs|applications|my-applications|talent-pool|admin|ai)(\/|$)/i;
export const rejectUnknownModernRoute = (req, res, next) => {
    if (!modernNamespace.test(req.path)) return next();
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (publicRoutes.some((route) => route.method === method && route.pattern.test(req.path))) return next();
    return res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy API' });
};
