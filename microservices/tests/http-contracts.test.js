import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { operations, operationById, publicPath } from '../shared/contracts/operations.js';
import { buildOpenApi, serviceNames } from '../shared/contracts/openapi.js';
import { responseDefinitions, responseValidationSchema } from '../shared/contracts/responses.js';
import { contractRoute, validateRequest, createContractValidator, rejectUnknownModernRoute } from '../shared/requestContract.js';
import { requireTrustedGateway, requireServicePermission } from '../shared/accessControl.js';
import { jsonBodies, safeHttpError } from '../shared/httpBoundary.js';

const frontendHttp = vi.hoisted(() => Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [method, vi.fn(() => Promise.resolve({ errCode: 0 }))])));
vi.mock('../../frontend/src/axios.js', () => ({ default: frontendHttp }));
import * as aiClient from '../../frontend/src/service/aiSearchService.js';
import * as applicationClient from '../../frontend/src/service/applicationService.js';
import * as adminClient from '../../frontend/src/service/adminReportService.js';

const cvId = '507f1f77bcf86cd799439011';
const bodyExamples = {
    JobCreate: { name: 'Lập trình viên', descriptionHTML: '<p>Phát triển ứng dụng</p>', categoryJobCode: 'IT', amount: '2' },
    JobUpdate: { name: 'Developer', amount: '2', genderPostCode: 'G1', timeEnd: '1700000000000' },
    ParseResume: { fileBase64: 'c3ludGhldGljIENW', fileName: 'cv.pdf' },
    MatchCv: { resumeText: 'Kỹ sư phần mềm', jobId: '1' },
    CoverLetter: { resumeText: 'Kỹ sư phần mềm', jobId: 1, language: 'vi' },
    ProfileUpdate: { headline: 'Engineer', skills: ['JS'], jobPreference: { isFindJob: true, addressCode: 'HN' } },
    CvCreate: { fullName: 'Lan', skills: ['Node'], experiences: [{ company: 'Example', from: '2020', to: null }], educations: [{ school: 'Example', year: '2020' }] },
    CvUpdate: { title: 'CV mới' },
    CvImport: { parsed: { fullName: 'Lan', yearsOfExperience: 3, experiences: [{ company: 'Example', duration: '2020–2023' }], skills: ['JS'] }, fileName: 'cv.pdf' },
    MoveStage: { stage: 'phong_van', reason: 'Hẹn phỏng vấn' },
    Decision: { decision: 'accepted', message: 'Chúc mừng' },
    Rating: { rating: '5' }, Note: { body: 'Ghi chú' },
    TalentSave: { candidateId: 7, candidateName: 'Lan', note: 'Từ hồ sơ ứng tuyển' },
    TagSave: { type: 'JOBTYPE', code: 'IT', aliases: ['software'], weight: 2, isActive: true },
    AuditAction: { method: 'POST', route: '/api/jobs', actorId: 7, actorRole: 'COMPANY', companyId: 3, status: 201, durationMs: 12, correlationId: 'test-1' },
    Empty: {}
};
const servers = [];
const origins = {};
const hits = Object.fromEntries(operations.map((op) => [op.id, vi.fn((req, res) => res.status(op.status).json({ operationId: op.id, body: req.body, query: req.query, params: req.params }))]));
const trusted = { 'x-internal-secret': 'http-contract-test-secret', 'x-user-id': '7', 'x-user-role': 'ADMIN' };
const listen = async (app) => {
    const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
};
const pathFor = (op) => op.path.replace(/:cvId\b/g, cvId).replace(/:taskId\b/g, 'task-1').replace(/:type\b/g, 'job').replace(/:candidateId\b/g, '7').replace(/:id\b/g, op.id === 'masterDelete' ? cvId : '1');
const send = (id, { body, raw, query = '', path, headers = {}, omitIdentity = false, ...options } = {}) => {
    const op = operationById[id];
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    return fetch(origins[op.service] + (path || pathFor(op)) + query, {
        method: op.method.toUpperCase(), headers: { ...(omitIdentity ? {} : trusted), ...(payload !== undefined && { 'content-type': 'application/json' }), ...headers },
        ...(payload !== undefined && { body: payload }), ...options
    });
};

beforeAll(async () => {
    vi.stubEnv('INTERNAL_SECRET', trusted['x-internal-secret']);
    for (const service of serviceNames) {
        const app = express();
        app.use(jsonBodies(express));
        app.use(requireTrustedGateway);
        for (const op of operations.filter((item) => item.service === service)) {
            const guards = op.permission ? [requireServicePermission(op.permission, { companyRequired: op.companyRequired })] : [];
            contractRoute(app, op.id, ...guards, hits[op.id]);
        }
        app.use(safeHttpError);
        origins[service] = await listen(app);
    }
    const gateway = express();
    gateway.use(rejectUnknownModernRoute);
    gateway.use((req, res) => res.json({ passed: true }));
    origins.gateway = await listen(gateway);
});
afterEach(() => Object.values(hits).forEach((hit) => hit.mockClear()));
afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    vi.unstubAllEnvs();
});

