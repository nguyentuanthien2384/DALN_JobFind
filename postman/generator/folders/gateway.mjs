import {
    script, req, folder, ok, expectStatus, expectError, contractError, loginGuard, recordLoginFailure, skipUnlessFlag, skipWhenFlag,
    saveRefreshToken
} from '../lib.mjs';

// Local tests talk to the gateway directly. On the VPS only /api and /socket.io pass
// through Caddy, so the gateway's operational endpoints must stay unreachable.
const opsOnly = skipUnlessFlag('opsEndpoints', 'server production không mở endpoint vận hành của Gateway ra Internet.');
const productionOnly = skipWhenFlag('opsEndpoints', 'chỉ kiểm tra khi chạy qua Caddy trên server production.');
const servesWebApp = () => {
    pm.test('Là giao diện React (HTML), không phải JSON của Gateway', () => {
        pm.expect(pm.response.headers.get('Content-Type')).to.include('text/html');
        pm.expect(pm.response.text()).to.include('<title>JobFind');
    });
    pm.test('Không có header của Gateway', () => pm.expect(pm.response.headers.has('X-Correlation-Id')).to.be.false);
};

// ---------- 00 ----------
const loginTest = (tokenVar, extra) => [
    ...script(() => {
        pm.test('HTTP 200', () => pm.response.to.have.status(200));
        const body = pm.response.json();
        pm.test('errCode = 0 và có JWT 3 phần', () => {
            pm.expect(body.errCode).to.eql(0);
            pm.expect(body.token.split('.')).to.have.lengthOf(3);
        });
        pm.test('Không trả mật khẩu, chặn cache', () => {
            pm.expect(body.user).to.not.have.property('password');
            pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store');
        });
        pm.test('Refresh token nằm trong cookie HttpOnly, không có trong JSON', () => {
            const cookie = pm.response.headers.all().filter((h) => h.key.toLowerCase() === 'set-cookie')
                .map((h) => h.value).find((v) => /jobfind_rt=/.test(v)) || '';
            pm.expect(cookie, 'thiếu Set-Cookie jobfind_rt').to.match(/HttpOnly/i);
            pm.expect(cookie).to.match(/SameSite=Lax/i);
            pm.expect(body).to.not.have.any.keys('refreshToken', 'refresh_token');
        });
        pm.environment.set('__TOKEN__', body.token);
        const remaining = Number(pm.response.headers.get('X-RateLimit-Remaining'));
        if (Number.isFinite(remaining)) pm.environment.set('loginFailures', 9 - remaining);
    }, { TOKEN: tokenVar }),
    ...saveRefreshToken(tokenVar.replace(/AccessToken$/, '')),
    ...script(extra)
];
const loginReq = (name, prefix, tokenVar, extra) => req(name, {
    method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' },
    body: `{\n  "identifier": "{{${prefix}Phone}}",\n  "password": "{{${prefix}Password}}"\n}`,
    test: loginTest(tokenVar, extra)
});

const decodeJwt = script(() => {
    const cryptoJs = require('crypto-js');
    const part = (segment) => {
        let value = segment.replace(/-/g, '+').replace(/_/g, '/');
        while (value.length % 4) value += '=';
        return JSON.parse(cryptoJs.enc.Base64.parse(value).toString(cryptoJs.enc.Utf8));
    };
});

