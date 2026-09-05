import { execFileSync } from 'node:child_process';

const image = process.env.JOBFIND_IMAGE || 'jobfind-microservices:local';
// No external network, host ports, mounted source, database, SMTP or paid AI calls.
const code = `
import assert from 'node:assert/strict';
assert.notEqual(process.getuid(), 0, 'image must run as a non-root user');
await import('/app/api-gateway/src/app.js');
const get = (path, options) => fetch('http://127.0.0.1:4000' + path, options);
const health = await get('/healthz');
assert.equal(health.status, 200);
assert.equal((await get('/readyz')).status, 503, 'offline dependencies must not be ready');
assert.equal((await get('/status')).status, 401, 'status must require authentication');
const browserFailure = await get('/api/profile', { headers: { origin: 'http://localhost:3000' } });
assert.equal(browserFailure.status, 401);
assert.match(browserFailure.headers.get('access-control-expose-headers'), /Retry-After/i);
assert.match(browserFailure.headers.get('access-control-expose-headers'), /X-Correlation-Id/i);
assert.ok(browserFailure.headers.get('x-correlation-id'));
assert.equal((await get('/metrics')).status, 403, 'metrics must require its own credential');
const metrics = await get('/metrics', {headers:{authorization:'Bearer image-test-metrics-credential-0123456789'}});
assert.equal(metrics.status, 200);
assert.match(await metrics.text(), /jobfind_http_requests_total/);
assert.equal((await get('/api/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:'a'.repeat(1100000)})})).status, 413);
assert.equal((await get('/api/jobs/1', {method:'POST'})).status, 404, 'unsupported methods must not reach legacy');
assert.equal((await get('/api/jobs/1/repost', {method:'POST'})).status, 401, 'repost must be registered and require login');
const { normalizeJobCreate } = await import('/app/job-core-service/src/libs/jobRequest.js');
assert.equal(normalizeJobCreate({ amount: '2' }).amount, 2, 'posting request helper must be packaged');
const { readFile } = await import('node:fs/promises');
const { buildOpenApi } = await import('/app/shared/contracts/openapi.js');
assert.deepEqual(JSON.parse(await readFile('/app/contracts/http/gateway.openapi.json', 'utf8')), buildOpenApi());
const { eventCatalog, eventExamples } = await import('/app/shared/contracts/eventCatalog.js');
const { assertEventPayload } = await import('/app/shared/eventContract.js');
assert.deepEqual(JSON.parse(await readFile('/app/contracts/events/catalog.v1.json', 'utf8')).events, eventCatalog);
for (const [key, example] of Object.entries(eventExamples)) assertEventPayload(key, example);
console.log('PASS image: non-root, isolated HTTP, readiness, protected status/metrics, payload limit, contract guard and packaged HTTP/event contracts');
process.kill(process.pid, 'SIGTERM');
`;
execFileSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '-e', 'JWT_SECRET=image-test-jwt-secret-0123456789-abcdef',
    '-e', 'METRICS_TOKEN=image-test-metrics-credential-0123456789',
    '-e', 'MYSQL_HOST=127.0.0.1', '-e', 'MYSQL_PORT=9',
    '-e', 'REDIS_URL=redis://127.0.0.1:9', image, 'node', '--input-type=module', '-e', code],
{ stdio: 'inherit', timeout: 60000 });
console.log('PASS image: SIGTERM completed with exit code 0');
