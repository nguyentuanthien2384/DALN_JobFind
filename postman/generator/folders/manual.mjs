// Second collection: hand-made registrations, interview invitations, offers, rejections and
// stage moves. Step 1 runs the real endpoint with ?dryRun=true (same checks, email preview,
// nothing saved or sent) and stores the exact body; step 2 sends only that checked body.
import { script, req, folder, lines, ok } from '../lib.mjs';

const VISUAL = `<style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;margin:12px}
.box{padding:10px 12px;border-radius:6px;margin-bottom:12px}
.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}.bad{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
table{border-collapse:collapse;width:100%;margin-bottom:12px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f9fafb;width:220px}iframe{width:100%;height:900px;border:1px solid #d1d5db;border-radius:6px}
</style>
<div class="box {{#if ok}}ok{{else}}bad{{/if}}"><b>{{title}}</b><br>{{message}}</div>
{{#if rows.length}}<table>{{#each rows}}<tr><th>{{label}}</th><td>{{value}}</td></tr>{{/each}}</table>{{/if}}
{{#if html}}<h4>Email sẽ gửi (xem trước, chưa gửi)</h4><iframe srcdoc="{{html}}"></iframe>{{/if}}`;

// Helpers available to the scripts below: show(...) renders the Visualize tab.
const showHelper = script(() => {
    const show = (ok, title, message, rows, html) => pm.visualizer.set(__VISUAL__, { ok, title, message, rows: rows || [], html: html || '' });
}, { VISUAL: JSON.stringify(VISUAL) });

const reasonText = script(() => {
    const reasons = {
        email_not_configured: 'Server chưa cấu hình hộp thư gửi đi (EMAIL_APP): thư nằm trong hàng đợi, chưa gửi được',
        invalid_recipient: 'Email ứng viên không hợp lệ: sẽ không gửi',
        invalid_reply_to: 'Email HR (Reply-To) không hợp lệ: sẽ không gửi',
        placeholder_recipient_in_production: 'Địa chỉ mẫu (example..., .test): production bỏ qua, không gửi',
        no_safe_demo_recipient: 'Địa chỉ mẫu nhưng chưa có hộp thư demo để chuyển tới: không gửi'
    };
});

// Step 2 runs only with a body that passed step 1 less than 15 minutes ago.
const gate = (key, stepName) => script(() => {
    const checked = pm.environment.get('__KEY__Body');
    const at = Number(pm.environment.get('__KEY__At') || 0);
    if (!checked) {
        console.log('KHÔNG GỬI "' + pm.info.requestName + '": chưa có dữ liệu kiểm tra đạt. Chạy "__STEP__" và sửa đến khi đạt.');
        pm.execution.skipRequest();
    } else if (Date.now() - at > 15 * 60000) {
        pm.environment.unset('__KEY__Body');
        console.log('KHÔNG GỬI "' + pm.info.requestName + '": kết quả kiểm tra đã quá 15 phút. Chạy lại "__STEP__".');
        pm.execution.skipRequest();
    }
}, { KEY: key, STEP: stepName });
const consume = (key) => script(() => {
    // Moi lan kiem tra chi cho gui that mot lan: bam Send lan nua phai kiem tra lai.
    pm.environment.unset('__KEY__Body');
    pm.environment.unset('__KEY__At');
}, { KEY: key });