const f00 = folder('Khởi động và xác thực: access token, refresh token', [
    'Kiểm tra API Gateway còn sống, rồi đăng nhập 5 tài khoản. Mỗi lần đăng nhập lưu 2 biến:',
    '- <tài khoản>AccessToken: JWT trong body (sống 15 phút), các request khác dùng ở tab Authorization -> Bearer Token;',
    '- <tài khoản>RefreshToken: giá trị cookie HttpOnly jobfind_rt trong header Set-Cookie (API không trả nó trong JSON).',
    'Cuối thư mục có ví dụ đọc nội dung access token và làm mới nó bằng refresh token. Khi chạy các thư mục khác,',
    'collection tự làm mới access token sắp hết hạn bằng refresh token; chỉ đăng nhập lại khi refresh token không còn dùng được.'
].join('\n'), [
    req('Gateway - trang gốc', { path: '/', pre: opsOnly, test: expectStatus(200, () => {
        const body = pm.response.json();
        pm.test('Đúng service api-gateway', () => {
            pm.expect(body.status).to.eql('ok');
            pm.expect(body.service).to.eql('api-gateway');
        });
    }) }),
    req('Gateway - liveness /healthz', { path: '/healthz', pre: opsOnly, test: expectStatus(200, () => {
        pm.test('status = ok', () => pm.expect(pm.response.json()).to.eql({ status: 'ok', service: 'api-gateway' }));
    }) }),
    req('Gateway - readiness /readyz (MySQL + Redis)', { path: '/readyz', pre: opsOnly, test: expectStatus(200, () => {
        pm.test('status = ready', () => pm.expect(pm.response.json().status).to.eql('ready'));
    }) }),
    req('Production: trang chủ HTTPS là giao diện React', { path: '/', pre: productionOnly, test: [...expectStatus(200, servesWebApp), ...script(() => {
        pm.test('Bật HSTS', () => pm.expect(pm.response.headers.get('Strict-Transport-Security')).to.include('max-age='));
        pm.test('Chống nhúng iframe và đoán kiểu nội dung', () => {
            pm.expect(pm.response.headers.get('X-Frame-Options')).to.eql('SAMEORIGIN');
            pm.expect(pm.response.headers.get('X-Content-Type-Options')).to.eql('nosniff');
        });
    })] }),
    req('Production: /status của Gateway không lộ ra Internet', { path: '/status', pre: productionOnly, test: expectStatus(200, servesWebApp) }),
    req('Production: /metrics của Gateway không lộ ra Internet', { path: '/metrics', pre: productionOnly, test: expectStatus(200, servesWebApp) }),
    req('Production: /readyz của Gateway không lộ ra Internet', { path: '/readyz', pre: productionOnly, test: expectStatus(200, servesWebApp) }),
    loginReq('Đăng nhập - Admin', 'admin', 'adminAccessToken', () => {
        const user = pm.response.json().user;
        pm.test('Vai trò ADMIN', () => pm.expect(user.roleCode).to.eql('ADMIN'));
        pm.environment.set('adminUserId', user.id);
    }),
    loginReq('Đăng nhập - Nhà tuyển dụng (công ty A)', 'employer', 'employerAccessToken', () => {
        const user = pm.response.json().user;
        pm.test('Vai trò nhà tuyển dụng, công ty đã duyệt', () => {
            pm.expect(user.roleCode).to.be.oneOf(['COMPANY', 'EMPLOYER']);
            pm.expect(user.companyId).to.be.a('number');
            pm.expect(user.companyStatusCode).to.eql('S1');
            pm.expect(user.companyCensorCode).to.eql('CS1');
        });
        pm.environment.set('employerUserId', user.id);
        pm.environment.set('employerCompanyId', user.companyId);
    }),
    loginReq('Đăng nhập - Nhà tuyển dụng (công ty B)', 'employer2', 'employer2AccessToken', () => {
        const user = pm.response.json().user;
        pm.test('Thuộc công ty khác công ty A', () => {
            pm.expect(user.roleCode).to.be.oneOf(['COMPANY', 'EMPLOYER']);
            pm.expect(user.companyId).to.not.eql(Number(pm.environment.get('employerCompanyId')));
        });
        pm.environment.set('employer2UserId', user.id);
        pm.environment.set('employer2CompanyId', user.companyId);
    }),
    loginReq('Đăng nhập - Ứng viên', 'candidate', 'candidateAccessToken', () => {
        const user = pm.response.json().user;
        pm.test('Vai trò CANDIDATE', () => pm.expect(user.roleCode).to.eql('CANDIDATE'));
        pm.environment.set('candidateUserId', user.id);
        pm.environment.set('candidateName', [user.firstName, user.lastName].filter(Boolean).join(' '));
    }),
    loginReq('Đăng nhập - Ứng viên kiểm thử email (hộp thư thật)', 'testCandidate', 'testCandidateAccessToken', () => {
        const user = pm.response.json().user;
        pm.test('Vai trò CANDIDATE', () => pm.expect(user.roleCode).to.eql('CANDIDATE'));
        if (pm.environment.get('testInboxEmail')) {
            pm.test('Email tài khoản là hộp thư kiểm thử', () => pm.expect(String(user.email).toLowerCase()).to.eql(String(pm.environment.get('testInboxEmail')).toLowerCase()));
        }
        pm.environment.set('testCandidateUserId', user.id);
    }),
    req('Access token: nội dung JWT và quyền của tài khoản', {
        path: '/api/auth/me', token: 'candidate',
        description: 'Access token là JWT ký HS256, gắn với một phiên (sid) trong CSDL; vai trò và quyền luôn đọc lại từ CSDL.',
        test: [...ok(() => {
            const me = pm.response.json().data;
            pm.test('Đúng người, vai trò và quyền lấy từ CSDL', () => {
                pm.expect(me.userId).to.eql(Number(pm.environment.get('candidateUserId')));
                pm.expect(me.roleCode).to.eql('CANDIDATE');
                pm.expect(me.permissions).to.include('candidate:apply');
            });
        }), ...decodeJwt, ...script(() => {
            const [header, payload] = pm.environment.get('candidateAccessToken').split('.');
            const head = part(header);
            const claims = part(payload);
            pm.test('Header: thuật toán HS256', () => pm.expect(head.alg).to.eql('HS256'));
            pm.test('Payload: sub, sid (phiên), iss, aud', () => {
                pm.expect(String(claims.sub)).to.eql(String(pm.environment.get('candidateUserId')));
                pm.expect(claims.sid).to.be.a('string').and.not.empty;
                pm.expect(claims.iss).to.eql('jobfind-auth');
                pm.expect(claims.aud).to.eql('jobfind-api');
            });
            pm.test('Sống đúng 15 phút (exp - iat = 900 giây)', () => pm.expect(claims.exp - claims.iat).to.eql(900));
        })]
    }),
    req('Refresh token: làm mới access token (ứng viên)', {
        method: 'POST', path: '/api/auth/refresh',
        headers: { Origin: '{{origin}}', Cookie: '{{refreshCookieName}}={{candidateRefreshToken}}' },
        description: 'Trình duyệt tự gửi cookie; trong Postman, refresh token được gửi bằng header Cookie. Mỗi lần làm mới, server cấp refresh token mới và vô hiệu hoá token cũ (xoay vòng).',
        pre: script(() => {
            pm.environment.set('previousCandidateAccessToken', pm.environment.get('candidateAccessToken'));
            pm.environment.set('previousCandidateRefreshToken', pm.environment.get('candidateRefreshToken'));
        }),
        test: [...ok(() => {
            const body = pm.response.json();
            pm.test('Access token cấp lại cho đúng tài khoản', () => pm.expect(body.user.id).to.eql(Number(pm.environment.get('candidateUserId'))));
            pm.test('Không cache', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
            pm.environment.set('candidateAccessToken', body.token);
        }), ...decodeJwt, ...script(() => {
            // Refreshing in the same second as the login yields an identical JWT, so compare claims.
            const fresh = part(pm.environment.get('candidateAccessToken').split('.')[1]);
            const previous = part(pm.environment.get('previousCandidateAccessToken').split('.')[1]);
            pm.test('Cùng phiên đăng nhập (sid), hạn mới không sớm hơn hạn cũ', () => {
                pm.expect(fresh.sid).to.eql(previous.sid);
                pm.expect(fresh.exp).to.be.at.least(previous.exp);
            });
        }), ...saveRefreshToken('candidate'), ...script(() => {
            pm.test('Refresh token đã xoay vòng', () => {
                pm.expect(pm.environment.get('candidateRefreshToken')).to.be.a('string').and.not.empty;
                pm.expect(pm.environment.get('candidateRefreshToken')).to.not.eql(pm.environment.get('previousCandidateRefreshToken'));
            });
        })]
    }),
    req('Access token sau khi làm mới dùng được', { path: '/api/auth/me', token: 'candidate', test: ok(() => {
        pm.test('Vẫn là ứng viên đó', () => pm.expect(pm.response.json().data.userId).to.eql(Number(pm.environment.get('candidateUserId'))));
    }) }),
    req('Gateway - /status: 7 service và circuit breaker (ADMIN)', { path: '/status', token: 'admin', pre: opsOnly, test: expectStatus(200, () => {
        const body = pm.response.json();
        pm.test('Đúng schema', () => pm.response.to.have.jsonSchema({
            type: 'object', required: ['gateway', 'services', 'circuitBreakers'],
            properties: {
                gateway: { const: 'ok' },
                services: { type: 'array', items: { type: 'object', required: ['key', 'name', 'baseUrl', 'healthy'] } },
                circuitBreakers: { type: 'array', items: { type: 'object', required: ['service', 'state', 'stats'],
                    properties: { state: { enum: ['closed', 'open', 'halfOpen'] } } } }
            }
        }));
        const expected = ['support', 'identity', 'jobs', 'search', 'applications', 'admin', 'legacy'];
        pm.test('Đủ 7 đích định tuyến', () => pm.expect(body.services.map((s) => s.key)).to.have.members(expected));
        for (const service of body.services) {
            pm.test('Service ' + service.name + ' đang healthy', () => pm.expect(service.healthy, service.lastError || '').to.be.true);
        }
        pm.test('Không có circuit breaker nào đang mở', () => {
            pm.expect(body.circuitBreakers.filter((b) => b.state === 'open').map((b) => b.service)).to.eql([]);
        });
    }) })
]);

// ---------- 01 ----------
const f01 = folder('API Gateway: xác thực, phân quyền và hợp đồng', [
    'Kiểm tra các lớp bảo vệ nằm tập trung ở Gateway: JWT, RBAC, chặn giả mạo header danh tính,',
    'không mở /internal, chặn path traversal, kiểm tra hợp đồng OpenAPI (400/415), correlation id,',
    'rate limit, CORS và /metrics. Không request nào ở đây ghi dữ liệu.'
].join('\n'), [
    req('Không có token -> 401', { path: '/api/profile', test: expectError(401, 'Bạn cần đăng nhập') }),
    req('Token không phải JWT -> 401', { path: '/api/profile', headers: { Authorization: 'Bearer khong-phai-jwt' }, test: expectError(401, 'Bạn cần đăng nhập') }),
    req('Token bị sửa chữ ký -> 401', {
        path: '/api/profile', headers: { Authorization: 'Bearer {{forgedToken}}' },
        pre: script(() => {
            const token = pm.environment.get('candidateAccessToken') || 'a.b.c';
            const tail = token.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA';
            pm.environment.set('forgedToken', token.slice(0, -4) + tail);
        }),
        test: expectError(401, 'Bạn cần đăng nhập')
    }),
    req('Ứng viên gọi /status (chỉ ADMIN) -> 403', { path: '/status', token: 'candidate', pre: opsOnly, test: expectError(403, 'không có quyền') }),
    req('Ứng viên mở Kanban của nhà tuyển dụng -> 403', { path: '/api/applications/board', token: 'candidate', test: expectError(403, 'không có quyền') }),
    req('Nhà tuyển dụng xem báo cáo Admin -> 403', { path: '/api/admin/reports/overview', token: 'employer', test: expectError(403, 'không có quyền') }),
    req('Giả mạo header danh tính (x-user-role: ADMIN) -> vẫn 403', {
        path: '/api/admin/reports/overview', token: 'candidate',
        headers: { 'x-user-id': '{{adminUserId}}', 'x-user-role': 'ADMIN', 'x-internal-secret': 'doan-bua' },
        description: 'Gateway xoá x-user-*/x-internal-secret do client gửi rồi tự đặt lại từ JWT + DB.',
        test: expectError(403, 'không có quyền')
    }),
    req('Đường dẫn /internal không mở ra ngoài -> 404', { path: '/api/admin/internal/alias-map', token: 'admin', test: expectError(404, 'Không tìm thấy') }),
    req('Path traversal mã hoá (..%2f) -> 400', {
        path: '/api/search/..%2finternal%2freindex',
        test: expectError(400, 'Đường dẫn yêu cầu không hợp lệ')
    }),
    req('Route không có trong hợp đồng -> 404', { path: '/api/jobs/{{jobId}}/khong-ton-tai', test: expectError(404, 'Không tìm thấy API') }),
    req('Query sai kiểu (limit=abc) -> 400', { path: '/api/search/jobs?limit=abc', test: contractError() }),
    req('Query lạ ngoài hợp đồng -> 400', { path: '/api/search/jobs?hack=1', test: contractError() }),
    req('Sai Content-Type (text/plain) -> 415', {
        method: 'POST', path: '/api/profile/cvs', token: 'candidate',
        headers: { 'Content-Type': 'text/plain' }, body: 'xin chao',
        test: expectError(415, 'chỉ nhận application/json')
    }),
    req('X-Correlation-Id do client gửi được giữ nguyên', {
        path: '/api/search/facets', headers: { 'X-Correlation-Id': '{{clientCorrelationId}}' },
        pre: script(() => pm.environment.set('clientCorrelationId', 'postman-' + Date.now())),
        test: expectStatus(200, () => {
            pm.test('Response trả lại đúng id đã gửi', () => {
                pm.expect(pm.response.headers.get('X-Correlation-Id')).to.eql(pm.environment.get('clientCorrelationId'));
            });
        })
    }),
    req('Rate limit API công khai: header X-RateLimit-*', { path: '/api/search/facets', test: expectStatus(200, () => {
        pm.test('Hạn mức 120 request/phút/IP', () => pm.expect(pm.response.headers.get('X-RateLimit-Limit')).to.eql('120'));
        pm.test('Còn lại là số 0..119', () => {
            const remaining = Number(pm.response.headers.get('X-RateLimit-Remaining'));
            pm.expect(remaining).to.be.within(0, 119);
        });
    }) }),
    req('CORS: origin hợp lệ được cấp quyền', { path: '/api/search/facets', headers: { Origin: '{{origin}}' }, test: expectStatus(200, () => {
        pm.test('Access-Control-Allow-Origin = origin', () => pm.expect(pm.response.headers.get('Access-Control-Allow-Origin')).to.eql(pm.environment.get('origin')));
        pm.test('Cho phép credentials (cookie refresh)', () => pm.expect(pm.response.headers.get('Access-Control-Allow-Credentials')).to.eql('true'));
    }) }),
    req('CORS: origin lạ không được cấp quyền', { path: '/api/search/facets', headers: { Origin: 'http://evil.example' }, test: expectStatus(200, () => {
        pm.test('Không có Access-Control-Allow-Origin', () => pm.expect(pm.response.headers.has('Access-Control-Allow-Origin')).to.be.false);
    }) }),
    req('Socket.IO (chat, thông báo realtime): bắt tay với origin hợp lệ', {
        path: '/socket.io/?EIO=4&transport=polling', headers: { Origin: '{{origin}}' },
        test: expectStatus(200, () => {
            pm.test('Engine.IO trả sid và cho nâng cấp websocket', () => {
                const handshake = JSON.parse(pm.response.text().replace(/^\d+/, ''));
                pm.expect(handshake.sid).to.be.a('string').and.not.empty;
                pm.expect(handshake.upgrades).to.include('websocket');
            });
        })
    }),
    req('Socket.IO: origin lạ bị từ chối -> 403', {
        path: '/socket.io/?EIO=4&transport=polling', headers: { Origin: 'http://evil.example' },
        test: expectStatus(403, () => pm.test('Forbidden', () => pm.expect(pm.response.json().message).to.eql('Forbidden')))
    }),
    req('/metrics thiếu token Prometheus -> 403', { path: '/metrics', pre: opsOnly, test: expectError(403, 'Forbidden') }),
    req('Đăng nhập thiếu header Origin -> 403', {
        method: 'POST', path: '/api/login',
        body: '{\n  "identifier": "{{candidatePhone}}",\n  "password": "{{candidatePassword}}"\n}',
        pre: loginGuard,
        test: [...expectError(403, 'Invalid request origin'), ...recordLoginFailure]
    }),
    req('Đăng nhập sai mật khẩu -> 401', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' },
        body: '{\n  "identifier": "{{candidatePhone}}",\n  "password": "sai-mat-khau"\n}',
        pre: loginGuard,
        test: [...expectError(401, 'không chính xác', 2), ...recordLoginFailure]
    })
]);

export { loginTest, loginReq, f00 as startup, f01 as gateway };
