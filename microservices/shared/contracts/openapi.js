import { operations, publicPath } from './operations.js';
import { responseDefinitions, successSchema } from './responses.js';
import { ROLE_PERMISSIONS } from '../accessControl.js';

export const contractVersion = '1.0.0';
export const serviceNames = ['jobs', 'identity', 'search', 'applications', 'admin'];
const toOpenApi = (schema) => JSON.parse(JSON.stringify(schema).replaceAll('#/$defs/', '#/components/schemas/'));
const json = (schema) => ({ 'application/json': { schema: toOpenApi(schema) } });
const path = (value) => value.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const header = (description) => ({ description, schema: { type: 'string' } });
const error = { description: 'Request rejected or dependency unavailable. errCode is application-specific; inspect HTTP status first.', content: json({ $ref: '#/$defs/Error' }) };

export const buildOpenApi = (service = 'gateway') => {
    if (service !== 'gateway' && !serviceNames.includes(service)) throw new Error(`Unknown service: ${service}`);
    const publicApi = service === 'gateway';
    const selected = operations.filter((op) => publicApi ? !op.internal : op.service === service);
    const paths = {};
    for (const op of selected) {
        const parameters = ['params', 'query', 'headers'].flatMap((kind) => Object.entries(op[kind].properties).map(([name, schema]) => ({
            name, in: { params: 'path', query: 'query', headers: 'header' }[kind],
            required: kind === 'params' || op[kind].required.includes(name), schema: toOpenApi(schema),
            ...(name === 'idempotency-key' && { description: `${op.idempotencyRequired ? 'Required' : 'Optional'}. Same user + key + canonical input returns the original accepted result; changed input or operation returns 409. Reuse for retries; a new key requests new work.` })
        })));
        if (publicApi) parameters.push({ name: 'X-Correlation-ID', in: 'header', required: false, schema: { type: 'string', maxLength: 128 }, description: 'Invalid/missing values are replaced by the gateway. Not an authentication token.' });
        if (!publicApi && op.permission) {
            parameters.push(
                { name: 'x-user-id', in: 'header', required: true, schema: { type: 'string', pattern: '^[1-9][0-9]*$' }, description: 'Authenticated identity forwarded by the trusted gateway only.' },
                { name: 'x-user-role', in: 'header', required: true, schema: { type: 'string', enum: Object.keys(ROLE_PERMISSIONS).filter((role) => ROLE_PERMISSIONS[role].includes(op.permission)) } }
            );
            if (op.companyRequired) parameters.push(...[
                ['x-company-id', { type: 'string', pattern: '^[1-9][0-9]*$' }],
                ['x-company-status', { const: 'S1' }], ['x-company-censor', { const: 'CS1' }]
            ].map(([name, schema]) => ({ name, in: 'header', required: false, schema, description: 'Required for non-admin callers; derived from the current account/company store by the gateway.' })));
        }
        const responses = { [op.status]: {
            description: op.status === 202 ? 'Durably accepted; poll aiTaskGet. Does not mean the AI job has completed.' : 'Successful response',
            headers: { 'X-Correlation-ID': header('Request correlation identifier') }, content: json(successSchema(op))
        }, ...Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 429, 500, 502, 503, 504].map((status) => [status, error])) };
        (paths[path(publicApi ? publicPath(op) : op.path)] ||= {})[op.method] = {
            operationId: op.id, tags: [op.service],
            summary: `${op.method.toUpperCase()} ${op.path}`,
            description: [
                op.internal ? 'Service-to-service only. Never exposed through the public gateway.' : 'Modern microservice endpoint; legacy fallback routes are outside this contract.',
                op.permission ? `Requires permission ${op.permission}; resource ownership checks still apply.` : 'No end-user login required.',
                op.companyRequired ? 'Non-admin callers must belong to an active, approved company.' : '',
                ['jobCreate', 'jobRepost'].includes(op.id) ? 'Paid posting requires a current active, approved company even for ADMIN. With an Idempotency-Key, quota, new post, events and original response are committed atomically. Replay returns the initial 201 snapshot, not current moderation state, and rechecks current company membership/approval without spending quota. Keys must not be deleted while retries are possible. A new deadline must be in the future; omitted create deadline defaults to 30 days on the first accepted attempt.' : '',
                op.id === 'jobRepost' ? 'Only expired, non-removed source posts in the caller company may be reposted. Copies the current detail into a new PS3 post, retaining the source featured flag and charging the matching quota. Original post is unchanged; new post requires moderation. Replays do not reread mutable source content.' : '',
                op.id === 'jobManageGet' ? 'Private current job read, including PS1/PS2/PS3/PS4. Non-admin access is restricted to the current approved company, rechecked with the job in one database statement; out-of-scope and missing IDs both return 404. ADMIN may inspect other companies. Returns raw classification codes, not Allcode labels or AI internals. PS3 means awaiting review, not proof a worker is processing. Cache-Control: private, no-store. Does not change the public jobGet visibility policy.' : '',
                op.searchWindow ? 'offset + effective limit must not exceed 10000; limit=0 uses the default of 12.' : '',
                Object.hasOwn(op.query.properties, 'fromDate') ? 'fromDate must not be after toDate. Accepts an ISO date or timestamp.' : ''
            ].filter(Boolean).join(' '),
            'x-jobfind-permission': op.permission,
            'x-jobfind-internal': Boolean(op.internal),
            'x-jobfind-company-required': Boolean(op.companyRequired),
            'x-jobfind-reject-unknown-query': true,
            security: publicApi ? (op.permission ? [{ bearerAuth: [] }] : []) : [{ internalSecret: [] }],
            parameters,
            ...(op.body && { requestBody: { required: !op.bodyOptional, content: json({ $ref: `#/$defs/${op.body}` }) } }),
            responses
        };
    }
    return {
        openapi: '3.1.1', jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
        info: { title: `JobFind ${service} HTTP API`, version: contractVersion,
            description: 'Generated from executable request contracts. JSON only; unknown fields and invalid types are rejected, never silently coerced or removed. Response extensions remain allowed for the legacy migration. Operational endpoints, Socket.IO and legacy /api/* routes are documented separately in docs/http-contracts.md.' },
        servers: [{ url: publicApi ? 'http://localhost:4000' : '/', description: publicApi ? 'Local Docker Compose gateway' : 'Direct service origin in the private Compose network; do not publish publicly' }],
        tags: [...new Set(selected.map((op) => op.service))].map((name) => ({ name })),
        paths,
        components: { securitySchemes: publicApi ? { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } : {
            internalSecret: { type: 'apiKey', in: 'header', name: 'x-internal-secret', description: 'Private service credential. User context is supplied by the trusted gateway via x-user-id, x-user-role and x-company-id; never trust client-supplied identity headers.' }
        }, schemas: toOpenApi(responseDefinitions) }
    };
};
