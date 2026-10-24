// Shared helpers for the Postman collection generator.
// Scripts are written as real functions (so they are syntax-checked) and stringified.

const dedent = (text) => {
    const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    return lines.map((l) => l.slice(indent));
};
// Postman wraps each script in a function whose parameters include legacy globals
// (data, CryptoJS, request, environment...): never declare those names at top level.
const fnBody = (fn) => {
    const src = fn.toString();
    const rest = src.slice(src.indexOf('=>') + 2).trim();
    if (!rest.startsWith('{')) return `${rest};`;
    return rest.slice(1, rest.lastIndexOf('}'));
};
// script(fn, { NAME: 'value' }) -> exec lines; __NAME__ placeholders are replaced.
export const script = (fn, params = {}) => {
    let body = fnBody(fn);
    for (const [key, value] of Object.entries(params)) body = body.split(`__${key}__`).join(String(value));
    return dedent(body);
};
export const event = (listen, lines) => ({ listen, script: { type: 'text/javascript', exec: lines } });

const url = (pathAndQuery) => {
    const [path, query] = pathAndQuery.split('?');
    // Keep a trailing empty segment: Postman rebuilds the URL from this array, and
    // "/socket.io/" must not become "/socket.io" (the gateway proxies only "/socket.io/**").
    const out = { raw: `{{baseUrl}}${pathAndQuery}`, host: ['{{baseUrl}}'], path: path.split('/').slice(1) };
    if (query) out.query = query.split('&').map((pair) => {
        const at = pair.indexOf('=');
        return at === -1 ? { key: pair, value: null } : { key: pair.slice(0, at), value: pair.slice(at + 1) };
    });
    return out;
};

// token: 'admin' -> tab Authorization: Bearer Token {{adminAccessToken}}.
// The cookie jar is disabled on every request: all accounts share one refresh-cookie
// name per domain, so refresh tokens are kept per account in variables instead.
// noRedirect: keep 302/303 responses instead of following them.
export const req = (name, { method = 'GET', path, token, headers = {}, body, pre, test, description, noRedirect }) => {
    const header = [];
    if (body !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        header.push({ key: 'Content-Type', value: 'application/json' });
    }
    for (const [key, value] of Object.entries(headers)) header.push({ key, value });
    const request = {
        method,
        auth: token ? { type: 'bearer', bearer: [{ key: 'token', value: `{{${token}AccessToken}}`, type: 'string' }] } : { type: 'noauth' },
        header,
        url: url(path)
    };
    if (body !== undefined) {
        request.body = { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2) };
        if (typeof body !== 'string' || body.trim().startsWith('{')) request.body.options = { raw: { language: 'json' } };
    }
    if (description) request.description = description;
    const events = [];
    if (pre) events.push(event('prerequest', pre));
    if (test) events.push(event('test', test));
    return { name, event: events, request, protocolProfileBehavior: { disableCookies: true, ...(noRedirect && { followRedirects: false }) } };
};
export const folder = (name, description, item, { pre } = {}) => ({
    name, description, item, ...(pre && { event: [event('prerequest', pre)] })
});
export const lines = (...parts) => parts.join('\n');

