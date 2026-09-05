import { schemas, object, text, idString, mongoId, taskId, eventId, queryNumber, requestKey } from './schemas.js';
import { PERMISSIONS as P } from '../accessControl.js';

// One source for transport validation, OpenAPI generation and registered route checks.
const op = (id, service, method, path, permission, options = {}) => ({
    id, service, method, path, permission, params: object(), query: object(),
    response: 'Record', status: 200, ...options
});
const jobParams = object({ id: idString }, ['id']);
const cvParams = object({ cvId: mongoId }, ['cvId']);
const company = { companyRequired: true };
export const operations = [
    op('jobCreate', 'jobs', 'post', '/jobs', P.JOB_MANAGE, { body: 'JobCreate', response: 'Job', status: 201, ...company }),
    op('jobUpdate', 'jobs', 'put', '/jobs/:id', P.JOB_MANAGE, { params: jobParams, body: 'JobUpdate', response: 'Job', ...company }),
    op('jobDelete', 'jobs', 'delete', '/jobs/:id', P.JOB_MANAGE, { params: jobParams, response: 'Ack', ...company }),
    op('jobGet', 'jobs', 'get', '/jobs/:id', null, { params: jobParams, response: 'Job' }),
    op('aiParseResume', 'jobs', 'post', '/ai/parse-resume', P.AI_CANDIDATE_USE, { body: 'ParseResume', response: 'AcceptedTask', status: 202, idempotency: true }),
    op('aiMatchCv', 'jobs', 'post', '/ai/match-cv', P.AI_CANDIDATE_USE, { body: 'MatchCv', response: 'AcceptedTask', status: 202, idempotency: true }),
    op('aiCoverLetter', 'jobs', 'post', '/ai/cover-letter', P.AI_CANDIDATE_USE, { body: 'CoverLetter', response: 'AcceptedTask', status: 202, idempotency: true }),
    op('aiTaskGet', 'jobs', 'get', '/ai/tasks/:taskId', P.AI_CANDIDATE_USE, { params: object({ taskId }, ['taskId']), response: 'Task' }),
    op('jobIndexList', 'jobs', 'get', '/internal/jobs', null, { internal: true, response: 'Job', list: true }),
    op('jobIndexGet', 'jobs', 'get', '/internal/jobs/:id', null, { internal: true, params: jobParams, response: 'Job' }),
    op('profileGet', 'identity', 'get', '/profile', P.PROFILE_SELF, { response: 'Profile' }),
    op('profileUpdate', 'identity', 'put', '/profile', P.PROFILE_SELF, { body: 'ProfileUpdate', response: 'Profile' }),
    op('cvList', 'identity', 'get', '/profile/cvs', P.CV_SELF_MANAGE, { response: 'Cv', list: true }),
    op('cvCreate', 'identity', 'post', '/profile/cvs', P.CV_SELF_MANAGE, { body: 'CvCreate', response: 'Cv', status: 201 }),
    op('cvUpdate', 'identity', 'put', '/profile/cvs/:cvId', P.CV_SELF_MANAGE, { params: cvParams, body: 'CvUpdate', response: 'Cv' }),
    op('cvDelete', 'identity', 'delete', '/profile/cvs/:cvId', P.CV_SELF_MANAGE, { params: cvParams, response: 'Ack' }),
    op('cvImport', 'identity', 'post', '/profile/cvs/import', P.CV_SELF_MANAGE, { body: 'CvImport', response: 'Cv', status: 201 }),
    op('searchJobs', 'search', 'get', '/search/jobs', null, { query: schemas.SearchQuery, list: true, searchWindow: true }),
    op('searchSuggest', 'search', 'get', '/search/suggest', null, { query: object({ q: text(500) }), list: true }),
    op('searchFacets', 'search', 'get', '/search/facets', null),
    op('searchRelated', 'search', 'get', '/search/related/:id', null, { params: jobParams, query: object({ limit: queryNumber(20) }), list: true }),
    op('searchReindex', 'search', 'post', '/internal/reindex', null, { internal: true, body: 'Empty', bodyOptional: true, rawResponse: true }),
    op('applicationStages', 'applications', 'get', '/applications/stages', P.APPLICATION_MANAGE, { list: true, ...company }),
    op('applicationBoard', 'applications', 'get', '/applications/board', P.APPLICATION_MANAGE, { query: object({ jobId: idString }), ...company }),
    op('applicationFunnel', 'applications', 'get', '/applications/funnel', P.APPLICATION_MANAGE, { query: object({ jobId: idString }), ...company }),
    op('applicationList', 'applications', 'get', '/applications', P.APPLICATION_MANAGE, { query: schemas.ApplicationQuery, response: 'Application', list: true, ...company }),
    op('applicationGet', 'applications', 'get', '/applications/:id', P.APPLICATION_MANAGE, { params: jobParams, response: 'Application', ...company }),
    op('applicationMove', 'applications', 'patch', '/applications/:id/stage', P.APPLICATION_MANAGE, { params: jobParams, body: 'MoveStage', response: 'Application', ...company }),
    op('applicationDecision', 'applications', 'post', '/applications/:id/decision-notification', P.APPLICATION_MANAGE, { params: jobParams, body: 'Decision', response: 'Application', ...company }),
    op('applicationRating', 'applications', 'patch', '/applications/:id/rating', P.APPLICATION_MANAGE, { params: jobParams, body: 'Rating', response: 'Application', ...company }),
    op('applicationNote', 'applications', 'post', '/applications/:id/notes', P.APPLICATION_MANAGE, { params: jobParams, body: 'Note', status: 201, ...company }),
    op('myApplications', 'applications', 'get', '/my-applications', P.APPLICATION_SELF_READ, { list: true }),
    op('talentList', 'applications', 'get', '/talent-pool', P.TALENT_POOL_MANAGE, { query: object({ q: text(500), tag: text(100) }), list: true, ...company }),
    op('talentSave', 'applications', 'post', '/talent-pool', P.TALENT_POOL_MANAGE, { body: 'TalentSave', status: 201, ...company }),
    op('talentDelete', 'applications', 'delete', '/talent-pool/:candidateId', P.TALENT_POOL_MANAGE, { params: object({ candidateId: idString }, ['candidateId']), response: 'Ack', ...company }),
    op('applicationSync', 'applications', 'post', '/internal/sync', null, { internal: true, body: 'Empty', bodyOptional: true }),
    ...['overview', 'timeseries', 'distribution', 'funnel', 'activity'].map((name) => op(`report${name[0].toUpperCase()}${name.slice(1)}`, 'admin', 'get', `/reports/${name}`, P.ADMIN_READ, {
        query: ['overview', 'timeseries', 'activity'].includes(name) ? schemas.RangeQuery : object()
    })),
    op('auditList', 'admin', 'get', '/audit', P.ADMIN_READ, { query: schemas.AuditQuery, list: true }),
    op('auditTarget', 'admin', 'get', '/audit/target/:type/:id', P.ADMIN_READ, { params: object({ type: { ...text(64), pattern: '^[A-Za-z0-9_-]+$' }, id: eventId }, ['type', 'id']), list: true }),
    op('masterList', 'admin', 'get', '/master-data', P.ADMIN_READ, { query: object({ type: text(64) }), list: true }),
    op('masterSave', 'admin', 'post', '/master-data', P.ADMIN_WRITE, { body: 'TagSave' }),
    op('masterDelete', 'admin', 'delete', '/master-data/:id', P.ADMIN_WRITE, { params: object({ id: mongoId }, ['id']), response: 'Ack' }),
    op('auditIngest', 'admin', 'post', '/internal/audit-action', null, { internal: true, body: 'AuditAction', response: 'Ack' }),
    op('aliasMap', 'admin', 'get', '/internal/alias-map', null, { internal: true })
].map((operation) => ({ ...operation, headers: operation.idempotency ? object({ 'idempotency-key': requestKey }, [], true) : object({}, [], true) }));

export const operationById = Object.fromEntries(operations.map((operation) => [operation.id, operation]));
export const publicPath = (operation) => `/api${operation.service === 'admin' ? '/admin' : ''}${operation.path}`;
