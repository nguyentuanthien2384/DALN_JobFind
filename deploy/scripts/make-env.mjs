// Tao deploy/.env cho VPS tu cau hinh local: sinh mat khau/secret moi, chep cac
// khoa dich vu ngoai (AI, email, Cloudinary, PayPal, Web Push...) tu backend/.env,
// microservices/.env va co giao dien tu frontend/.env. Khong in gia tri bi mat.
//   npm run vps:env -- jobfind.example.com          (HTTPS voi ten mien)
//   npm run vps:env -- 203.0.113.10                 (HTTP theo IP, chi de xem thu)
//   npm run vps:env -- http://localhost:8088        (thu tren chinh may dev)
// Them --force de ghi de, --out <file> de ghi ra file khac.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dotenv = createRequire(path.join(root, 'backend/package.json'))('dotenv');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const target = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--out');
if (!target) {
    console.error('Dung: npm run vps:env -- <ten-mien | IP | http://host:port> [--force] [--out deploy/.env]');
    process.exit(1);
}
const out = path.resolve(root, option('--out') || 'deploy/.env');

const site = (() => {
    if (target.includes('://')) {
        const url = new URL(target);
        if (url.protocol === 'https:') return { SITE_ADDRESS: url.hostname, PUBLIC_URL: `https://${url.hostname}` };
        return { SITE_ADDRESS: ':80', PUBLIC_URL: url.origin, HTTP_PORT: url.port || '80', HTTPS_PORT: url.port ? '8443' : '443' };
    }
    if (net.isIP(target)) return { SITE_ADDRESS: ':80', PUBLIC_URL: `http://${target}` };
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(target)) throw new Error(`Ten mien khong hop le: ${target}`);
    return { SITE_ADDRESS: target.toLowerCase(), PUBLIC_URL: `https://${target.toLowerCase()}` };
})();

const read = async relative => {
    try { return dotenv.parse(await fs.readFile(path.join(root, relative))); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
};
const backend = await read('backend/.env');
const micro = await read('microservices/.env');
const web = await read('frontend/.env');
const pick = (...values) => values.find(value => typeof value === 'string' && value.trim() !== '')?.trim() ?? '';
const secret = bytes => randomBytes(bytes).toString('hex');

const anthropicKey = pick(micro.ANTHROPIC_API_KEY);
const values = {
    ...site,
    MYSQL_ROOT_PASSWORD: secret(24), MYSQL_PASSWORD: secret(24), POSTGRES_PASSWORD: secret(24), RABBITMQ_PASSWORD: secret(24),
    JWT_SECRET: secret(48), INTERNAL_SECRET: secret(48),
    MYSQL_DATABASE: 'jobfindtest', MYSQL_USER: 'jobfind', POSTGRES_USER: 'jobfind', RABBITMQ_USER: 'jobfind',
    COMPOSE_PROFILES: anthropicKey ? 'ai' : '',
    ANTHROPIC_BASE_URL: pick(micro.ANTHROPIC_BASE_URL), ANTHROPIC_API_KEY: anthropicKey,
    CLAUDE_MODEL: pick(micro.CLAUDE_MODEL, 'claude-opus-5'), SUPPORT_CLAUDE_MODEL: pick(micro.SUPPORT_CLAUDE_MODEL, 'claude-sonnet-5'),
    GEMINI_API_KEY: pick(micro.GEMINI_API_KEY, backend.GEMINI_API_KEY), OPENAI_API_KEY: pick(micro.OPENAI_API_KEY),
    EMAIL_APP: pick(micro.EMAIL_APP, backend.EMAIL_APP), EMAIL_APP_PASSWORD: pick(micro.EMAIL_APP_PASSWORD, backend.EMAIL_APP_PASSWORD),
    CLOUDINARY_CLOUD_NAME: pick(backend.CLOUD_NAME), CLOUDINARY_API_KEY: pick(backend.API_KEY), CLOUDINARY_API_SECRET: pick(backend.API_SECRET),
    // PayPal luon la sandbox nhu cau hinh nguon; ten cu CLIENT_ID/CLIENT_SECRET duoc doi ten.
    PAYPAL_MODE: 'sandbox',
    PAYPAL_CLIENT_ID: pick(backend.PAYPAL_CLIENT_ID, backend.CLIENT_ID), PAYPAL_CLIENT_SECRET: pick(backend.PAYPAL_CLIENT_SECRET, backend.CLIENT_SECRET),
    WEB_PUSH_ENABLED: pick(backend.WEB_PUSH_ENABLED, 'false'), WEB_PUSH_SUBJECT: pick(backend.WEB_PUSH_SUBJECT),
    WEB_PUSH_PUBLIC_KEY: pick(backend.WEB_PUSH_PUBLIC_KEY), WEB_PUSH_PRIVATE_KEY: pick(backend.WEB_PUSH_PRIVATE_KEY),
    OIDC_GOOGLE_ENABLED: pick(backend.OIDC_GOOGLE_ENABLED, 'false'),
    OIDC_GOOGLE_CLIENT_ID: pick(backend.OIDC_GOOGLE_CLIENT_ID), OIDC_GOOGLE_CLIENT_SECRET: pick(backend.OIDC_GOOGLE_CLIENT_SECRET),
    OAUTH_GITHUB_ENABLED: pick(backend.OAUTH_GITHUB_ENABLED, 'false'),
    OAUTH_GITHUB_CLIENT_ID: pick(backend.OAUTH_GITHUB_CLIENT_ID), OAUTH_GITHUB_CLIENT_SECRET: pick(backend.OAUTH_GITHUB_CLIENT_SECRET),
    OIDC_AUTH0_ENABLED: pick(backend.OIDC_AUTH0_ENABLED, 'false'), OIDC_AUTH0_ISSUER: pick(backend.OIDC_AUTH0_ISSUER),
    OIDC_AUTH0_CLIENT_ID: pick(backend.OIDC_AUTH0_CLIENT_ID), OIDC_AUTH0_CLIENT_SECRET: pick(backend.OIDC_AUTH0_CLIENT_SECRET),
    OIDC_AUTH0_CONNECTIONS: pick(backend.OIDC_AUTH0_CONNECTIONS),
    SCHEDULED_JOBS_ENABLED: 'false',
    REACT_APP_JOB_CREATE_MODE: pick(web.REACT_APP_JOB_CREATE_MODE, 'core'),
    REACT_APP_JOB_EDIT_MODE: pick(web.REACT_APP_JOB_EDIT_MODE, 'core'),
    REACT_APP_JOB_REPOST_MODE: pick(web.REACT_APP_JOB_REPOST_MODE, 'core'),
    REACT_APP_JOB_WORKSPACE_MODE: pick(web.REACT_APP_JOB_WORKSPACE_MODE, 'legacy'),
    REACT_APP_JOB_SEARCH_MODE: pick(web.REACT_APP_JOB_SEARCH_MODE, 'legacy'),
    REACT_APP_CANDIDATE_AI_ENABLED: pick(web.REACT_APP_CANDIDATE_AI_ENABLED, 'true'),
    REACT_APP_APPLICATION_PROGRESS_ENABLED: pick(web.REACT_APP_APPLICATION_PROGRESS_ENABLED, 'true'),
    REACT_APP_PREPARED_CV_APPLICATION_ENABLED: pick(web.REACT_APP_PREPARED_CV_APPLICATION_ENABLED, 'false'),
    REACT_APP_CONTACT_EMAIL: pick(web.REACT_APP_CONTACT_EMAIL),
};

// Compose noi suy $ trong gia tri khong nam trong nhay don.
const quote = (name, value) => {
    if (/^[\w.:/@+,=-]*$/.test(value)) return value;
    if (value.includes("'") || value.includes('\n')) throw new Error(`${name} chua dau nhay don hoac xuong dong; hay tu dien vao file.`);
    return `'${value}'`;
};
const body = [
    '# Tao boi deploy/scripts/make-env.mjs. Mo ta tung bien: deploy/.env.example. KHONG commit file nay.',
    ...Object.entries(values).map(([name, value]) => `${name}=${quote(name, value)}`),
    '',
].join('\n');

try { await fs.writeFile(out, body, { flag: flag('--force') ? 'w' : 'wx', mode: 0o600 }); }
catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error(`${path.relative(root, out)} da ton tai. Them --force de tao lai (mat khau moi se KHONG khop CSDL dang chay).`);
    process.exit(1);
}