// ---------- reusable test snippets ----------
export const expectStatus = (code, extra = () => {}) => [
    ...script(() => { pm.test('HTTP __CODE__', () => pm.response.to.have.status(__CODE__)); }, { CODE: code }),
    ...script(extra)
];
// Rejection with a known Vietnamese message.
export const expectError = (code, message, errCode = code) => script(() => {
    pm.test('HTTP __CODE__', () => pm.response.to.have.status(__CODE__));
    const body = pm.response.json();
    pm.test('errCode = __ERRCODE__', () => pm.expect(body.errCode).to.eql(__ERRCODE__));
    pm.test('Thông báo lỗi đúng', () => pm.expect(body.errMessage).to.include(__MESSAGE__));
}, { CODE: code, ERRCODE: JSON.stringify(errCode), MESSAGE: JSON.stringify(message) });
// Legacy backend answers most business errors with HTTP 200 + errCode.
export const legacyError = (errCode, message, status = 200) => expectError(status, message, errCode);
export const contractError = () => [
    ...expectError(400, 'Dữ liệu yêu cầu không hợp lệ'),
    ...script(() => {
        pm.test('requestId trùng X-Correlation-Id (để tra log)', () => {
            pm.expect(pm.response.json().requestId).to.eql(pm.response.headers.get('X-Correlation-Id'));
        });
    })
];
export const ok = (extra) => [
    ...script(() => {
        pm.test('HTTP 200', () => pm.response.to.have.status(200));
        pm.test('errCode = 0', () => pm.expect(pm.response.json().errCode).to.eql(0));
    }),
    ...(extra ? script(extra) : [])
];
export const created = (extra) => [
    ...script(() => {
        pm.test('HTTP 201', () => pm.response.to.have.status(201));
        pm.test('errCode = 0', () => pm.expect(pm.response.json().errCode).to.eql(0));
    }),
    ...(extra ? script(extra) : [])
];
// Legacy RBAC denial (backend authorize middleware).
export const legacyForbidden = () => legacyError(3, 'Bạn không có quyền', 403);
export const skipUnless = (variable, reason) => script(() => {
    if (!pm.environment.get('__VAR__')) {
        console.log('Bỏ qua "' + pm.info.requestName + '": __REASON__');
        pm.execution.skipRequest();
    }
}, { VAR: variable, REASON: reason });
export const skipWhenFlag = (flag, reason) => script(() => {
    if (pm.environment.get('__FLAG__') === 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": __REASON__');
        pm.execution.skipRequest();
    }
}, { FLAG: flag, REASON: reason });
export const skipUnlessFlag = (flag, reason) => script(() => {
    if (pm.environment.get('__FLAG__') !== 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": __REASON__');
        pm.execution.skipRequest();
    }
}, { FLAG: flag, REASON: reason });

