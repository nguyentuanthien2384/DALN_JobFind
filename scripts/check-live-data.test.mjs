import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveData, hasUniqueCvConstraint, safeErrorCode } from './check-live-data.mjs';

const index = (col, extra = {}) => ({ name: 'cv_pair', col, prefixLength: null, ...extra });

test('CV uniqueness requires exactly the complete user/post pair', () => {
    assert.equal(hasUniqueCvConstraint([index('postId'), index('userId')]), true);
    assert.equal(hasUniqueCvConstraint([index('userId'), index('postId'), index('description')]), false);
    assert.equal(hasUniqueCvConstraint([index('userId'), index('postId', { prefixLength: 5 })]), false);
    assert.equal(hasUniqueCvConstraint([index('userId'), index('postId', { name: 'other_index' })]), false);
});

test('driver and HTTP error details cannot leak credentials into the report', () => {
    assert.equal(safeErrorCode({ code: 'ER_ACCESS_DENIED_ERROR', message: 'password=private' }), 'ER_ACCESS_DENIED_ERROR');
    assert.equal(safeErrorCode({ code: 'password=private', message: 'user=private' }), 'CHECK_FAILED');
    assert.equal(safeErrorCode({ name: 'TimeoutError', message: 'private' }), 'TIMEOUT');
});

function fixture({ empty = false, returnedApplications = 4, queryError = false } = {}) {
    const requests = [];
    const queries = [];
    let destroyed = false;
    const job = { id: 5, postDetailData: { name: 'Frontend Developer' },
        userPostData: { userCompanyData: { id: 7 } } };
    const fetchImpl = async (url, options) => {
        requests.push({ pathname: url.pathname, method: options.method });
        let body;
        let status = 200;
        switch (url.pathname) {
            case '/health': body = { status: 'ok', service: 'api-gateway' }; break;
            case '/readyz': body = { status: 'ready' }; break;
            case '/api/get-filter-post': body = { errCode: 0, count: empty ? 0 : 1, data: empty ? [] : [job] }; break;
            case '/api/get-list-company': body = { errCode: 0, count: 1, data: [{ id: 7, name: 'Example Company' }] }; break;
            case '/api/my-applications': status = 401; body = { errCode: 401 }; break;
            case '/api/get-detail-post-by-id': body = { errCode: 0, data: { ...job,
                companyData: { id: 7, name: 'Example Company' }, applicationCount: returnedApplications } }; break;
            default: throw new Error('Unexpected request');
        }
        return new Response(JSON.stringify(body), { status });
    };
    const connect = async () => ({
        destroy() { destroyed = true; },
        async query({ sql, timeout }) {
            queries.push(sql);
            assert.match(sql, /^SELECT\s/i, 'verification must remain read only');
            assert.equal(timeout, 5000);
            if (queryError) throw Object.assign(new Error('password=private'), { code: 'ER_NO_SUCH_TABLE' });
            let rows;
            if (sql.includes('information_schema.TABLES')) rows = ['cvs', 'users', 'accounts', 'companies', 'posts', 'detailposts', 'outbox_events']
                .map(name => ({ name, engine: 'InnoDB' }));
            else if (sql.includes('information_schema.STATISTICS')) rows = [index('userId'), index('postId')];
            else if (sql.includes('information_schema.COLUMNS')) rows = ['id', 'aggregateType', 'aggregateId', 'eventType', 'payload', 'attempts',
                'lastError', 'nextAttemptAt', 'lockedAt', 'lockToken', 'createdAt', 'publishedAt'].map(name => ({ name }));
            else if (sql.includes('AS connected')) rows = [{ connected: 1 }];
            else if (sql.includes('AS visibleJobs')) rows = [{ visibleJobs: empty ? 0 : 1, unexpiredJobs: empty ? 0 : 1,
                expiredJobs: 0, invalidDeadlines: 0, openForApplications: empty ? 0 : 1 }];
            else if (sql.includes('AS storedJobs')) rows = [{ storedJobs: empty ? 0 : 1, storedApplications: 4, publicCompanies: 1 }];
            else if (sql.startsWith('SELECT id, name FROM')) rows = [{ id: 7, name: 'Example Company' }];
            else if (sql.startsWith('SELECT p.id, d.name')) rows = [{ id: 5, name: 'Frontend Developer', companyId: 7 }];
            else if (sql.startsWith('SELECT p.id, p.timeEnd')) rows = empty ? [] : [{ id: 5, name: 'Frontend Developer',
                companyId: 7, companyName: 'Example Company', applicationCount: 4 }];
            else throw new Error('Unexpected SELECT');
            return [rows];
        }
    });
    return { fetchImpl, connect, requests, queries, get destroyed() { return destroyed; } };
}

const env = { JOBFIND_API_URL: 'http://127.0.0.1:4000', APPLICATION_URL: '', JOB_CORE_URL: '', IDENTITY_URL: '' };

test('live verification compares database-backed API data using GET and SELECT only', async () => {
    const fake = fixture();
    const result = await checkLiveData({ ...fake, env });
    assert.equal(result.ok, true);
    assert.equal(result.sampleJob.applicationCount, 4);
    assert.equal(result.checks.find(item => item.name === 'data.job-detail-consistency').status, 'pass');
    assert.equal(fake.requests.every(item => item.method === 'GET'), true);
    assert.equal(fake.destroyed, true);
    assert.equal(JSON.stringify(result).includes('password'), false);
});

test('a healthy empty job database is a data warning instead of an API failure', async () => {
    const fake = fixture({ empty: true });
    const result = await checkLiveData({ ...fake, env });
    assert.equal(result.ok, true);
    assert.equal(result.counts.visibleJobs, 0);
    assert.equal(result.checks.find(item => item.name === 'data.open-jobs').status, 'warning');
    assert.equal(fake.requests.some(item => item.pathname === '/api/get-detail-post-by-id'), false);
    assert.equal(fake.destroyed, true);
});

test('a fabricated API application total fails verification', async () => {
    const result = await checkLiveData({ ...fixture({ returnedApplications: 156 }), env });
    assert.equal(result.ok, false);
    assert.equal(result.checks.find(item => item.name === 'data.job-detail-consistency').status, 'fail');
});

test('query failures still close the database socket without exposing raw errors', async () => {
    const fake = fixture({ queryError: true });
    const result = await checkLiveData({ ...fake, env });
    assert.equal(result.ok, false);
    assert.equal(fake.destroyed, true);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(result.checks.at(-1).details.code, 'ER_NO_SUCH_TABLE');
});
