// Registration, sign-in/session/password security and user profile folders.
// Destructive auth flows (refresh reuse, logout-all, password change, ban) run on a
// dedicated "Postman" candidate account so demo accounts and browser sessions stay intact.
import {
    script, req, folder, lines, expectStatus, expectError, legacyError, legacyForbidden, ok,
    rateGuard, loginGuard, recordLoginFailure, saveRefreshCookie, saveRefreshToken, loginBody, skipUnlessFlag
} from '../lib.mjs';
import { loginTest } from './gateway.mjs';

const registerGuard = rateGuard('registerAttempts', 60, 6,
    'đã gọi đăng ký nhiều lần trong 1 giờ (backend giới hạn 10 lần/giờ/IP), để dành lượt cho người dùng thật.');
const registerCheckGuard = rateGuard('registerCheckAttempts', 15, 20,
    'đã kiểm tra đăng ký nhiều lần trong 15 phút (backend giới hạn 30 lần).');
const refreshGuard = rateGuard('refreshFailures', 15, 6,
    'đã có nhiều lần làm mới phiên thất bại trong 15 phút (backend giới hạn 10 lần), tránh khoá làm mới phiên.');
const otpRequestGuard = rateGuard('otpRequestAttempts', 15, 3, 'đã gọi xin OTP nhiều lần trong 15 phút (giới hạn 5 lần).');
const otpChangeGuard = rateGuard('otpChangeAttempts', 15, 3, 'đã gọi đổi mật khẩu bằng OTP nhiều lần trong 15 phút (giới hạn 5 lần).');

// Decode the session id (sid = familyId) from a JWT stored in an env variable.
const saveFamily = (tokenVar, familyVar) => script(() => {
    const cryptoJs = require('crypto-js');
    let part = String(pm.environment.get('__TOKEN__') || '').split('.')[1] || '';
    part = part.replace(/-/g, '+').replace(/_/g, '/');
    while (part.length % 4) part += '=';
    try {
        const payload = JSON.parse(cryptoJs.enc.Base64.parse(part).toString(cryptoJs.enc.Utf8));
        pm.environment.set('__FAMILY__', payload.sid);
    } catch (e) {
        pm.environment.unset('__FAMILY__');
    }
}, { TOKEN: tokenVar, FAMILY: familyVar });

// Sign the Postman account in without the cookie jar and keep its refresh cookie.
const pmLogin = (name, tokenVar, cookieVar, familyVar) => req(name, {
    method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' },
    body: loginBody('pmPhone', 'pmPassword'),
    test: [
        ...expectStatus(200, () => {
            const body = pm.response.json();
            pm.test('errCode = 0, đúng tài khoản Postman', () => {
                pm.expect(body.errCode).to.eql(0);
                pm.expect(body.user.id).to.eql(Number(pm.environment.get('pmUserId')));
            });
            pm.environment.set('__TOKEN__', body.token);
        }).map((l) => l.replace('__TOKEN__', tokenVar)),
        ...(cookieVar ? saveRefreshCookie(cookieVar) : []),
        ...(familyVar ? saveFamily(tokenVar, familyVar) : []),
        // The account's main session also keeps its refresh token for automatic renewal.
        ...(tokenVar === 'pmAccessToken' ? saveRefreshToken('pm') : [])
    ]
});
const meOk = (name, token) => req(name, { path: '/api/auth/me', token, test: ok(() => {
    pm.test('Đúng người dùng', () => pm.expect(pm.response.json().data.userId).to.eql(Number(pm.environment.get('pmUserId'))));
}) });
const meRevoked = (name, token, pre) => req(name, { path: '/api/auth/me', token, pre, test: script(() => {
    pm.test('HTTP 401 (phiên đã bị thu hồi)', () => pm.response.to.have.status(401));
    pm.test('Báo client làm mới/đăng nhập lại', () => pm.expect(pm.response.json().refresh).to.be.true);
}) });
const refresh = (name, cookieVar, test, { origin = true, pre } = {}) => req(name, {
    method: 'POST', path: '/api/auth/refresh', pre,
    headers: { ...(origin && { Origin: '{{origin}}' }), ...(cookieVar && { Cookie: `{{${cookieVar}}}` }) },
    test
});
const refreshRejected = script(() => {
    pm.test('HTTP 401', () => pm.response.to.have.status(401));
    const body = pm.response.json();
    pm.test('Phiên không hợp lệ, yêu cầu đăng nhập lại', () => {
        pm.expect(body.errMessage).to.eql('Phiên đăng nhập không hợp lệ');
        pm.expect(body.refresh).to.be.true;
    });
});

