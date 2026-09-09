// Test entrypoint only. Load the real router, authentication, authorization,
// controllers and Sequelize models without starting schedules, SMTP or Socket.IO.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const backend = createRequire('/backend/package.json');
assert.equal(process.env.DB_HOST, 'mysql');
assert.equal(process.env.DB_NAME, 'acceptance');
backend('dotenv').config = () => ({ parsed: {} });
backend('@babel/register')({ babelrc: false, configFile: false, cache: false,
    only: [file => file.startsWith('/backend/src/')],
    presets: [[backend.resolve('@babel/preset-env'), { targets: { node: 'current' } }]] });
const db = backend('./src/models/index.js');
const express = backend('express');
const app = express();
app.use(express.json({ limit: '4mb' }));
// Keep the existing background delivery fixture observable; this is the only
// legacy route replaced by a fake. No outbound provider is reachable here.
app.post('/internal/emit-notification', async (req, res) => {
    const response = await fetch('http://mock:4010/internal/emit-notification', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': req.headers['x-internal-secret'] || '' },
        body: JSON.stringify(req.body), signal: AbortSignal.timeout(5000)
    });
    res.status(response.status).json(await response.json());
});
app.get('/readyz', async (_req, res) => {
    try { await db.sequelize.authenticate(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
});
backend('./src/routes/web.js')(app);
let server;
(async () => {
    await db.sequelize.authenticate();
    const password = await backend('bcryptjs').hash(process.env.FIXTURE_PASSWORD, 10);
    await db.sequelize.query('UPDATE accounts SET password=:password WHERE password IS NULL', { replacements: { password } });
    server = app.listen(4011, () => console.log('Legacy fixture: real router and database authentication ready'));
})().catch(async error => {
    console.error('Legacy fixture startup failed: ' + error.message.replaceAll(process.env.FIXTURE_PASSWORD, '[test-secret]'));
    await db.sequelize.close(); process.exitCode = 1;
});
process.once('SIGTERM', async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.sequelize.close();
});