// ---------- registration ----------
const registerCheck = req('Bước 1 - Kiểm tra trước (không tạo tài khoản)', {
    method: 'POST', path: '/api/create-new-user?dryRun=true',
    description: lines(
        'Sửa body rồi Send. roleCode: CANDIDATE (ứng viên) hoặc EMPLOYER (nhà tuyển dụng, tạo công ty sau khi đăng nhập).',
        'Server chạy đúng các bước kiểm tra như khi đăng ký thật (dữ liệu, trùng số điện thoại, trùng email) nhưng KHÔNG tạo tài khoản.',
        'Xem kết quả ở tab Visualize. Đạt thì sang Bước 2.'
    ),
    body: '{\n  "roleCode": "CANDIDATE",\n  "firstName": "Nguyễn",\n  "lastName": "Văn A",\n  "phonenumber": "Nhập 10 chữ số",\n  "email": "Nhập email thật",\n  "password": "Ít nhất 8 ký tự"\n}',
    test: [...showHelper, ...script(() => {
        const body = pm.response.json();
        const passed = pm.response.code === 200 && body.errCode === 0 && body.dryRun === true;
        pm.test('Kiểm tra đạt: có thể tạo tài khoản', () => pm.expect(passed, body.errMessage).to.be.true);
        if (passed) {
            pm.environment.set('manualRegisterBody', pm.variables.replaceIn(pm.request.body.raw));
            pm.environment.set('manualRegisterAt', Date.now());
            const p = body.preview;
            show(true, 'Dữ liệu hợp lệ - CHƯA tạo tài khoản', 'Bấm Bước 2 để tạo thật với đúng dữ liệu này (trong 15 phút).', [
                { label: 'Vai trò', value: p.roleCode }, { label: 'Họ tên', value: p.firstName + ' ' + p.lastName },
                { label: 'Số điện thoại (đăng nhập)', value: p.phonenumber }, { label: 'Email', value: p.email },
                { label: 'Email mật khẩu tạm', value: p.passwordEmail || 'Không (người dùng tự đặt mật khẩu)' }
            ]);
        } else {
            pm.environment.unset('manualRegisterBody');
            const errors = body.fieldErrors || {};
            show(false, 'Chưa đạt - sửa rồi Send lại', body.errMessage || 'Lỗi không xác định',
                Object.keys(errors).map((field) => ({ label: field, value: errors[field] })));
        }
    })]
});
const registerReal = req('Bước 2 - Tạo tài khoản thật (đúng dữ liệu đã kiểm tra)', {
    method: 'POST', path: '/api/create-new-user', body: '{{manualRegisterBody}}', pre: gate('manualRegister', 'Bước 1 - Kiểm tra trước'),
    description: 'Gửi đúng body đã kiểm tra đạt ở Bước 1 (biến manualRegisterBody). Không sửa body ở đây.',
    test: [...ok(() => {
        const sent = JSON.parse(pm.variables.replaceIn(pm.request.body.raw));
        pm.test('Đã tạo tài khoản', () => pm.expect(pm.response.json().message).to.eql('Tạo tài khoản thành công'));
        pm.environment.set('manualLoginPhone', sent.phonenumber);
        pm.environment.set('manualLoginPassword', sent.password || '');
    }), ...consume('manualRegister')]
});
const registerLogin = req('Bước 3 - Đăng nhập thử tài khoản vừa tạo', {
    method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' },
    body: '{\n  "identifier": "{{manualLoginPhone}}",\n  "password": "{{manualLoginPassword}}"\n}',
    test: [...showHelper, ...ok(() => {
        const user = pm.response.json().user;
        // Khong de mat khau tai khoan that nam lai trong environment.
        pm.environment.unset('manualLoginPassword');
        show(true, 'Đăng nhập được', 'Tài khoản đã hoạt động (mật khẩu đã được xoá khỏi environment).', [
            { label: 'Mã người dùng', value: user.id }, { label: 'Vai trò', value: user.roleCode },
            { label: 'Họ tên', value: [user.firstName, user.lastName].join(' ') }, { label: 'Email', value: user.email }
        ]);
    })]
});

