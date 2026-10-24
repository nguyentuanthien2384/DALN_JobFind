// Opt-in writes that leave real data behind (allowSideEffects = true). Each one is
// bounded: a fixed job / fixed clientMessageId means repeated runs never add more rows.
import { script, req, folder, lines, expectStatus, ok } from '../lib.mjs';
import { applyBody } from './legacy.mjs';

const sideEffectGuard = script(() => {
    if (pm.environment.get('allowSideEffects') !== 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": đặt allowSideEffects = true để chạy luồng ghi thật.');
        pm.execution.skipRequest();
    }
});
const chatBody = (content) => `{\n  "v": 1,\n  "receiverId": {{employer2UserId}},\n  "content": "${content}",\n  "clientMessageId": "postman-chat-fixed-000001"\n}`;

const optionalWrites = folder('[Tùy chọn] Ghi dữ liệu thật: nộp CV, nhắn tin, link PayPal sandbox', lines(
    'CHỈ chạy khi chấp nhận để lại dữ liệu (allowSideEffects = true):',
    '- ứng viên kiểm thử nộp CV vào testNewApplyJobId (lần đầu tạo 1 hồ sơ thật, các lần sau báo trùng);',
    '  nhà tuyển dụng công ty B nhận thông báo + email (địa chỉ mẫu nên email chuyển về hộp thư dự án);',
    '- 1 tin nhắn cố định từ ứng viên kiểm thử tới nhà tuyển dụng B (clientMessageId cố định, không nhân bản);',
    '- 1 giao dịch PayPal sandbox ở trạng thái chờ (không trừ tiền, tự hết hạn).'
), [
    req('NTD công ty B: lấy id người nhận tin nhắn', { path: '/api/auth/me', token: 'employer2', test: ok(() => {
        pm.environment.set('employer2UserId', pm.response.json().data.userId);
    }) }),
    req('Ứng viên kiểm thử nộp CV vào tin mới (lần đầu tạo, sau đó báo trùng)', {
        method: 'POST', path: '/api/create-new-cv', token: 'testCandidate', body: applyBody('testNewApplyJobId'),
        test: script(() => {
            const body = pm.response.json();
            pm.test('Tạo mới (200, errCode 0) hoặc đã nộp trước đó (409, errCode 5)', () => {
                pm.expect(['200:0', '409:5']).to.include(pm.response.code + ':' + body.errCode);
            });
            pm.test('Có cvId', () => pm.expect(body.cvId).to.be.a('number'));
            pm.environment.set('newApplyCvId', body.cvId);
        })
    }),
    req('Hồ sơ mới xuất hiện trên Kanban công ty B (đồng bộ qua RabbitMQ)', {
        path: '/api/applications?jobId={{testNewApplyJobId}}&limit=100', token: 'employer2',
        pre: script(() => {
            const deadline = Date.now() + 20000;
            const poll = () => pm.sendRequest({
                url: pm.environment.get('baseUrl') + '/api/applications?jobId=' + pm.environment.get('testNewApplyJobId') + '&limit=100',
                header: { Authorization: 'Bearer ' + pm.environment.get('employer2AccessToken') }
            }, (err, res) => {
                const rows = (!err && res.code === 200 && res.json().data) || [];
                if (!rows.some((a) => a.legacy_cv_id === Number(pm.environment.get('newApplyCvId'))) && Date.now() < deadline) setTimeout(poll, 1500);
            });
            poll();
        }),
        test: ok(() => {
            const app = pm.response.json().data.find((a) => a.legacy_cv_id === Number(pm.environment.get('newApplyCvId')));
            pm.test('Có hồ sơ với legacy_cv_id = cvId', () => pm.expect(app).to.not.be.undefined);
            pm.test('Đúng ứng viên kiểm thử', () => pm.expect(app && app.candidate_id).to.eql(Number(pm.environment.get('testCandidateUserId'))));
        })
    }),
    req('Nhắn tin cho nhà tuyển dụng (idempotent theo clientMessageId)', {
        method: 'POST', path: '/api/send-chat-message', token: 'testCandidate', body: chatBody('[KIỂM THỬ Postman] Tin nhắn cố định của bộ test.'),
        test: ok(() => {
            const body = pm.response.json();
            pm.test('Tin nhắn có id, đúng người nhận', () => {
                pm.expect(body.data.id).to.be.a('number');
                pm.expect(body.data.receiverId).to.eql(Number(pm.environment.get('employer2UserId')));
            });
            pm.environment.set('fixedChatMessageId', body.data.id);
        })
    }),
    req('Gửi lại cùng clientMessageId -> trả tin cũ, không tạo thêm', {
        method: 'POST', path: '/api/send-chat-message', token: 'testCandidate', body: chatBody('[KIỂM THỬ Postman] Tin nhắn cố định của bộ test.'),
        test: ok(() => {
            const body = pm.response.json();
            pm.test('duplicate = true, cùng id', () => {
                pm.expect(body.duplicate).to.be.true;
                pm.expect(body.data.id).to.eql(Number(pm.environment.get('fixedChatMessageId')));
            });
        })
    }),
    req('Cùng clientMessageId nhưng nội dung khác -> 409', {
        method: 'POST', path: '/api/send-chat-message', token: 'testCandidate', body: chatBody('[KIỂM THỬ Postman] Nội dung khác'),
        test: expectStatus(409, () => pm.test('code = IDEMPOTENCY_CONFLICT', () => pm.expect(pm.response.json().code).to.eql('IDEMPOTENCY_CONFLICT')))
    }),
    req('Nhà tuyển dụng thấy tin nhắn trong hội thoại', { path: '/api/get-chat-conversation?partnerId={{testCandidateUserId}}', token: 'employer2', test: ok(() => {
        pm.test('Có tin nhắn cố định', () => pm.expect(pm.response.json().data.map((m) => m.id)).to.include(Number(pm.environment.get('fixedChatMessageId'))));
    }) }),
    req('Tạo link thanh toán PayPal sandbox', { path: '/api/get-payment-link?id=1&amount=1', token: 'employer', test: ok(() => {
        pm.test('Có link duyệt thanh toán của PayPal', () => pm.expect(JSON.stringify(pm.response.json().link || pm.response.json().data)).to.include('paypal.com'));
    }) })
], { pre: sideEffectGuard });

export { optionalWrites };