const copied = ['ANTHROPIC_API_KEY', 'EMAIL_APP', 'CLOUDINARY_CLOUD_NAME', 'PAYPAL_CLIENT_ID', 'WEB_PUSH_PUBLIC_KEY', 'GEMINI_API_KEY', 'OIDC_GOOGLE_CLIENT_ID', 'OIDC_AUTH0_CLIENT_ID'];
console.log(`Da tao ${path.relative(root, out)} cho ${values.PUBLIC_URL}`);
console.log('  Mat khau CSDL, RabbitMQ, JWT_SECRET, INTERNAL_SECRET: sinh moi.');
for (const name of copied) console.log(`  ${name}: ${values[name] ? 'chep tu .env local' : 'TRONG - dien neu can'}`);
if (!values.ANTHROPIC_API_KEY) console.log('  Khong co ANTHROPIC_API_KEY: AI Worker se khong chay (COMPOSE_PROFILES trong).');
if (values.SITE_ADDRESS === ':80') console.log('  Canh bao: chay HTTP khong co HTTPS, trinh duyet khong luu cookie phien; dung ten mien khi demo that.');
if (['OIDC_GOOGLE_ENABLED', 'OAUTH_GITHUB_ENABLED', 'OIDC_AUTH0_ENABLED'].some(name => values[name] === 'true')) {
    if (!values.PUBLIC_URL.startsWith('https://')) console.log('  Canh bao: dang nhap Google/GitHub/Facebook chi bat khi co HTTPS (ten mien); cau hinh HTTP theo IP se tat cac nut nay.');
    if (values.OIDC_AUTH0_ENABLED === 'true') {
        console.log(`  Auth0: them ${values.PUBLIC_URL}/api/auth/sso/auth0/callback vao Allowed Callback URLs (giu dia chi localhost de dev).`);
        console.log(`  Nut qua Auth0: ${values.OIDC_AUTH0_CONNECTIONS || '(OIDC_AUTH0_CONNECTIONS trong - cac nut se tat)'}`);
    } else console.log(`  Nho dang ky redirect URI ${values.PUBLIC_URL}/api/auth/sso/<google|github>/callback o nha cung cap.`);
    console.log(`  Sau khi deploy: npm run vps:check-sso -- ${values.PUBLIC_URL}`);
}