// Backend rate limiters live in memory and expose no remaining-count header, so
// the collection records its own attempts and keeps a margin for real users.
export const rateGuard = (key, windowMinutes, max, reason) => script(() => {
    const now = Date.now();
    let recent = [];
    try { recent = JSON.parse(pm.environment.get('__KEY__') || '[]').filter((t) => now - t < __WINDOW__ * 60000); } catch (e) { recent = []; }
    if (recent.length >= __MAX__) {
        console.log('Bỏ qua "' + pm.info.requestName + '": __REASON__');
        pm.environment.set('__KEY__', JSON.stringify(recent));
        pm.execution.skipRequest();
    } else {
        recent.push(now);
        pm.environment.set('__KEY__', JSON.stringify(recent));
    }
}, { KEY: key, WINDOW: windowMinutes, MAX: max, REASON: reason });
export const loginGuard = script(() => {
    // Gateway va backend chan MOI lan dang nhap tu IP nay khi sai qua 10 lan / 15 phut.
    // Chua lai it nhat 5 lan cho nguoi dung, de chay collection nhieu lan khong tu khoa minh.
    if (Number(pm.environment.get('loginFailures') || 0) >= 5) {
        console.log('Bỏ qua "' + pm.info.requestName + '": đã có nhiều lần đăng nhập sai trong 15 phút, tránh bị rate limit khoá đăng nhập.');
        pm.execution.skipRequest();
    }
});
export const recordLoginFailure = script(() => {
    const remaining = Number(pm.response.headers.get('X-RateLimit-Remaining'));
    if (Number.isFinite(remaining)) pm.environment.set('loginFailures', 10 - remaining);
});
// The gateway allows 30 AI requests per hour per account (chatbot turns included).
// Keep 5 for the person using the account; a reading older than 1 hour is ignored.
export const aiQuotaGuard = script(() => {
    let quota = {};
    try { quota = JSON.parse(pm.environment.get('aiQuota') || '{}'); } catch (e) { quota = {}; }
    if (quota.at && Date.now() - quota.at < 3600000 && quota.remaining <= 5) {
        console.log('Bỏ qua "' + pm.info.requestName + '": tài khoản còn ' + quota.remaining + ' lượt AI trong giờ này (Gateway giới hạn 30 lượt/giờ).');
        pm.execution.skipRequest();
    }
});
export const recordAiQuota = script(() => {
    const remaining = Number(pm.response.headers.get('X-RateLimit-Remaining'));
    if (pm.response.headers.get('X-RateLimit-Limit') === '30' && Number.isFinite(remaining)) {
        pm.environment.set('aiQuota', JSON.stringify({ remaining, at: Date.now() }));
    }
});
// Saves "name=value" of the refresh cookie from Set-Cookie into an env variable.
export const saveRefreshCookie = (variable) => script(() => {
    const setCookie = pm.response.headers.all().filter((h) => h.key.toLowerCase() === 'set-cookie')
        .map((h) => h.value).find((v) => /jobfind_rt=/.test(v)) || '';
    const match = /^([^=;\s]*jobfind_rt)=([^;]*)/.exec(setCookie);
    pm.test('Có cookie refresh HttpOnly', () => {
        pm.expect(match, 'thiếu Set-Cookie jobfind_rt').to.not.be.null;
        pm.expect(setCookie).to.match(/HttpOnly/i);
    });
    if (match) pm.environment.set('__VAR__', match[1] + '=' + match[2]);
}, { VAR: variable });
// Saves the refresh token (value of the HttpOnly cookie) of one account, e.g. 'admin' -> adminRefreshToken.
export const saveRefreshToken = (account) => script(() => {
    const setCookie = pm.response.headers.all().filter((h) => h.key.toLowerCase() === 'set-cookie')
        .map((h) => h.value).find((v) => /jobfind_rt=/.test(v)) || '';
    const match = /^([^=;\s]*jobfind_rt)=([^;]*)/.exec(setCookie);
    if (match && match[2]) {
        pm.environment.set('refreshCookieName', match[1]);
        pm.environment.set('__ACCOUNT__RefreshToken', match[2]);
    }
}, { ACCOUNT: account });
export const loginBody = (phoneVar, passwordVar) => `{\n  "identifier": "{{${phoneVar}}}",\n  "password": "{{${passwordVar}}}"\n}`;

