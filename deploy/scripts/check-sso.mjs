// Kiem tra dang nhap Google/GitHub/Facebook tren dia chi cong khai, khong can tai khoan:
// moi nut phai di tu JobFind -> Auth0 -> dung trang dang nhap cua nha cung cap.
//   npm run vps:check-sso -- https://jobfind.example.com   (sau khi deploy VPS)
//   npm run vps:check-sso -- http://localhost:4000         (may dev, qua API Gateway)
// Script dung lai truoc callback cua JobFind nen khong tao tai khoan, phien hay log tu choi.
const arg = process.argv.slice(2).find(value => !value.startsWith('--'));
if (!arg) {
    console.error('Dung: npm run vps:check-sso -- <PUBLIC_URL>, vd https://jobfind.example.com');
    process.exit(1);
}
const base = new URL(arg.includes('://') ? arg : `https://${arg}`).origin;
const local = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const callback = `${base}/api/auth/sso/auth0/callback`;
const providerHosts = { google: ['accounts.google.com'], github: ['github.com'], facebook: ['facebook.com'] };
const labels = { google: 'Google', github: 'GitHub', facebook: 'Facebook' };
const onHost = (url, hosts) => hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
const request = (url, cookies = []) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'JobFind SSO check', ...(cookies.length ? { Cookie: cookies.join('; ') } : {}) } });
const cookiesOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]);

let failed = false;
const fail = message => { failed = true; console.log(`  LOI  ${message}`); };
const ok = message => console.log(`  OK   ${message}`);

// Theo Auth0 toi khi gap trang cua nha cung cap, loi cua Auth0, hoac callback cua JobFind (khong goi callback).
const followAuth0 = async (name, start) => {
    let url = start, cookies = [];
    for (let hop = 0; hop < 5; hop += 1) {
        const response = await request(url, cookies);
        cookies = [...cookies, ...cookiesOf(response)];
        const body = response.status >= 400 ? await response.text() : '';
        if (/callback url mismatch/i.test(body)) {
            return fail(`Auth0 tu choi URL callback. Them ${callback} vao Allowed Callback URLs cua application.`);
        }
        if (response.status < 300 || response.status >= 400) {
            return fail(`Auth0 tra ve HTTP ${response.status}${body ? `: ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}` : ''}`);
        }
        const next = new URL(response.headers.get('location'), url);
        if (onHost(next, providerHosts[name])) return ok(`Auth0 chuyen toi trang dang nhap ${labels[name]} (${next.hostname}).`);
        if (next.origin + next.pathname === callback) {
            const reason = next.searchParams.get('error_description') || next.searchParams.get('error') || 'khong ro';
            return fail(`Auth0 bao loi truoc khi toi ${labels[name]}: ${reason}.${/connection/i.test(reason) ? ' Bat connection nay cho application trong Auth0 (Authentication > Social).' : ''}`);
        }
        if (next.pathname.startsWith('/u/login')) return fail('Auth0 hien trang Universal Login thay vi chuyen thang: kiem tra OIDC_AUTH0_CONNECTIONS.');
        url = next.href;
    }
    return fail('Auth0 chuyen huong qua nhieu lan.');
};

console.log(`Kiem tra dang nhap mang xa hoi tai ${base}`);
if (!local && !base.startsWith('https://')) {
    console.log('  Canh bao: backend production chi bat SSO khi PUBLIC_URL la HTTPS (can ten mien). Qua HTTP cac nut se bi tat.');
}
let providers;
try {
    const response = await request(`${base}/api/auth/providers`);
    providers = await response.json();
    if (!response.ok || providers.errCode !== 0) throw new Error(`HTTP ${response.status}`);
} catch (error) {
    console.log(`  LOI  Khong doc duoc ${base}/api/auth/providers (${error.message}). Ung dung da chay va mo cong chua?`);
    process.exit(1);
}

for (const name of ['google', 'github', 'facebook']) {
    console.log(`\n${labels[name]}`);
    if (!providers[name]) {
        fail(`Nut dang tat. Dat OIDC_AUTH0_ENABLED=true va OIDC_AUTH0_CONNECTIONS co ${name === 'google' ? 'google-oauth2' : name} (deploy/.env), roi docker compose up -d.`);
        continue;
    }
    try {
        const started = await request(`${base}/api/auth/sso/${name}/start?rememberMe=false`);
        const location = started.headers.get('location');
        if (started.status !== 302 || !location) { fail(`/api/auth/sso/${name}/start tra ve HTTP ${started.status} thay vi chuyen huong.`); continue; }
        const next = new URL(location);
        if (onHost(next, providerHosts[name])) { ok(`Di thang toi ${labels[name]} (khong qua Auth0).`); continue; }
        const redirect = next.searchParams.get('redirect_uri');
        if (redirect !== callback) {
            fail(`redirect_uri la ${redirect}, can la ${callback}. Kiem tra PUBLIC_URL/OIDC_AUTH0_REDIRECT_URI.`);
            continue;
        }
        ok(`JobFind chuyen toi Auth0 (${next.hostname}), connection=${next.searchParams.get('connection') || '(khong co)'}.`);
        await followAuth0(name, next.href);
    } catch (error) {
        fail(`Khong kiem tra duoc: ${error.message}`);
    }
}

console.log(failed
    ? `\nCon loi. Cau hinh Auth0 can co: Allowed Callback URLs chua ${callback}; Google, GitHub, Facebook bat cho application.`
    : '\nTat ca cac nut dang nhap san sang cho moi nguoi dung.');
process.exitCode = failed ? 1 : 0;
