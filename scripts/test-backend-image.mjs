import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Build the release recipe with its allowlisted context, then exercise it with
// no source mounts or network. Never reads project .env or contacts providers.
const root = fileURLToPath(new URL('../', import.meta.url));
const owner = randomUUID();
const suppliedImage = process.env.JOBFIND_BACKEND_IMAGE;
const image = suppliedImage || `jobfind-backend-test:${owner}`;
const docker = (args, options = {}) => execFileSync('docker', args, {
    cwd: root, windowsHide: true, stdio: 'inherit', timeout: 60000, ...options
});
const code = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.notEqual(process.getuid(), 0, 'release image must run as non-root');
assert.equal(fs.existsSync('/app/backend/.env'), false, 'local secrets must not be packaged');
const catalog = require('/app/microservices/shared/recruitmentCatalog.cjs');
assert.equal(catalog.PROVINCES.length, 34);
assert.equal(catalog.JOB_LEVELS.length, 12);
assert.equal(catalog.normalizeProvinceCode('Bình Dương'), 'Hồ Chí Minh');
require('@babel/register')({ presets: [require.resolve('@babel/preset-env')], ignore: [/node_modules/] });
for (const name of ['allcodeService', 'postService', 'candidateSearchService']) {
    assert.ok(require('./src/services/' + name + '.js'), name + ' must load from the standalone image');
}
const transport = require('nodemailer').createTransport({ jsonTransport: true });
transport.sendMail({ from: 'qa@example.test', to: 'recipient@example.test', subject: 'Offline verification', text: 'Test' })
    .then(info => {
        assert.equal(JSON.parse(info.message).subject, 'Offline verification');
        console.log('PASS backend image: non-root, no local secrets, 34 provinces, 12 levels, all catalog consumers, offline mail API');
        process.exit(0);
    })
    .catch(error => { console.error(error); process.exit(1); });
`;

try {
    if (!suppliedImage) {
        docker(['build', '--label', `jobfind.backend-image-test=${owner}`, '-t', image,
            '-f', 'scripts/release/backend.Dockerfile', '.'], { timeout: 600000 });
    }
    docker(['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '-e', 'BABEL_DISABLE_CACHE=1', '-e', 'DB_HOST=127.0.0.1', '-e', 'DB_PORT=9',
        '-e', 'DB_PASSWORD=qa-only',
        '-e', 'JWT_SECRET=qa-offline-only-0123456789-abcdefghijklmnopqrstuvwxyz', image, 'node', '-e', code]);
} finally {
    if (!suppliedImage) {
        let metadata;
        try { metadata = JSON.parse(docker(['image', 'inspect', image], { stdio: 'pipe', encoding: 'utf8' }))[0]; }
        catch { /* A failed build has no tagged image to clean up. */ }
        if (metadata) {
            assert.equal(metadata.Config.Labels['jobfind.backend-image-test'], owner);
            docker(['image', 'rm', image]);
        }
    }
}