// ---------- collection-level scripts ----------
export const collectionPre = script(() => {
    // Chay truoc MOI request trong collection.
    // 1) Nhac chon environment.
    // 2) Gia han access token giong trinh duyet. Request dung tab Authorization = Bearer
    //    {{<tai khoan>AccessToken}}; neu token do trong hoac con duoi 1 phut thi goi
    //    POST /api/auth/refresh bang <tai khoan>RefreshToken. Refresh token het han/bi thu hoi
    //    (hoac tra ve sai tai khoan) thi moi dang nhap lai bang mat khau trong environment.
    if (!pm.environment.get('baseUrl')) {
        throw new Error('Chưa chọn environment "JobFind API Tests - Local" hoặc "JobFind API Tests - Production" (góc trên bên phải Postman).');
    }
    const cryptoJs = require('crypto-js');
    const accounts = {
        admin: ['adminPhone', 'adminPassword'],
        employer: ['employerPhone', 'employerPassword'],
        employer2: ['employer2Phone', 'employer2Password'],
        candidate: ['candidatePhone', 'candidatePassword'],
        testCandidate: ['testCandidatePhone', 'testCandidatePassword'],
        pm: ['pmPhone', 'pmPassword'],
        recruiter: ['recruiterPhone', 'recruiterPassword']
    };
    const auth = pm.request.auth;
    const bearer = auth && auth.type === 'bearer' ? String(auth.parameters().get('token') || '') : '';
    const account = (/^\{\{(\w+)AccessToken\}\}$/.exec(bearer) || [])[1];
    // Cho script Tests biet request nay dung token cua tai khoan nao.
    pm.environment.set('lastAccount', accounts[account] ? account : '');
    const expiresAt = (jwt) => {
        try {
            let part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            while (part.length % 4) part += '=';
            return JSON.parse(cryptoJs.enc.Base64.parse(part).toString(cryptoJs.enc.Utf8)).exp * 1000;
        } catch (e) {
            return 0;
        }
    };
    const accessVar = account + 'AccessToken';
    const refreshVar = account + 'RefreshToken';
    const current = pm.environment.get(accessVar);
    if (accounts[account] && (!current || expiresAt(current) - Date.now() < 60 * 1000)) {
        const base = pm.environment.get('baseUrl');
        const origin = pm.environment.get('origin');
        const saveRefresh = (res) => {
            const setCookie = res.headers.all().filter((h) => h.key.toLowerCase() === 'set-cookie')
                .map((h) => h.value).find((v) => /jobfind_rt=/.test(v)) || '';
            const match = /^([^=;\s]*jobfind_rt)=([^;]*)/.exec(setCookie);
            if (match && match[2]) {
                pm.environment.set('refreshCookieName', match[1]);
                pm.environment.set(refreshVar, match[2]);
            }
        };
        const login = () => pm.sendRequest({
            url: base + '/api/login',
            method: 'POST',
            header: { 'Content-Type': 'application/json', Origin: origin },
            body: { mode: 'raw', raw: JSON.stringify({ identifier: pm.environment.get(accounts[account][0]), password: pm.environment.get(accounts[account][1]) }) }
        }, (err, res) => {
            if (err || res.code !== 200) {
                console.warn('Đăng nhập lại ' + account + ' thất bại', err || res.code);
                return;
            }
            pm.environment.set(accessVar, res.json().token);
            pm.environment.set(account + 'UserId', res.json().user.id);
            saveRefresh(res);
            console.log('Đã đăng nhập lại: ' + accessVar + ', ' + refreshVar);
        });
        const refreshToken = pm.environment.get(refreshVar);
        if (!refreshToken) {
            login();
        } else {
            pm.sendRequest({
                url: base + '/api/auth/refresh',
                method: 'POST',
                header: { Origin: origin, Cookie: (pm.environment.get('refreshCookieName') || 'jobfind_rt') + '=' + refreshToken }
            }, (err, res) => {
                const body = !err && res.code === 200 ? res.json() : null;
                const expected = pm.environment.get(account + 'UserId');
                if (body && body.token && (!expected || String(body.user && body.user.id) === String(expected))) {
                    pm.environment.set(accessVar, body.token);
                    saveRefresh(res);
                    console.log('Đã làm mới ' + accessVar + ' bằng ' + refreshVar);
                } else {
                    console.log(refreshVar + ' hết hạn hoặc đã bị thu hồi: đăng nhập lại.');
                    pm.environment.set(refreshVar, '');
                    login();
                }
            });
        }
    }
});
export const collectionTest = script(() => {
    // Kiem tra chung cho moi response di qua API Gateway. Tren production chi /api va
    // /socket.io di qua Gateway; duong dan khac la giao dien React do Caddy phuc vu.
    const viaGateway = pm.environment.get('opsEndpoints') === 'true' || /^\/(api|socket\.io)\//.test(pm.request.url.getPath());
    if (viaGateway) {
        pm.test('[chung] Gateway gắn X-Correlation-Id', () => {
            pm.expect(pm.response.headers.get('X-Correlation-Id')).to.match(/^[A-Za-z0-9._:-]{1,128}$/);
        });
    }
    // Access token con han nhung da bi thu hoi (dang xuat moi thiet bi, doi mat khau, khoa
    // tai khoan, doi JWT_SECRET...): xoa di de request ke tiep tu lam moi/dang nhap lai.
    const account = pm.environment.get('lastAccount');
    if (account && pm.response.code === 401) {
        pm.environment.set(account + 'AccessToken', '');
        console.log(account + 'AccessToken bị từ chối (401): đã xoá, request kế tiếp sẽ tự lấy token mới.');
    }
    const maxMs = Number(pm.environment.get('maxResponseMs') || 5000);
    pm.test('[chung] Thời gian phản hồi < ' + maxMs + ' ms', () => {
        pm.expect(pm.response.responseTime).to.be.below(maxMs);
    });
});