// ---------- applications ----------
// Dry-run result of an application action: who receives what, before anything is sent.
const applicationCheck = (key) => [...showHelper, ...reasonText, ...script(() => {
    const body = pm.response.json();
    const passed = pm.response.code === 200 && body.errCode === 0 && body.dryRun === true;
    pm.test('Kiểm tra đạt: chưa lưu, chưa gửi', () => pm.expect(passed, body.errMessage).to.be.true);
    if (!passed) {
        pm.environment.unset('__KEY__Body');
        show(false, 'Chưa đạt - sửa rồi Send lại', (body.errMessage || 'Lỗi không xác định') + ' (HTTP ' + pm.response.code + ')');
    } else {
        const app = body.data;
        const preview = body.preview;
        const email = preview.email;
        pm.environment.set('__KEY__Body', pm.variables.replaceIn(pm.request.body.raw));
        pm.environment.set('__KEY__At', Date.now());
        pm.environment.set('__KEY__AppId', app.id);
        const rows = [
            { label: 'Hồ sơ', value: '#' + app.id + ' - ' + (app.job_title || '') },
            { label: 'Ứng viên', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
            { label: 'Giai đoạn', value: preview.fromStage + ' → ' + preview.toStage },
            { label: 'Thông báo trong ứng dụng', value: preview.inApp ? preview.inApp.content : 'Không có' }
        ];
        if (email) {
            rows.push({ label: 'Email gửi tới', value: email.to ? email.to + (email.demo ? ' (địa chỉ mẫu ' + email.originalTo + ' được chuyển về hộp thư demo)' : '') : '(không có)' });
            rows.push({ label: 'Gửi được không', value: email.willSend ? 'Có' : 'Không: ' + (reasons[email.reason] || email.reason) });
            rows.push({ label: 'Tiêu đề', value: email.subject });
            if (email.replyTo) rows.push({ label: 'Ứng viên trả lời tới (Reply-To)', value: email.replyTo });
        } else {
            rows.push({ label: 'Email', value: preview.previewError || 'Bước này không gửi email' });
        }
        show(true, 'Đạt - CHƯA lưu và CHƯA gửi email', body.errMessage + '. Kiểm tra kỹ người nhận và nội dung, rồi chạy bước gửi thật trong 15 phút.',
            rows, email ? email.html : '');
    }
}, { KEY: key })];

const applicationReal = (key, check) => [...ok(() => {
    const body = pm.response.json();
    if (body.emailQueued !== undefined) pm.test('Đã lưu và xếp email vào hàng đợi gửi', () => pm.expect(body.emailQueued).to.be.true);
    pm.test('Giai đoạn hồ sơ sau khi gửi: ' + body.data.stage, () => pm.expect(body.data.stage).to.be.a('string'));
}), ...script(check), ...consume(key)];

const datesPre = script(() => {
    // Goi y ngay theo gio Viet Nam; co the thay bang ngay cu the trong body (YYYY-MM-DD).
    const vnDate = (days) => new Date(Date.now() + days * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    pm.environment.set('suggestedInterviewDate', vnDate(7));
    pm.environment.set('suggestedConfirmBy', vnDate(5) + 'T17:00');
    pm.environment.set('suggestedStartDate', vnDate(21));
    pm.environment.set('suggestedResponseDeadline', vnDate(14) + 'T17:00');
});

const interviewBody = JSON.stringify({
    message: 'Lời nhắn thêm cho ứng viên (không bắt buộc)',
    interview: {
        companyName: 'Tên công ty', interviewDate: '{{suggestedInterviewDate}}', interviewTime: '09:30', durationMinutes: '60',
        timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'onsite', location: 'Địa chỉ phỏng vấn cụ thể',
        round: 'Vòng 1 - Chuyên môn', interviewers: 'Người phỏng vấn', preparation: 'Ứng viên cần chuẩn bị gì',
        contactName: 'Người liên hệ HR', contactEmail: '{{hrContactEmail}}', contactPhone: '0900000000', confirmBy: '{{suggestedConfirmBy}}'
    }
}, null, 2);
const offerBody = JSON.stringify({
    decision: 'accepted',
    message: 'Lời nhắn thêm cho ứng viên (không bắt buộc)',
    offer: {
        companyName: 'Tên công ty', startDate: '{{suggestedStartDate}}', startTime: '08:30', timeZone: 'Asia/Ho_Chi_Minh',
        responseDeadline: '{{suggestedResponseDeadline}}', workMode: 'onsite', location: 'Địa điểm nhận việc cụ thể',
        contactName: 'Người liên hệ HR', contactEmail: '{{hrContactEmail}}', contactPhone: '0900000000',
        workSchedule: 'Thứ Hai - Thứ Sáu, 08:30 - 17:30', salary: 'Mức lương (ghi rõ gross/net)', probation: 'Thời gian thử việc',
        benefits: 'Phúc lợi', requiredDocuments: 'Giấy tờ cần mang', onboardingInstructions: 'Hướng dẫn ngày đầu đi làm'
    }
}, null, 2);

const needApplication = script(() => {
    if (!/^[1-9][0-9]*$/.test(String(pm.environment.get('manualApplicationId') || ''))) {
        console.log('Chưa chọn hồ sơ: đặt biến manualApplicationId (xem thư mục 2 - Chọn hồ sơ ứng tuyển).');
        pm.execution.skipRequest();
    }
});

const actionFolder = ({ name, description, key, method, action, body, after }) => folder(name, description, [
    req('Bước 1 - Kiểm tra trước (không lưu, không gửi email)', {
        method, path: `/api/applications/{{manualApplicationId}}/${action}?dryRun=true`, token: 'recruiter', body, pre: needApplication,
        description: 'Sửa body rồi Send. Server kiểm tra như khi gửi thật nhưng không lưu gì, không gửi gì; tab Visualize hiện người nhận và bản xem trước email.',
        test: applicationCheck(key)
    }),
    req('Bước 2 - Gửi thật (đúng dữ liệu đã kiểm tra)', {
        method, path: `/api/applications/{{${key}AppId}}/${action}`, token: 'recruiter', body: `{{${key}Body}}`,
        pre: gate(key, 'Bước 1 - Kiểm tra trước'),
        description: `Gửi đúng body và hồ sơ đã kiểm tra đạt ở Bước 1 (biến ${key}Body, ${key}AppId). Không sửa body ở đây.`,
        test: applicationReal(key, after)
    })
], { pre: datesPre });

const recruiterMe = req('Tài khoản nhà tuyển dụng đang dùng', { path: '/api/auth/me', token: 'recruiter', test: [...showHelper, ...ok(() => {
    const me = pm.response.json().data;
    pm.test('Là nhà tuyển dụng có công ty đã duyệt', () => {
        pm.expect(me.roleCode).to.be.oneOf(['COMPANY', 'EMPLOYER', 'ADMIN']);
        if (me.roleCode !== 'ADMIN') pm.expect(me.companyCensorCode).to.eql('CS1');
    });
    show(true, 'Thao tác bằng tài khoản này', 'Đổi recruiterPhone/recruiterPassword trong environment để dùng tài khoản khác.', [
        { label: 'Mã người dùng', value: me.userId }, { label: 'Vai trò', value: me.roleCode }, { label: 'Công ty', value: me.companyId }
    ]);
})] });
const applicationList = req('Danh sách hồ sơ của công ty (tìm theo tên hoặc email)', {
    path: '/api/applications?q={{manualSearch}}&limit=50', token: 'recruiter',
    description: 'Đặt biến manualSearch để lọc (để trống = tất cả). Chép số ở cột "Mã hồ sơ" vào biến manualApplicationId.',
    test: [...showHelper, ...ok(() => {
        const rows = pm.response.json().data.map((a) => ({
            label: 'Mã hồ sơ ' + a.id,
            value: (a.candidate_name || '') + ' <' + (a.candidate_email || '') + '> · ' + (a.job_title || '') + ' · ' + a.stage
        }));
        show(true, pm.response.json().count + ' hồ sơ', 'Chọn một mã hồ sơ rồi đặt vào biến manualApplicationId.', rows);
    })]
});
const applicationDetail = req('Hồ sơ đang chọn (manualApplicationId)', {
    path: '/api/applications/{{manualApplicationId}}', token: 'recruiter',
    test: [...showHelper, ...ok(() => {
        const app = pm.response.json().data;
        const last = app.latestDecision;
        show(true, 'Hồ sơ #' + app.id, 'Kiểm tra đúng người trước khi gửi thư.', [
            { label: 'Ứng viên', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
            { label: 'Tin tuyển dụng', value: app.job_title },
            { label: 'Giai đoạn hiện tại', value: app.stage },
            { label: 'Thư gần nhất', value: last ? last.decision + ' lúc ' + last.requestedAt : 'Chưa gửi thư nào' }
        ].concat(app.timeline.slice(0, 5).map((e) => ({ label: 'Lịch sử ' + e.created_at, value: (e.from_stage || '') + ' → ' + e.to_stage + ' · ' + (e.reason || '') }))));
    })]
});

const manualFolders = [
    folder('1 - Đăng ký tài khoản', lines(
        'Bước 1 kiểm tra dữ liệu với server mà không tạo gì; Bước 2 tạo thật đúng dữ liệu đó; Bước 3 đăng nhập thử.',
        'Mỗi lần kiểm tra đạt chỉ cho tạo thật một lần, trong 15 phút.'
    ), [registerCheck, registerReal, registerLogin]),
    folder('2 - Chọn hồ sơ ứng tuyển để thao tác', lines(
        'Dùng tài khoản nhà tuyển dụng recruiterPhone/recruiterPassword (mặc định: nhà tuyển dụng công ty B).',
        'Tìm hồ sơ, đặt mã hồ sơ vào biến manualApplicationId, xem lại đúng ứng viên trước khi gửi thư.'
    ), [recruiterMe, applicationList, applicationDetail]),
    actionFolder({
        name: '3 - Mời phỏng vấn (hẹn lịch)', key: 'manualInterview', method: 'POST', action: 'interview-invitation', body: interviewBody,
        description: lines(
            'interviewMode: onsite (cần location), online (cần meetingUrl), phone (cần contactPhone). Ngày giờ theo giờ Việt Nam.',
            'Ngày gợi ý {{suggestedInterviewDate}} là 7 ngày tới; có thể ghi ngày cụ thể dạng YYYY-MM-DD. confirmBy phải trước giờ phỏng vấn.',
            'Gửi thật: hồ sơ chuyển sang "phỏng vấn", ứng viên nhận email + thông báo, lịch hiện trong lịch phỏng vấn.'
        ),
        after: () => pm.test('Lưu thư mời phỏng vấn, hồ sơ ở bước phong_van', () => pm.expect(pm.response.json().data.stage).to.eql('phong_van'))
    }),
    actionFolder({
        name: '4 - Gửi thư mời nhận việc (trúng tuyển)', key: 'manualOffer', method: 'POST', action: 'decision-notification', body: offerBody,
        description: lines(
            'workMode: onsite hoặc hybrid (cần location), remote (cần meetingUrl). responseDeadline phải trước ngày nhận việc.',
            'Gửi thật: hồ sơ chuyển sang "đề nghị" (giữ "nhận việc" nếu đã xác nhận), ứng viên nhận thư mời nhận việc.'
        ),
        after: () => pm.test('Hồ sơ ở bước de_nghi hoặc nhan_viec', () => pm.expect(pm.response.json().data.stage).to.be.oneOf(['de_nghi', 'nhan_viec']))
    }),
    actionFolder({
        name: '5 - Gửi email từ chối', key: 'manualReject', method: 'POST', action: 'decision-notification',
        body: '{\n  "decision": "rejected",\n  "message": "Lời nhắn thêm cho ứng viên (không bắt buộc)"\n}',
        description: lines(
            'Hệ thống tự cảm ơn ứng viên đã tham gia phỏng vấn nếu hồ sơ từng có lịch phỏng vấn.',
            'Thêm "interviewed": false nếu ứng viên được mời nhưng không tham gia.'
        ),
        after: () => pm.test('Hồ sơ ở bước tu_choi', () => pm.expect(pm.response.json().data.stage).to.eql('tu_choi'))
    }),
    actionFolder({
        name: '6 - Chuyển giai đoạn hồ sơ (như kéo thả trên Kanban)', key: 'manualStage', method: 'PATCH', action: 'stage',
        body: '{\n  "stage": "dang_xem_xet",\n  "reason": "Ghi chú lý do (không bắt buộc)"\n}',
        description: lines(
            'stage: moi_ung_tuyen, dang_xem_xet, phong_van, de_nghi, nhan_viec, tu_choi.',
            'Bước 1 cho biết bước mới có gửi email/thông báo cho ứng viên không (ví dụ "mới ứng tuyển" thì không).'
        ),
        after: () => pm.test('Hồ sơ đã ở giai đoạn yêu cầu', () => pm.expect(pm.response.json().data.stage).to.eql(JSON.parse(pm.variables.replaceIn(pm.request.body.raw)).stage))
    })
];

export { manualFolders };