// Recovery for an earlier run that stopped half-way: unban the account and restore
// the original password, so this login always ends in a usable Postman account.
const pmRecovery = script(() => {
    const base = pm.environment.get('baseUrl');
    const origin = pm.environment.get('origin');
    const send = (path, body, token, callback) => pm.sendRequest({
        url: base + path, method: 'POST',
        header: Object.assign({ 'Content-Type': 'application/json', Origin: origin }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: { mode: 'raw', raw: JSON.stringify(body) }
    }, callback);
    const login = (password, callback) => send('/api/login', { identifier: pm.environment.get('pmPhone'), password }, null, callback);
    const restorePassword = () => login(pm.environment.get('pmPasswordAlt'), (err, res) => {
        if (err || res.code !== 200) return;
        send('/api/changepassword', { oldpassword: pm.environment.get('pmPasswordAlt'), password: pm.environment.get('pmPassword') },
            res.json().token, () => console.log('Đã khôi phục mật khẩu ban đầu của tài khoản Postman.'));
    });
    login(pm.environment.get('pmPassword'), (err, res) => {
        if (err || res.code === 200) return;
        const body = res.json();
        const userId = pm.environment.get('pmUserId');
        if (body.errCode === 1 && userId && pm.environment.get('adminAccessToken')) {
            send('/api/unban-user', { data: { id: Number(userId) } }, pm.environment.get('adminAccessToken'),
                () => console.log('Đã mở khoá tài khoản Postman bị khoá từ lần chạy trước.'));
        } else {
            restorePassword();
        }
    });
});

const register = folder('Đăng ký tài khoản', lines(
    'Đăng ký công khai (POST /api/create-new-user, backend cũ qua Gateway): kiểm tra số điện thoại,',
    'lỗi từng trường, chặn tự đăng ký ADMIN, trùng số điện thoại/email, rồi đăng nhập bằng số điện thoại',
    'và email. Chỉ tạo đúng MỘT tài khoản "Postman" (pmPhone) ở lần chạy đầu; các lần sau nhận lỗi trùng.',
    'Backend giới hạn 10 lần đăng ký/giờ/IP nên các request này tự bỏ qua khi đã gọi 6 lần trong 1 giờ.'
), [
    req('Số điện thoại đã có tài khoản -> true', { path: '/api/check-phonenumber-user?phonenumber={{candidatePhone}}', test: expectStatus(200, () => {
        pm.test('Trả về true', () => pm.expect(pm.response.json()).to.eql(true));
    }) }),
    req('Số điện thoại chưa dùng -> false', {
        path: '/api/check-phonenumber-user?phonenumber={{freshPhone}}',
        pre: script(() => pm.environment.set('freshPhone', '0998' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'))),
        test: expectStatus(200, () => pm.test('Trả về false', () => pm.expect(pm.response.json()).to.eql(false)))
    }),
    req('Dữ liệu sai -> báo lỗi từng trường (không tạo tài khoản)', {
        method: 'POST', path: '/api/create-new-user', pre: registerGuard,
        body: { roleCode: 'CANDIDATE', phonenumber: '12345', email: 'khong-phai-email', password: '123', firstName: ' ', lastName: '' },
        test: [...legacyError(4, 'Họ phải có từ 1 đến 100 ký tự'), ...script(() => {
            const errors = pm.response.json().fieldErrors;
            pm.test('Có lỗi cho đủ 5 trường', () => pm.expect(errors).to.have.all.keys('phonenumber', 'email', 'password', 'firstName', 'lastName'));
            pm.test('Thông báo cụ thể', () => {
                pm.expect(errors.phonenumber).to.eql('Số điện thoại phải gồm 10 chữ số');
                pm.expect(errors.password).to.eql('Mật khẩu phải có ít nhất 8 ký tự');
            });
        })]
    }),
    req('Tự đăng ký vai trò ADMIN -> bị chặn', {
        method: 'POST', path: '/api/create-new-user', pre: registerGuard,
        body: '{\n  "roleCode": "ADMIN",\n  "phonenumber": "{{freshPhone}}",\n  "email": "{{pmEmail}}",\n  "password": "{{pmPassword}}",\n  "firstName": "Leo",\n  "lastName": "Quyền"\n}',
        test: legacyError(3, 'Bạn không có quyền tạo tài khoản với vai trò này')
    }),
    req('Đăng ký tài khoản Postman (lần đầu tạo mới, sau đó báo trùng)', {
        method: 'POST', path: '/api/create-new-user', pre: registerGuard,
        body: '{\n  "roleCode": "CANDIDATE",\n  "phonenumber": "{{pmPhone}}",\n  "email": "{{pmEmail}}",\n  "password": "{{pmPassword}}",\n  "firstName": "{{pmFirstName}}",\n  "lastName": "{{pmLastName}}"\n}',
        test: expectStatus(200, () => {
            const body = pm.response.json();
            pm.test('Tạo mới (errCode 0) hoặc đã tồn tại (errCode 1)', () => pm.expect(body.errCode).to.be.oneOf([0, 1]));
            if (body.errCode === 0) pm.test('Thông báo tạo thành công', () => pm.expect(body.message).to.eql('Tạo tài khoản thành công'));
            else pm.test('Báo trùng số điện thoại', () => pm.expect(body.fieldErrors.phonenumber).to.eql('Số điện thoại đã tồn tại !'));
        })
    }),
    req('Đăng ký trùng email (số điện thoại khác) -> bị chặn', {
        method: 'POST', path: '/api/create-new-user', pre: registerGuard,
        body: '{\n  "roleCode": "CANDIDATE",\n  "phonenumber": "{{freshPhone}}",\n  "email": "{{pmEmail}}",\n  "password": "{{pmPassword}}",\n  "firstName": "Trùng",\n  "lastName": "Email"\n}',
        test: [...legacyError(4, 'Email này đã được sử dụng'), ...script(() => {
            pm.test('Lỗi gắn đúng trường email', () => pm.expect(pm.response.json().fieldErrors).to.have.property('email'));
        })]
    }),
    req('Kiểm tra trước (dryRun): dữ liệu hợp lệ -> chưa tạo tài khoản', {
        method: 'POST', path: '/api/create-new-user?dryRun=true',
        pre: [...script(() => {
            pm.environment.set('checkPhone', '0997' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'));
            pm.environment.set('checkEmail', 'postman-check-' + Date.now() + '@thiennt.id.vn');
        }), ...registerCheckGuard],
        body: '{\n  "roleCode": "EMPLOYER",\n  "phonenumber": "{{checkPhone}}",\n  "email": "{{checkEmail}}",\n  "password": "{{pmPassword}}",\n  "firstName": "Kiểm",\n  "lastName": "Trước"\n}',
        test: ok(() => {
            const body = pm.response.json();
            pm.test('Chỉ kiểm tra, chưa tạo', () => {
                pm.expect(body.dryRun).to.be.true;
                pm.expect(body.message).to.eql('Dữ liệu hợp lệ: có thể tạo tài khoản này (chưa tạo)');
            });
            pm.test('Tóm tắt tài khoản sẽ tạo', () => pm.expect(body.preview).to.include({
                roleCode: 'EMPLOYER', phonenumber: pm.environment.get('checkPhone'), email: pm.environment.get('checkEmail'), companyId: null, passwordEmail: null
            }));
        })
    }),
    req('Sau khi kiểm tra: số điện thoại vẫn chưa có tài khoản', {
        path: '/api/check-phonenumber-user?phonenumber={{checkPhone}}',
        test: expectStatus(200, () => pm.test('Trả về false (không tạo gì)', () => pm.expect(pm.response.json()).to.eql(false)))
    }),
    req('Kiểm tra trước (dryRun): trùng email -> errCode 4', {
        method: 'POST', path: '/api/create-new-user?dryRun=true', pre: registerCheckGuard,
        body: '{\n  "roleCode": "CANDIDATE",\n  "phonenumber": "{{checkPhone}}",\n  "email": "{{pmEmail}}",\n  "password": "{{pmPassword}}",\n  "firstName": "Trùng",\n  "lastName": "Email"\n}',
        test: legacyError(4, 'Email này đã được sử dụng')
    }),
    req('Đăng nhập tài khoản vừa đăng ký (số điện thoại)', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' }, body: loginBody('pmPhone', 'pmPassword'), pre: pmRecovery,
        description: 'Pre-request tự khôi phục nếu lần chạy trước dừng giữa chừng (tài khoản đang bị khoá hoặc đang ở mật khẩu tạm).',
        test: loginTest('pmAccessToken', () => {
            const user = pm.response.json().user;
            pm.test('Tài khoản ứng viên, đúng email đã đăng ký', () => {
                pm.expect(user.roleCode).to.eql('CANDIDATE');
                pm.expect(user.email).to.eql(String(pm.environment.get('pmEmail')).toLowerCase());
                pm.expect(user.companyId).to.eql(null);
            });
            pm.environment.set('pmUserId', user.id);
        })
    }),
    req('Đăng nhập bằng email', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' }, body: loginBody('pmEmail', 'pmPassword'),
        test: ok(() => pm.test('Cùng tài khoản', () => pm.expect(pm.response.json().user.id).to.eql(Number(pm.environment.get('pmUserId')))))
    }),
    req('Quyền của tài khoản mới (/api/auth/me)', { path: '/api/auth/me', token: 'pm', test: ok(() => {
        const me = pm.response.json().data;
        pm.test('Vai trò lấy từ DB, không có công ty', () => {
            pm.expect(me.roleCode).to.eql('CANDIDATE');
            pm.expect(me.companyId).to.eql(null);
        });
        pm.test('Có quyền ứng viên, không có quyền quản trị', () => {
            pm.expect(me.permissions).to.include.members(['account:self', 'candidate:apply', 'social:interact']);
            pm.expect(me.permissions).to.not.include('administration:manage');
            pm.expect(me.permissions).to.not.include('job:manage');
        });
    }) }),
    req('Tài khoản mới chưa có hồ sơ ứng tuyển', { path: '/api/my-applications', token: 'pm', test: ok(() => {
        pm.test('Danh sách rỗng', () => pm.expect(pm.response.json().count).to.eql(0));
    }) })
]);

const auth = folder('Đăng nhập, phiên làm việc và mật khẩu', lines(
    'Trên tài khoản Postman: phiên đăng nhập (access token 15 phút + refresh token trong cookie HttpOnly),',
    'xoay vòng refresh token và phát hiện dùng lại token cũ, thu hồi từng phiên, đăng xuất, đăng xuất mọi thiết bị,',
    'đổi mật khẩu (rồi đổi lại), quên mật khẩu/OTP (chỉ thử đầu vào sai), SSO và khoá/mở khoá tài khoản.',
    'Các request dùng cookie đều tắt cookie jar của Postman và gửi cookie thủ công để kết quả không phụ thuộc trình duyệt.'
), [
    pmLogin('Đăng nhập phiên A (giữ cookie refresh)', 'pmSessionAAccessToken', 'pmCookieA', 'pmFamilyA'),
    meOk('Access token phiên A dùng được', 'pmSessionA'),
    req('Danh sách phiên và sự kiện bảo mật', { path: '/api/auth/security', token: 'pmSessionA', test: ok(() => {
        const body = pm.response.json();
        const current = body.sessions.find((s) => s.current);
        pm.test('Phiên hiện tại là phiên A', () => pm.expect(current && current.familyId).to.eql(pm.environment.get('pmFamilyA')));
        pm.test('Không lộ hash token', () => body.sessions.forEach((s) => pm.expect(s).to.not.have.any.keys('tokenHash', 'refreshToken')));
        pm.test('Có lịch sử login_succeeded', () => pm.expect(body.events.map((e) => e.event)).to.include('login_succeeded'));
        pm.test('Không cache', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
    }) }),
    req('Lịch sử sự kiện bảo mật', { path: '/api/auth/security/events', token: 'pmSessionA', test: ok(() => {
        const events = pm.response.json().events;
        pm.test('Mảng sự kiện có id, event, createdAt', () => events.forEach((e) => pm.expect(e).to.include.keys('id', 'event', 'createdAt')));
    }) }),
    refresh('Làm mới phiên khi thiếu cookie -> 401', null, refreshRejected, { pre: refreshGuard }),
    refresh('Làm mới phiên thiếu header Origin -> 403', 'pmCookieA', expectError(403, 'Invalid request origin'), { origin: false }),
    refresh('Làm mới phiên: xoay vòng refresh token', 'pmCookieA', [
        ...ok(() => {
            const body = pm.response.json();
            pm.test('Có access token mới', () => pm.expect(body.token.split('.')).to.have.lengthOf(3));
            pm.test('Không cache', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
            pm.environment.set('pmSessionA2AccessToken', body.token);
        }),
        ...saveRefreshCookie('pmCookieA2'),
        ...script(() => pm.test('Refresh token đã đổi', () => pm.expect(pm.environment.get('pmCookieA2')).to.not.eql(pm.environment.get('pmCookieA'))))
    ]),
    meOk('Access token mới dùng được', 'pmSessionA2'),
    refresh('Dùng lại refresh token cũ -> 401 (phát hiện đánh cắp)', 'pmCookieA', [...refreshRejected, ...script(() => {
        pm.environment.set('pmReuseTested', 'true');
    })], { pre: [...script(() => pm.environment.set('pmReuseTested', 'false')), ...refreshGuard] }),
    meRevoked('Cả họ phiên bị thu hồi: token mới cũng mất hiệu lực', 'pmSessionA2',
        skipUnlessFlag('pmReuseTested', 'request dùng lại refresh token cũ đã bị bỏ qua.')),
    pmLogin('Đăng nhập phiên B', 'pmSessionBAccessToken', 'pmCookieB', 'pmFamilyB'),
    req('Sự kiện refresh_reuse_detected được ghi lại', { path: '/api/auth/security/events', token: 'pmSessionB', test: ok(() => {
        if (pm.environment.get('pmReuseTested') !== 'true') return;
        pm.test('Có sự kiện refresh_reuse_detected', () => pm.expect(pm.response.json().events.map((e) => e.event)).to.include('refresh_reuse_detected'));
    }) }),
    pmLogin('Đăng nhập phiên C', 'pmSessionCAccessToken', null, 'pmFamilyC'),
    req('Thu hồi phiên C từ phiên B', {
        method: 'DELETE', path: '/api/auth/sessions/{{pmFamilyC}}', token: 'pmSessionB', headers: { Origin: '{{origin}}' }, test: ok()
    }),
    meRevoked('Phiên C không dùng được nữa', 'pmSessionC'),
    req('Thu hồi phiên không tồn tại -> 404', {
        method: 'DELETE', path: '/api/auth/sessions/{{$guid}}', token: 'pmSessionB', headers: { Origin: '{{origin}}' },
        test: expectError(404, 'Không tìm thấy phiên')
    }),
    req('Thu hồi phiên thiếu header Origin -> 403', {
        method: 'DELETE', path: '/api/auth/sessions/{{pmFamilyB}}', token: 'pmSessionB', test: expectError(403, 'Invalid request origin')
    }),
    req('Đăng xuất phiên B', {
        method: 'POST', path: '/api/auth/logout', token: 'pmSessionB',
        headers: { Origin: '{{origin}}', Cookie: '{{pmCookieB}}' },
        test: script(() => {
            pm.test('HTTP 204', () => pm.response.to.have.status(204));
            pm.test('Xoá cookie refresh', () => {
                const cookies = pm.response.headers.all().filter((h) => h.key.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
                pm.expect(cookies).to.match(/jobfind_rt=;|Expires=Thu, 01 Jan 1970/);
            });
        })
    }),
    meRevoked('Sau đăng xuất: access token B bị từ chối', 'pmSessionB'),
    refresh('Sau đăng xuất: refresh token B bị từ chối', 'pmCookieB', refreshRejected, { pre: refreshGuard }),
    pmLogin('Đăng nhập phiên D', 'pmSessionDAccessToken'),
    pmLogin('Đăng nhập phiên E', 'pmSessionEAccessToken'),
    req('Đăng xuất mọi thiết bị (từ phiên D)', {
        method: 'POST', path: '/api/auth/logout-all', token: 'pmSessionD', headers: { Origin: '{{origin}}' },
        test: script(() => pm.test('HTTP 204', () => pm.response.to.have.status(204)))
    }),
    meRevoked('Phiên E cũng bị đăng xuất', 'pmSessionE'),
    meRevoked('Phiên D cũng bị đăng xuất', 'pmSessionD'),
    pmLogin('Đăng nhập lại để đổi mật khẩu', 'pmAccessToken'),
    req('Đổi mật khẩu: sai mật khẩu cũ -> errCode 2', {
        method: 'POST', path: '/api/changepassword', token: 'pm',
        body: '{\n  "oldpassword": "sai-mat-khau-cu",\n  "password": "{{pmPasswordAlt}}"\n}',
        test: legacyError(2, 'Mật khẩu cũ không chính xác')
    }),
    req('Đổi mật khẩu: mật khẩu mới dưới 8 ký tự -> errCode 5', {
        method: 'POST', path: '/api/changepassword', token: 'pm',
        body: '{\n  "oldpassword": "{{pmPassword}}",\n  "password": "123"\n}',
        test: legacyError(5, 'Mật khẩu phải có ít nhất 8 ký tự')
    }),
    req('Đổi mật khẩu thành công', {
        method: 'POST', path: '/api/changepassword', token: 'pm',
        body: '{\n  "oldpassword": "{{pmPassword}}",\n  "password": "{{pmPasswordAlt}}"\n}',
        test: ok()
    }),
    meRevoked('Đổi mật khẩu thu hồi mọi phiên cũ', 'pm'),
    req('Đăng nhập bằng mật khẩu cũ -> 401', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' }, body: loginBody('pmPhone', 'pmPassword'), pre: loginGuard,
        test: [...legacyError(2, 'không chính xác', 401), ...recordLoginFailure]
    }),
    req('Đăng nhập bằng mật khẩu mới', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' }, body: loginBody('pmPhone', 'pmPasswordAlt'),
        test: [...ok(() => pm.environment.set('pmAccessToken', pm.response.json().token)), ...saveRefreshToken('pm')]
    }),
    req('Đổi lại mật khẩu ban đầu', {
        method: 'POST', path: '/api/changepassword', token: 'pm',
        body: '{\n  "oldpassword": "{{pmPasswordAlt}}",\n  "password": "{{pmPassword}}"\n}',
        test: ok()
    }),
    pmLogin('Đăng nhập lại bằng mật khẩu ban đầu', 'pmAccessToken'),
    req('Quên mật khẩu: thiếu số điện thoại -> errCode 1', {
        method: 'POST', path: '/api/request-reset-password-otp', body: {}, pre: otpRequestGuard,
        test: legacyError(1, 'Thiếu số điện thoại')
    }),
    req('Quên mật khẩu: số điện thoại chưa đăng ký -> errCode 1', {
        method: 'POST', path: '/api/request-reset-password-otp', body: '{\n  "phonenumber": "{{freshPhone}}"\n}', pre: otpRequestGuard,
        test: legacyError(1, 'SĐT không tồn tại')
    }),
    req('Đặt lại mật khẩu bằng OTP: mật khẩu mới yếu -> errCode 5', {
        method: 'POST', path: '/api/changepasswordbyPhone', pre: otpChangeGuard,
        body: '{\n  "phonenumber": "{{pmPhone}}",\n  "password": "123",\n  "otp": "000000"\n}',
        test: legacyError(5, 'Mật khẩu phải có ít nhất 8 ký tự')
    }),
    req('Đặt lại mật khẩu bằng OTP sai -> errCode 2 (mật khẩu không đổi)', {
        method: 'POST', path: '/api/changepasswordbyPhone', pre: otpChangeGuard,
        body: '{\n  "phonenumber": "{{pmPhone}}",\n  "password": "{{pmPasswordAlt}}",\n  "otp": "000000"\n}',
        test: legacyError(2, 'Mã xác thực không đúng hoặc đã hết hạn')
    }),
    req('Nhà cung cấp đăng nhập SSO', { path: '/api/auth/providers', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có cờ bật/tắt cho từng nhà cung cấp', () => ['google', 'github', 'facebook', 'auth0'].forEach((p) => pm.expect(body[p]).to.be.a('boolean')));
    }) }),
    req('Bắt đầu SSO -> chuyển hướng tới nhà cung cấp (302)', {
        path: '/api/auth/sso/google/start', noRedirect: true,
        test: script(() => {
            pm.test('HTTP 302', () => pm.response.to.have.status(302));
            pm.test('Location là trang authorize HTTPS có state', () => {
                const location = pm.response.headers.get('Location') || '';
                pm.expect(location).to.match(/^https:\/\//);
                pm.expect(location).to.include('state=');
            });
        })
    }),
    req('Callback SSO giả mạo -> về trang đăng nhập báo lỗi', {
        path: '/api/auth/sso/google/callback?state=gia-mao&code=gia-mao', noRedirect: true,
        test: script(() => {
            pm.test('HTTP 303', () => pm.response.to.have.status(303));
            pm.test('Về /login?sso=...', () => pm.expect(pm.response.headers.get('Location') || '').to.match(/\/login\?sso=/));
        })
    }),
    req('Admin khoá tài khoản Postman', {
        method: 'POST', path: '/api/ban-user', token: 'admin', body: '{\n  "data": { "id": {{pmUserId}} }\n}',
        test: ok(() => pm.test('Thông báo đã ngừng kích hoạt', () => pm.expect(pm.response.json().message).to.include('ngừng kích hoạt')))
    }),
    req('Tài khoản bị khoá: token cũ bị từ chối', { path: '/api/auth/me', token: 'pm', test: script(() => {
        pm.test('HTTP 401 hoặc 403', () => pm.expect(pm.response.code).to.be.oneOf([401, 403]));
    }) }),
    req('Tài khoản bị khoá: không đăng nhập được', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' }, body: loginBody('pmPhone', 'pmPassword'), pre: loginGuard,
        test: [...legacyError(1, 'đã bị khóa', 401), ...recordLoginFailure]
    }),
    req('Admin thấy tài khoản ở trạng thái khoá', { path: '/api/get-all-user?limit=5&offset=0&search={{pmPhone}}', token: 'admin', test: ok(() => {
        const account = pm.response.json().data.find((a) => a.userId === Number(pm.environment.get('pmUserId')));
        pm.test('statusCode = S2', () => pm.expect(account && account.statusCode).to.eql('S2'));
    }) }),
    req('Chi tiết hồ sơ chỉ trả tài khoản đang hoạt động', { path: '/api/get-detail-user-by-id?id={{pmUserId}}', token: 'admin', test: legacyError(2, 'Không tìm thấy người dùng') }),
    req('Không phải admin thì không mở khoá được -> 403', {
        method: 'POST', path: '/api/unban-user', token: 'candidate', body: '{\n  "data": { "id": {{pmUserId}} }\n}', test: legacyForbidden()
    }),
    req('Admin mở khoá tài khoản', {
        method: 'POST', path: '/api/unban-user', token: 'admin', body: '{\n  "data": { "id": {{pmUserId}} }\n}', test: ok()
    }),
    pmLogin('Đăng nhập lại sau khi mở khoá', 'pmAccessToken')
]);

const users = folder('Người dùng: hồ sơ cá nhân, cài đặt tìm việc và quản trị', lines(
    'Sửa hồ sơ, cài đặt tìm việc và kỹ năng của chính mình (tài khoản Postman, khôi phục ở cuối),',
    'chặn sửa người khác/tự nâng quyền, quyền xem hồ sơ ứng viên của nhà tuyển dụng, danh sách người dùng của admin.',
    'Cài đặt tìm việc để isFindJob = 0 và isTakeMail = 0 để tài khoản Postman không hiện cho nhà tuyển dụng, không nhận email.'
), [
    req('Xem chi tiết tài khoản của mình', { path: '/api/get-detail-user-by-id?id={{pmUserId}}', token: 'pm', test: ok(() => {
        const account = pm.response.json().data;
        pm.test('Đúng tài khoản, không lộ mật khẩu', () => {
            pm.expect(account.userId).to.eql(Number(pm.environment.get('pmUserId')));
            pm.expect(account).to.not.have.property('password');
        });
        const user = account.userAccountData;
        pm.environment.set('pmOriginalProfile', JSON.stringify({
            firstName: user.firstName, lastName: user.lastName, address: user.address, genderCode: user.genderCode
        }));
    }) }),
    req('Ứng viên xem hồ sơ ứng viên khác -> 403', {
        path: '/api/get-detail-user-by-id?id={{candidateUserId}}', token: 'pm', test: legacyError(3, 'Bạn chưa mở quyền xem hồ sơ ứng viên này', 403)
    }),
    req('Cập nhật hồ sơ cá nhân', {
        method: 'PUT', path: '/api/update-user', token: 'pm',
        body: '{\n  "id": {{pmUserId}},\n  "firstName": "Kiểm Thử (đã sửa)",\n  "address": "123 Đường Kiểm Thử, Đà Nẵng",\n  "genderCode": "M"\n}',
        test: ok(() => {
            const user = pm.response.json().user;
            pm.test('Đã lưu đúng các trường', () => {
                pm.expect(user.firstName).to.eql('Kiểm Thử (đã sửa)');
                pm.expect(user.address).to.eql('123 Đường Kiểm Thử, Đà Nẵng');
                pm.expect(user.genderCode).to.eql('M');
            });
        })
    }),
    req('Tự nâng quyền qua update-user -> vai trò không đổi', {
        method: 'PUT', path: '/api/update-user', token: 'pm',
        body: '{\n  "id": {{pmUserId}},\n  "roleCode": "ADMIN",\n  "allowRoleChange": true,\n  "allowedRoleCodes": ["ADMIN"]\n}',
        test: ok(() => pm.test('Vẫn là CANDIDATE', () => pm.expect(pm.response.json().user.roleCode).to.eql('CANDIDATE')))
    }),
    req('Email sai định dạng -> errCode 4', {
        method: 'PUT', path: '/api/update-user', token: 'pm', body: '{\n  "id": {{pmUserId}},\n  "email": "khong-hop-le"\n}',
        test: legacyError(4, 'Email không hợp lệ')
    }),
    req('Sửa hồ sơ người khác -> 403', {
        method: 'PUT', path: '/api/update-user', token: 'pm', body: '{\n  "id": {{candidateUserId}},\n  "firstName": "Bị sửa"\n}',
        test: legacyError(3, 'Bạn không có quyền cập nhật hồ sơ của người dùng khác', 403)
    }),
    req('Khôi phục hồ sơ ban đầu', {
        method: 'PUT', path: '/api/update-user', token: 'pm',
        pre: script(() => {
            const original = JSON.parse(pm.environment.get('pmOriginalProfile'));
            pm.environment.set('pmRestoreBody', JSON.stringify(Object.assign({ id: Number(pm.environment.get('pmUserId')) }, original)));
        }),
        body: '{{pmRestoreBody}}',
        test: ok(() => {
            const original = JSON.parse(pm.environment.get('pmOriginalProfile'));
            const user = pm.response.json().user;
            pm.test('Hồ sơ trở về như cũ', () => Object.keys(original).forEach((key) => pm.expect(user[key]).to.eql(original[key])));
        })
    }),
    req('Lưu cài đặt tìm việc và kỹ năng', {
        method: 'PUT', path: '/api/setDataUserSetting', token: 'pm',
        body: '{\n  "id": {{pmUserId}},\n  "data": {\n    "categoryJobCode": "cong-nghe-thong-tin",\n    "salaryJobCode": "10-15tr",\n    "addressCode": "Đà Nẵng",\n    "experienceJobCode": "1-nam",\n    "isFindJob": 0,\n    "isTakeMail": 0,\n    "file": "",\n    "listSkills": [1, 9]\n  }\n}',
        description: 'Gửi đủ các trường như trang Cài đặt (kể cả file rỗng).',
        test: ok()
    }),
    req('Lưu lại cài đặt không đổi, không gửi file (lỗi đã sửa)', {
        method: 'PUT', path: '/api/setDataUserSetting', token: 'pm',
        body: '{\n  "id": {{pmUserId}},\n  "data": {\n    "categoryJobCode": "cong-nghe-thong-tin",\n    "isFindJob": 0,\n    "isTakeMail": 0\n  }\n}',
        description: 'Trước đây trường không gửi lên bị gán undefined, Sequelize sinh câu UPDATE rỗng và API trả errCode -1.',
        test: ok(() => pm.test('Ghi nhận lựa chọn', () => pm.expect(pm.response.json().errMessage).to.eql('Hệ thống đã ghi nhận lựa chọn')))
    }),
    req('Cài đặt và kỹ năng đã được lưu', { path: '/api/get-detail-user-by-id?id={{pmUserId}}', token: 'pm', test: ok(() => {
        const account = pm.response.json().data;
        const setting = account.userAccountData.userSettingData;
        pm.test('Đúng ngành, lương, kinh nghiệm', () => {
            pm.expect(setting.categoryJobCode).to.eql('cong-nghe-thong-tin');
            pm.expect(setting.salaryJobCode).to.eql('10-15tr');
            pm.expect(setting.experienceJobCode).to.eql('1-nam');
        });
        pm.test('Không bật tìm việc/nhận email', () => {
            pm.expect(Number(setting.isFindJob)).to.eql(0);
            pm.expect(Number(setting.isTakeMail)).to.eql(0);
        });
        pm.test('Có đúng 2 kỹ năng', () => pm.expect(account.listSkills).to.have.lengthOf(2));
    }) }),
    req('Thiếu dữ liệu cài đặt -> errCode 1', {
        method: 'PUT', path: '/api/setDataUserSetting', token: 'pm', body: '{\n  "id": {{pmUserId}}\n}', test: legacyError(1, 'Missing required parameters')
    }),
    req('Lưu cài đặt cho người khác -> 403', {
        method: 'PUT', path: '/api/setDataUserSetting', token: 'pm', body: '{\n  "id": {{candidateUserId}},\n  "data": {}\n}',
        test: legacyError(3, 'Bạn không có quyền cập nhật cài đặt của người dùng khác', 403)
    }),
    req('Nhà tuyển dụng xem hồ sơ ứng viên đã mở khoá', { path: '/api/get-detail-user-by-id?id={{viewedCandidateId}}', token: 'employer', test: ok(() => {
        pm.test('Đúng ứng viên', () => pm.expect(pm.response.json().data.userId).to.eql(Number(pm.environment.get('viewedCandidateId'))));
    }) }),
    req('Nhà tuyển dụng xem hồ sơ ứng viên chưa mở khoá -> 403', {
        path: '/api/get-detail-user-by-id?id={{pmUserId}}', token: 'employer', test: legacyError(3, 'Bạn chưa mở quyền xem hồ sơ ứng viên này', 403)
    }),
    req('Admin: tìm người dùng theo số điện thoại', { path: '/api/get-all-user?limit=5&offset=0&search={{pmPhone}}', token: 'admin', test: ok(() => {
        const body = pm.response.json();
        pm.test('Tìm thấy tài khoản Postman', () => pm.expect(body.data.map((a) => a.userId)).to.include(Number(pm.environment.get('pmUserId'))));
        pm.test('Không lộ mật khẩu', () => body.data.forEach((a) => pm.expect(a).to.not.have.property('password')));
    }) }),
    req('Admin: lọc người dùng theo vai trò', { path: '/api/get-all-user?limit=10&offset=0&roleCode=COMPANY', token: 'admin', test: ok(() => {
        pm.test('Mọi tài khoản là COMPANY', () => pm.response.json().data.forEach((a) => pm.expect(a.roleCode).to.eql('COMPANY')));
    }) }),
    req('Ứng viên xem danh sách người dùng -> 403', { path: '/api/get-all-user?limit=5&offset=0', token: 'candidate', test: legacyForbidden() }),
    req('Không có token -> 401', { path: '/api/get-all-user?limit=5&offset=0', test: script(() => {
        pm.test('HTTP 401', () => pm.response.to.have.status(401));
        pm.test('Yêu cầu đăng nhập lại', () => pm.expect(pm.response.json().refresh).to.be.true);
    }) })
]);

export { register, auth, users };