describe('real HTTP request contracts', () => {
    it.each([
        ['searchJobs', aiClient.searchJobs, [{ q: 'Node', limit: 12, offset: 0, isHot: false, categoryJobCode: 'IT' }]],
        ['searchRelated', aiClient.getRelatedJobs, [7]],
        ['profileUpdate', aiClient.updateMyProfile, [{ headline: 'Engineer', jobPreference: { isTakeMail: true } }]],
        ['cvCreate', aiClient.createMyCv, [bodyExamples.CvCreate]],
        ['cvUpdate', aiClient.updateMyCv, [cvId, bodyExamples.CvUpdate]],
        ['cvImport', aiClient.importParsedCv, [bodyExamples.CvImport.parsed, 'cv.pdf']],
        ['aiParseResume', aiClient.parseResumeAi, ['c3ludGhldGlj', 'cv.pdf']],
        ['aiMatchCv', aiClient.matchCvAi, ['Kỹ sư', 7]],
        ['aiCoverLetter', aiClient.coverLetterAi, ['Kỹ sư', 7, 'vi']],
        ['applicationList', applicationClient.getApplications, [{ jobId: 7, stage: 'phong_van', minRating: 3, limit: 20, offset: 0 }]],
        ['applicationMove', applicationClient.moveApplicationStage, [7, 'phong_van', 'Hẹn phỏng vấn']],
        ['applicationDecision', applicationClient.sendApplicationDecision, [7, 'accepted', 'Chúc mừng']],
        ['talentSave', applicationClient.saveToTalentPool, [bodyExamples.TalentSave]],
        ['reportOverview', adminClient.getOverview, [{ fromDate: '2026-01-01', toDate: '2026-02-01' }]],
        ['auditList', adminClient.getAuditLogs, [{ limit: 15 }]],
        ['masterSave', adminClient.saveMasterDataTag, [bodyExamples.TagSave]]
    ])('%s accepts requests serialized by the actual frontend helper', async (id, call, args) => {
        await call(...args);
        const op = operationById[id];
        const [target, data, config] = frontendHttp[op.method].mock.calls.at(-1);
        const url = new URL(target, 'http://contract.test');
        const prefix = op.service === 'admin' ? '/api/admin' : '/api';
        const path = url.pathname.slice(prefix.length);
        const body = data === undefined ? undefined : JSON.parse(JSON.stringify(data));
        const response = await send(id, { path, query: url.search, body, headers: config?.headers || {} });
        expect(response.status, await response.clone().text()).toBe(op.status);
        expect(hits[id]).toHaveBeenCalledOnce();
    });
    it.each(operations)('$id accepts its supported payload without silently changing types', async (op) => {
        const body = op.body ? bodyExamples[op.body] : undefined;
        const response = await send(op.id, { body });
        expect(response.status, await response.clone().text()).toBe(op.status);
        expect(hits[op.id]).toHaveBeenCalledOnce();
        if (body) expect((await response.json()).body).toEqual(body);
    });

    it.each([
        ['jobGet', { path: '/jobs/1x' }], ['jobGet', { path: '/jobs/9007199254740992' }],
        ['cvDelete', { path: '/profile/cvs/not-a-mongo-id' }], ['aiTaskGet', { path: '/ai/tasks/bad%20id' }],
        ['jobCreate', { body: { ...bodyExamples.JobCreate, isHot: 'false' } }],
        ['jobCreate', { body: { ...bodyExamples.JobCreate, amount: -1 } }],
        ['jobUpdate', { body: { statusCode: 'PS1' } }], ['jobUpdate', { body: {} }],
        ['jobUpdate', { body: { isHot: 1 } }], ['jobUpdate', { body: { userId: 999 } }],
        ['jobUpdate', { body: { timeEnd: null } }], ['jobUpdate', { body: { timeEnd: '2027-01-01' } }],
        ['jobUpdate', { body: { timeEnd: -1 } }], ['jobUpdate', { body: { timeEnd: true } }],
        ['jobUpdate', { body: { genderPostCode: {} } }], ['jobUpdate', { body: { amount: 0 } }],
        ['profileUpdate', { body: { roleCode: 'ADMIN' } }],
        ['profileUpdate', { body: { jobPreference: { isFindJob: 'false' } } }],
        ['profileUpdate', { body: { skills: ['JS', { $ne: null }] } }],
        ['cvCreate', { body: { experiences: [{ company: { $gt: '' } }] } }],
        ['cvCreate', { body: { experiences: Array(101).fill({}) } }],
        ['cvImport', { body: { parsed: { experiences: [null] } } }],
        ['cvImport', { body: { parsed: ['not-an-object'] } }],
        ['aiMatchCv', { body: { resumeText: ' ', jobId: 1 } }],
        ['aiMatchCv', { body: { resumeText: 'CV', jobId: true } }],
        ['aiParseResume', { body: bodyExamples.ParseResume, headers: { 'idempotency-key': 'has spaces' } }],
        ['applicationMove', { body: { stage: 'interview' } }],
        ['applicationRating', { body: { rating: 3.5 } }], ['applicationNote', { body: { body: 'x'.repeat(5001) } }],
        ['applicationDecision', { body: { decision: 'accept' } }],
        ['talentSave', { body: { candidateId: 7, tags: 'JS' } }],
        ['masterSave', { body: { type: 'IT', aliases: [{ $where: 'bad' }] } }],
        ['auditIngest', { body: { ...bodyExamples.AuditAction, durationMs: -1 } }],
        ['searchJobs', { query: '?limit=-1' }], ['searchJobs', { query: '?limit=101' }],
        ['searchJobs', { query: '?offset=1.5' }], ['searchJobs', { query: '?limit=10&limit=20' }],
        ['searchJobs', { query: '?q[$ne]=secret' }], ['searchJobs', { query: '?limit=1e2' }],
        ['searchJobs', { query: '?offset=9990&limit=20' }], ['searchJobs', { query: '?page=2' }],
        ['searchJobs', { query: '?offset=9990&limit=0' }], ['searchJobs', { query: '?offset=9990' }],
        ['applicationList', { query: '?minRating=0' }], ['applicationBoard', { query: '?jobId=0' }],
        ['reportOverview', { query: '?fromDate=2026-02-30' }],
        ['reportOverview', { query: '?fromDate=2026-02-02&toDate=2026-02-01' }],
        ['reportOverview', { query: '?fromDate=not-a-date' }], ['auditList', { query: '?offset=-1' }],
        ['auditList', { query: '?limit=201' }]
    ])('%s rejects unsafe input before business side effects: %j', async (id, options) => {
        const response = await send(id, options);
        expect(response.status).toBe(400);
        expect((await response.json()).errCode).toBe(400);
        expect(hits[id]).not.toHaveBeenCalled();
    });

    it('retains supported search filters, pagination zero and report date formats', async () => {
        expect((await send('searchJobs', { query: '?q=Node&limit=0&offset=0&categoryJobCode=IT&isHot=false&sort=newest' })).status).toBe(200);
        expect((await send('searchJobs', { query: '?limit=1&offset=9999' })).status).toBe(200);
        expect((await send('reportTimeseries', { query: '?fromDate=2026-01-01&toDate=2026-02-01T00%3A00%3A00Z' })).status).toBe(200);
    });
    it.each(['applicationSync', 'searchReindex'])('%s accepts an empty internal POST without a Content-Type', async (id) => {
        expect((await send(id)).status).toBe(200);
        expect((await send(id, { raw: 'ignored', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
        expect(hits[id]).toHaveBeenCalledOnce();
    });
    it('rejects malformed JSON, oversized bodies and unsupported media without leaking input', async () => {
        for (const [raw, headers, status] of [
            ['{"secret-CV":', {}, 400],
            [JSON.stringify({ about: 'x'.repeat(1100000) }), {}, 413],
            ['headline=Engineer', { 'content-type': 'application/x-www-form-urlencoded' }, 415]
        ]) {
            const response = await send('profileUpdate', { raw, headers });
            expect(response.status).toBe(status);
            expect(await response.text()).not.toContain('secret-CV');
        }
        expect(hits.profileUpdate).not.toHaveBeenCalled();
    });
    it('checks trust and role/company permissions before schema validation', async () => {
        expect((await send('jobCreate', { body: {}, omitIdentity: true })).status).toBe(403);
        expect((await send('jobCreate', { body: {}, headers: { 'x-user-role': 'CANDIDATE' } })).status).toBe(403);
        expect((await send('jobCreate', { body: {}, headers: { 'x-user-role': 'COMPANY', 'x-company-id': '3' } })).status).toBe(403);
        expect((await send('auditList', { query: '?limit=-1', headers: { 'x-user-role': 'CANDIDATE' } })).status).toBe(403);
        expect(hits.jobCreate).not.toHaveBeenCalled();
        expect(hits.auditList).not.toHaveBeenCalled();
    });
    it('forwards rejected async controllers to the safe Express 4 error boundary', async () => {
        hits.profileGet.mockRejectedValueOnce(new Error('SQL and private CV details'));
        const response = await send('profileGet');
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ errCode: 500, errMessage: 'Internal server error' });
    });
});

describe('versioned OpenAPI and route coverage', () => {
    it.each(['gateway', ...serviceNames])('%s generated file is current with valid response refs', async (service) => {
        const document = buildOpenApi(service);
        const stored = JSON.parse(await readFile(new URL(`../contracts/http/${service}.openapi.json`, import.meta.url), 'utf8'));
        expect(stored).toEqual(document);
        expect(document.openapi).toBe('3.1.1');
        const ids = Object.values(document.paths).flatMap((methods) => Object.values(methods).map((op) => op.operationId));
        expect(ids).toHaveLength(new Set(ids).size);
        for (const ref of JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) expect(document.components.schemas).toHaveProperty(ref[1]);
    });
    it('binds every business route in each real service to exactly one contract', async () => {
        const files = { jobs: 'job-core-service', identity: 'identity-service', search: 'search-service', applications: 'application-service', admin: 'admin-service' };
        for (const [service, folder] of Object.entries(files)) {
            const source = await readFile(new URL(`../${folder}/src/app.js`, import.meta.url), 'utf8');
            const registered = [...source.matchAll(/contractRoute\(app, '([^']+)'/g)].map((match) => match[1]);
            expect(registered.sort()).toEqual(operations.filter((op) => op.service === service).map((op) => op.id).sort());
            expect(source).not.toMatch(/app\.(get|post|put|patch|delete)\(/);
            expect(source.indexOf('app.use(requireTrustedGateway)')).toBeLessThan(source.indexOf('contractRoute(app,'));
            expect(source).toContain('app.use(safeHttpError)');
        }
    });
    it('compiles every request and response and never publishes an untyped Record response', () => {
        for (const op of operations) {
            expect(validateRequest(op.id)).toBeTypeOf('function');
            expect(createContractValidator().compile(responseValidationSchema(op))).toBeTypeOf('function');
            const schema = buildOpenApi(op.internal ? op.service : 'gateway').paths[(op.internal ? op.path : publicPath(op)).replace(/:([A-Za-z0-9_]+)/g, '{$1}')][op.method].responses[op.status];
            expect(JSON.stringify(schema)).not.toContain('/schemas/Record');
        }
        expect(() => validateRequest('typo')).toThrow('Unknown');
    });
    it('keeps private service credentials and endpoints out of the gateway spec', () => {
        const document = buildOpenApi();
        expect(JSON.stringify(document.paths)).not.toContain('/internal/');
        expect(document.components.securitySchemes).not.toHaveProperty('internalSecret');
        expect(document.paths['/api/admin/audit'].get.security).toEqual([{ bearerAuth: [] }]);
        expect(document.paths['/api/search/jobs'].get.security).toEqual([]);
        expect(Object.keys(document.paths).length).toBeGreaterThan(25);
    });
    it.each([
        ['GET', '/api/jobs', 404], ['POST', '/api/jobs/1', 404], ['PATCH', '/api/profile', 404],
        ['GET', '/api/admin/internal/alias-map', 404], ['POST', '/api/ai/tasks/t1', 404],
        ['GET', '/api/search/not-a-route', 404], ['DELETE', '/api/applications/stages', 404],
        ['GET', '/api/get-all-post', 200], ['POST', '/api/login', 200], ['GET', '/socket.io/', 200],
        ['HEAD', '/api/jobs/1', 200], ['GET', '/API/SEARCH/JOBS/', 200]
    ])('gateway %s %s does not accidentally fall through to legacy', async (method, path, status) => {
        expect((await fetch(origins.gateway + path, { method })).status).toBe(status);
    });
    it('validates serialized Mongoose/SQL payloads and rejects a broken success envelope', () => {
        const ajv = createContractValidator();
        const profile = ajv.compile(responseValidationSchema(operationById.profileGet));
        expect(profile({ errCode: 0, data: { legacyUserId: 7, companyId: null, cvs: [{ _id: cvId, skills: ['JS'], createdAt: '2026-09-05T00:00:00.000Z' }] } })).toBe(true);
        expect(profile({ errCode: 0, data: { legacyUserId: 7, cvs: [{ _id: 'bad' }] } })).toBe(false);
        const task = ajv.compile(responseValidationSchema(operationById.aiTaskGet));
        expect(task({ errCode: 0, data: { id: 'task-1', type: 'parse_resume', status: 'pending', result: null, error: null, createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' } })).toBe(true);
        expect(task({ errCode: 0, taskId: 'wrong-envelope' })).toBe(false);
        expect(responseDefinitions.Cv.additionalProperties).toBe(true);
    });
});
