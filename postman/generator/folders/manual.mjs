// Complete hand-made Postman suite -> Browser Sync for JobFind:
// 1. Account registration (dryRun + real + login)
// 2. Candidate personal profile, job search settings & online CV (MongoDB Identity)
// 3. Recruiter job posting (CQRS), Admin approval to public (PS1), job editing & closing
// 4. Candidate CV submission to a job -> automatic Kanban sync (manualApplicationId)
// 5. Selecting & inspecting an application on Kanban
// 6. Interview invitation (dryRun email preview + real send)
// 7. Job offer letter (dryRun email preview + real send)
// 8. Rejection email (dryRun email preview + real send)
// 9. Kanban stage transition (dryRun + real move)
// 10. Realtime 2-way Chat between Candidate & Recruiter
// 11. Candidate social actions: Save job, Follow company, Review company
import { script, req, folder, lines, ok, created } from '../lib.mjs';
import { CV_PDF_DATA_URL } from '../fixtures.mjs';

const VISUAL = `<style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;margin:12px}
.box{padding:10px 12px;border-radius:6px;margin-bottom:12px}
.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}.bad{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
table{border-collapse:collapse;width:100%;margin-bottom:12px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f9fafb;width:240px}iframe{width:100%;height:900px;border:1px solid #d1d5db;border-radius:6px}
</style>
<div class="box {{#if ok}}ok{{else}}bad{{/if}}"><b>{{title}}</b><br>{{message}}</div>
{{#if rows.length}}<table>{{#each rows}}<tr><th>{{label}}</th><td>{{value}}</td></tr>{{/each}}</table>{{/if}}
{{#if html}}<h4>Email sẽ gửi (xem trước, chưa gửi)</h4><iframe srcdoc="{{html}}"></iframe>{{/if}}`;

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
    pm.environment.unset('__KEY__Body');
    pm.environment.unset('__KEY__At');
}, { KEY: key });

// Ensure manualCandidateUserId is loaded in environment before requests that need it in body/query.
const ensureCandidateId = script(() => {
    const base = pm.environment.get('baseUrl');
    const token = pm.environment.get('manualCandidateAccessToken');
    pm.sendRequest({ url: base + '/api/auth/me', header: { Authorization: 'Bearer ' + token } }, (err, res) => {
        if (!err && res.code === 200 && res.json().data) {
            pm.environment.set('manualCandidateUserId', String(res.json().data.userId));
        }
    });
});

// ==================== 1. ĐĂNG KÝ TÀI KHOẢN ====================
const registerCheck = req('Bước 1 - Kiểm tra trước (không tạo tài khoản)', {
    method: 'POST', path: '/api/create-new-user?dryRun=true',
    description: lines(
        'Sửa phonenumber (10 số chưa dùng) và email (email thật của bạn) rồi bấm Send.',
        'roleCode: CANDIDATE (ứng viên) hoặc EMPLOYER (nhà tuyển dụng). Server kiểm tra trùng SĐT/email nhưng KHÔNG tạo tài khoản.'
    ),
    body: JSON.stringify({
        roleCode: 'CANDIDATE',
        firstName: 'Nguyễn',
        lastName: 'Văn An',
        phonenumber: '0988123456',
        email: 'email-that-cua-ban@gmail.com',
        password: 'User@123456'
    }, null, 2),
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
    description: 'Gửi đúng body đã kiểm tra đạt ở Bước 1. Nếu là CANDIDATE sẽ tự lưu vào manualCandidatePhone/manualCandidatePassword để dùng cho toàn bộ các mục ứng viên bên dưới.',
    test: [...showHelper, ...ok(() => {
        const sent = JSON.parse(pm.variables.replaceIn(pm.request.body.raw));
        pm.test('Đã tạo tài khoản', () => pm.expect(pm.response.json().message).to.eql('Tạo tài khoản thành công'));
        pm.environment.set('manualLoginPhone', sent.phonenumber);
        pm.environment.set('manualLoginPassword', sent.password || '');
        if (sent.roleCode === 'CANDIDATE' && sent.password) {
            pm.environment.set('manualCandidatePhone', sent.phonenumber);
            pm.environment.set('manualCandidatePassword', sent.password);
            pm.environment.set('manualCandidateAccessToken', '');
            pm.environment.set('manualCandidateRefreshToken', '');
        }
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Đã tạo tài khoản thật thành công', 'Bấm Bước 3 để kiểm tra đăng nhập, hoặc mở trình duyệt đăng nhập ngay.', [
            { label: 'Số điện thoại đăng nhập', value: sent.phonenumber },
            { label: 'Vai trò', value: sent.roleCode },
            { label: 'Tự gán cho tài khoản Ứng viên thao tác', value: sent.roleCode === 'CANDIDATE' ? 'Đã gán manualCandidatePhone = ' + sent.phonenumber : 'Không (chỉ áp dụng cho CANDIDATE)' },
            { label: 'Đăng nhập trên trình duyệt', value: webOrigin + '/login' }
        ]);
    }), ...consume('manualRegister')]
});
const registerLogin = req('Bước 3 - Đăng nhập thử tài khoản vừa tạo', {
    method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' },
    body: '{\n  "identifier": "{{manualLoginPhone}}",\n  "password": "{{manualLoginPassword}}"\n}',
    test: [...showHelper, ...ok(() => {
        const user = pm.response.json().user;
        const webOrigin = pm.environment.get('origin') || '';
        pm.environment.unset('manualLoginPassword');
        show(true, 'Đăng nhập được - Đã đồng bộ lên hệ thống', 'Bạn có thể dùng tài khoản này đăng nhập trên trình duyệt web hoặc tiếp tục các thư mục bên dưới.', [
            { label: 'Mã người dùng', value: user.id }, { label: 'Vai trò', value: user.roleCode },
            { label: 'Họ tên', value: [user.firstName, user.lastName].join(' ') }, { label: 'Email', value: user.email },
            { label: 'Mở trang đăng nhập trên trình duyệt', value: webOrigin + '/login' }
        ]);
    })]
});

// ==================== 2. HỒ SƠ CÁ NHÂN & TẠO CV ONLINE CỦA ỨNG VIÊN ====================
const candidateProfileView = req('Xem thông tin hồ sơ ứng viên hiện tại', {
    path: '/api/get-detail-user-by-id?id={{manualCandidateUserId}}', token: 'manualCandidate', pre: ensureCandidateId,
    description: 'Xem hồ sơ hiện tại của tài khoản manualCandidatePhone (đồng bộ với trang /candidate/info).',
    test: [...showHelper, ...ok(() => {
        const account = pm.response.json().data;
        const u = account.userAccountData || {};
        const setting = u.userSettingData || {};
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Hồ sơ ứng viên #' + account.userId, 'Dữ liệu hiện tại trên hệ thống của tài khoản manualCandidatePhone.', [
            { label: 'Số điện thoại', value: account.phonenumber },
            { label: 'Họ và tên', value: [u.firstName, u.lastName].filter(Boolean).join(' ') },
            { label: 'Email', value: u.email || '(chưa có)' },
            { label: 'Địa chỉ', value: u.address || '(chưa cập nhật)' },
            { label: 'Ngành nghề tìm việc', value: setting.categoryJobCode || '(chưa cài đặt)' },
            { label: 'Bật cho phép NTD tìm hồ sơ', value: Number(setting.isFindJob) === 1 ? 'Đang bật (1)' : 'Đang tắt (0)' },
            { label: 'Xem trên trình duyệt', value: webOrigin + '/candidate/info' }
        ]);
    })]
});
const candidateProfileUpdate = req('Cập nhật thông tin cá nhân ứng viên', {
    method: 'PUT', path: '/api/update-user', token: 'manualCandidate', pre: ensureCandidateId,
    description: 'Sửa họ tên, địa chỉ, giới tính (M = Nam, FE = Nữ), ngày sinh rồi bấm Send. Đồng bộ ngay lên trang Thông tin tài khoản.',
    body: JSON.stringify({
        id: '__CANDIDATE_ID__',
        firstName: 'Nguyễn',
        lastName: 'Văn An',
        address: '125 Nguyễn Văn Linh, Quận Hải Châu, Đà Nẵng',
        genderCode: 'M',
        dob: '2002-08-20'
    }, null, 2).replace('"__CANDIDATE_ID__"', '{{manualCandidateUserId}}'),
    test: [...showHelper, ...ok(() => {
        const u = pm.response.json().user || {};
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Đã cập nhật thông tin cá nhân & đồng bộ Web', 'F5 trang Thông tin tài khoản trên trình duyệt để thấy thay đổi.', [
            { label: 'Họ và tên mới', value: [u.firstName, u.lastName].filter(Boolean).join(' ') },
            { label: 'Địa chỉ mới', value: u.address || '' },
            { label: 'Giới tính', value: u.genderCode || '' },
            { label: 'Xem trên trình duyệt', value: webOrigin + '/candidate/info' }
        ]);
    })]
});
const candidateSettingUpdate = req('Cập nhật cài đặt tìm việc & kỹ năng (bật gợi ý việc làm)', {
    method: 'PUT', path: '/api/setDataUserSetting', token: 'manualCandidate', pre: ensureCandidateId,
    description: 'Cài đặt ngành nghề, mức lương, địa điểm, kinh nghiệm, kỹ năng (listSkills) và bật tìm việc (isFindJob: 1). Đồng bộ lên trang Cài đặt nâng cao.',
    body: JSON.stringify({
        id: '__CANDIDATE_ID__',
        data: {
            categoryJobCode: 'cong-nghe-thong-tin',
            salaryJobCode: '10-15tr',
            addressCode: 'Đà Nẵng',
            experienceJobCode: '1-nam',
            isFindJob: 1,
            isTakeMail: 1,
            file: '',
            listSkills: [1, 2, 9]
        }
    }, null, 2).replace('"__CANDIDATE_ID__"', '{{manualCandidateUserId}}'),
    test: [...showHelper, ...ok(() => {
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Đã lưu cài đặt tìm việc & kỹ năng', 'Hồ sơ đã được bật tìm việc và gợi ý việc làm phù hợp.', [
            { label: 'Trang Cài đặt nâng cao (Web)', value: webOrigin + '/candidate/usersetting' },
            { label: 'Trang Việc làm gợi ý (Web)', value: webOrigin + '/candidate/recommended-jobs' }
        ]);
    })]
});
const candidateCreateOnlineCv = req('Tạo mẫu CV trực tuyến mới (Identity MongoDB)', {
    method: 'POST', path: '/api/profile/cvs', token: 'manualCandidate',
    description: 'Tạo bản CV trực tuyến đầy đủ học vấn, kinh nghiệm, kỹ năng. Đồng bộ ngay lên mục "CV và trợ lý AI" trên trình duyệt.',
    body: JSON.stringify({
        title: 'CV Fullstack Web Developer - Nguyễn Văn An',
        template: 'modern',
        fullName: 'Nguyễn Văn An',
        email: 'nguyenvanan.dev@gmail.com',
        phone: '0988123456',
        address: 'Quận Hải Châu, Đà Nẵng',
        summary: 'Lập trình viên Web có nền tảng vững về ReactJS, Node.js, RESTful API, MySQL/PostgreSQL và Docker. Yêu thích xây dựng sản phẩm có trải nghiệm tốt.',
        skills: ['JavaScript (ES6+)', 'ReactJS', 'Node.js / Express', 'MySQL & PostgreSQL', 'Docker', 'Git'],
        languages: ['Tiếng Việt (Bản ngữ)', 'Tiếng Anh (Đọc hiểu tài liệu & giao tiếp cơ bản)'],
        experiences: [
            {
                company: 'Dự án Website Tuyển dụng JobFind',
                position: 'Fullstack Web Developer',
                from: '01/2026',
                to: 'Hiện tại',
                description: 'Phát triển hệ thống microservices tuyển dụng với ReactJS, Node.js, API Gateway, RabbitMQ và Elasticsearch.'
            }
        ],
        educations: [
            {
                school: 'Đại học Bách Khoa - Đại học Đà Nẵng',
                major: 'Công nghệ Thông tin',
                degree: 'Kỹ sư Công nghệ Thông tin',
                year: '2025'
            }
        ]
    }, null, 2),
    test: [...showHelper, ...created(() => {
        const cv = pm.response.json().data;
        const webOrigin = pm.environment.get('origin') || '';
        pm.environment.set('manualOnlineCvId', cv._id);
        show(true, 'Đã tạo CV trực tuyến (MongoDB ID: ' + cv._id + ')', 'Mở hoặc F5 trang CV trên trình duyệt để xem bản CV vừa tạo.', [
            { label: 'Mã CV (_id)', value: cv._id },
            { label: 'Tiêu đề CV', value: cv.title },
            { label: 'Họ tên trên CV', value: cv.fullName },
            { label: 'Kỹ năng', value: (cv.skills || []).join(', ') },
            { label: 'Xem trên trình duyệt', value: webOrigin + '/candidate/ai-cv' }
        ]);
    })]
});

// ==================== 3. NHÀ TUYỂN DỤNG ĐĂNG TIN, ADMIN DUYỆT & SỬA/GỠ TIN ====================
const jobCreateSampleBody = JSON.stringify({
    name: 'Lập trình viên Fullstack (ReactJS / Node.js) - Đi làm ngay',
    descriptionHTML: '<h3>Mô tả công việc</h3><ul><li>Phát triển và tối ưu giao diện web bằng <b>ReactJS</b>, kết nối RESTful API và Socket.IO.</li><li>Xây dựng dịch vụ backend với <b>Node.js (Express)</b>, MySQL/PostgreSQL và Docker.</li><li>Phối hợp cùng đội ngũ Product &amp; QA đảm bảo chất lượng sản phẩm.</li></ul><h3>Yêu cầu ứng viên</h3><ul><li>Có từ 1 năm kinh nghiệm làm việc với JavaScript, Reactjs, Nodejs, SQL.</li><li>Hiểu biết về Git, REST API, ưu tiên biết Docker / Microservices.</li></ul><h3>Quyền lợi</h3><ul><li>Thu nhập 10 - 15 triệu/tháng + thưởng dự án, xét tăng lương 2 lần/năm.</li><li>Đóng BHXH đầy đủ, 12 ngày phép/năm, cấp Macbook/Laptop làm việc.</li></ul>',
    descriptionMarkdown: '### Mô tả công việc\n- Phát triển giao diện web bằng ReactJS và backend Node.js.\n### Yêu cầu\n- Có từ 1 năm kinh nghiệm JavaScript, Reactjs, Nodejs, SQL.\n### Quyền lợi\n- Lương 10 - 15 triệu/tháng, BHXH đầy đủ, thưởng dự án.',
    categoryJobCode: 'cong-nghe-thong-tin',
    addressCode: 'Đà Nẵng',
    salaryJobCode: '10-15tr',
    amount: 2,
    categoryJoblevelCode: 'nhan-vien',
    categoryWorktypeCode: 'fulltime',
    experienceJobCode: '1-nam',
    genderPostCode: 'ca-hai',
    isHot: 0,
    timeEnd: '{{manualJobTimeEnd}}'
}, null, 2);

const recruiterCreateJob = req('Bước 1 - Nhà tuyển dụng đăng tin mới (chờ duyệt PS3)', {
    method: 'POST', path: '/api/jobs', token: 'recruiter',
    headers: { 'Idempotency-Key': '{{manualJobIdempotencyKey}}' },
    description: 'Đăng tin tuyển dụng mới (trừ 1 lượt đăng bài của công ty). Tin mới ở trạng thái PS3 (Chờ duyệt); chạy tiếp Bước 2 để Admin duyệt hiển thị công khai ngay trên trang Việc làm.',
    pre: script(() => {
        pm.environment.set('manualJobIdempotencyKey', 'manual-job-' + Date.now());
        pm.environment.set('manualJobTimeEnd', String(Date.now() + 30 * 24 * 3600 * 1000));
    }),
    body: jobCreateSampleBody,
    test: [...showHelper, ...created(() => {
        const job = pm.response.json().data;
        const webOrigin = pm.environment.get('origin') || '';
        pm.environment.set('manualCreatedJobId', String(job.id));
        pm.environment.set('manualCreatedJobRevision', job.editRevision || '');
        show(true, 'Đã đăng tin mới #' + job.id + ' (Trạng thái: ' + job.statusCode + ' - Chờ duyệt)',
            'Bấm tiếp "Bước 2 - Admin duyệt tin vừa đăng lên công khai (PS1)" để tin xuất hiện ngay ngoài trang chủ Việc làm và cho phép ứng viên nộp CV!', [
                { label: 'Mã tin mới (manualCreatedJobId)', value: job.id },
                { label: 'Tiêu đề tin', value: job.name },
                { label: 'Trạng thái hiện tại', value: job.statusCode + ' (Chờ kiểm duyệt)' },
                { label: 'Quản lý tin NTD (Web)', value: webOrigin + '/admin/list-post' },
                { label: 'Danh sách chờ duyệt Admin (Web)', value: webOrigin + '/admin/list-post-admin' }
            ]);
    })]
});

const adminApproveJob = req('Bước 2 - Admin duyệt tin vừa đăng lên công khai (PS1)', {
    method: 'PUT', path: '/api/accept-post', token: 'admin',
    description: 'Dùng quyền Admin duyệt tin vừa tạo ở Bước 1 từ PS3 -> PS1 (hiển thị công khai trên Web & Elasticsearch), đồng thời gán luôn vào manualPostId để Ứng viên nộp CV ở Thư mục 4.',
    pre: script(() => {
        const id = pm.environment.get('manualCreatedJobId');
        if (!id) {
            console.log('Chưa có manualCreatedJobId: hãy chạy Bước 1 đăng tin trước.');
            pm.execution.skipRequest();
            return;
        }
        const base = pm.environment.get('baseUrl');
        const recToken = pm.environment.get('recruiterAccessToken');
        if (recToken) {
            pm.sendRequest({ url: base + '/api/jobs/' + id + '/manage', header: { Authorization: 'Bearer ' + recToken } }, (err, res) => {
                if (!err && res.code === 200 && res.json().data) {
                    const live = res.json().data;
                    pm.environment.set('manualCreatedJobRevision', live.editRevision);
                    if (live.statusCode === 'PS1') {
                        pm.environment.set('manualPostId', String(live.id));
                        console.log('Tin #' + live.id + ' đã được AI kiểm duyệt tự động duyệt lên PS1 trước đó! Đã gán manualPostId = ' + live.id);
                        pm.execution.skipRequest();
                    }
                }
            });
        }
    }),
    body: JSON.stringify({
        id: '__CREATED_JOB_ID__',
        statusCode: 'PS1',
        expectedRevision: '{{manualCreatedJobRevision}}'
    }, null, 2).replace('"__CREATED_JOB_ID__"', '{{manualCreatedJobId}}'),
    test: [...showHelper, ...ok(() => {
        const id = pm.environment.get('manualCreatedJobId');
        const webOrigin = pm.environment.get('origin') || '';
        pm.environment.set('manualPostId', String(id));
        show(true, 'Đã duyệt công khai tin #' + id + ' (PS1) & đồng bộ lên Web',
            'Biến manualPostId đã tự cập nhật = ' + id + '. Tin đã hiện công khai trên trang Việc làm và ứng viên có thể nộp CV ngay ở Thư mục 4!', [
                { label: 'Mã tin công khai (manualPostId)', value: id },
                { label: 'Xem trang chi tiết tin trên trình duyệt', value: webOrigin + '/detail-job/' + id },
                { label: 'Xem danh sách Việc làm trên trình duyệt', value: webOrigin + '/job' }
            ]);
    })]
});

const recruiterLoadJobRevision = req('Bước 3 - Lấy phiên bản tin trước khi sửa (editRevision)', {
    path: '/api/jobs/{{manualPostId}}/manage', token: 'recruiter',
    description: 'Lấy mã editRevision hiện tại của tin manualPostId (chống ghi đè xung đột Optimistic Locking) trước khi chạy Bước 4 sửa tin.',
    test: [...showHelper, ...ok(() => {
        const job = pm.response.json().data;
        pm.environment.set('manualEditJobRevision', job.editRevision);
        show(true, 'Đã lấy phiên bản tin #' + job.id, 'Bạn có thể sửa nội dung ở Bước 4 và bấm Send.', [
            { label: 'Mã tin (manualPostId)', value: job.id },
            { label: 'Tiêu đề hiện tại', value: job.name },
            { label: 'Trạng thái', value: job.statusCode },
            { label: 'Mã phiên bản (manualEditJobRevision)', value: job.editRevision }
        ]);
    })]
});

const recruiterUpdateJob = req('Bước 4 - Sửa nội dung tin tuyển dụng', {
    method: 'PUT', path: '/api/jobs/{{manualPostId}}', token: 'recruiter',
    description: 'Sửa tiêu đề, mô tả, mức lương, số lượng tuyển của tin manualPostId (cần chạy Bước 3 trước để có manualEditJobRevision mới nhất).',
    pre: script(() => {
        if (!pm.environment.get('manualEditJobRevision')) {
            console.log('Chưa có manualEditJobRevision: hãy chạy "Bước 3 - Lấy phiên bản tin trước khi sửa" trước.');
            pm.execution.skipRequest();
        }
    }),
    body: JSON.stringify({
        name: 'Lập trình viên Fullstack ReactJS / Node.js (Cập nhật lương & quyền lợi)',
        descriptionHTML: '<h3>Mô tả công việc (Đã cập nhật)</h3><ul><li>Phát triển ứng dụng Web với <b>ReactJS</b> và hệ thống Microservices <b>Node.js</b>.</li><li>Tham gia tối ưu hiệu năng truy vấn MySQL, PostgreSQL, Elasticsearch.</li></ul><h3>Yêu cầu</h3><ul><li>Từ 1 năm kinh nghiệm JavaScript, Reactjs, Nodejs, SQL, Docker.</li></ul><h3>Quyền lợi</h3><ul><li>Thu nhập hấp dẫn 12 - 18 triệu/tháng + thưởng hiệu suất quý.</li><li>Làm việc thứ Hai - thứ Sáu, hỗ trợ ăn trưa và gửi xe.</li></ul>',
        descriptionMarkdown: '### Mô tả công việc (Đã cập nhật)\n- Phát triển Web ReactJS & Microservices Node.js.\n### Quyền lợi\n- Lương 12 - 18 triệu/tháng, làm thứ 2 - thứ 6.',
        categoryJobCode: 'cong-nghe-thong-tin',
        addressCode: 'Đà Nẵng',
        salaryJobCode: '10-15tr',
        amount: 3,
        categoryJoblevelCode: 'chuyen-vien',
        categoryWorktypeCode: 'fulltime',
        experienceJobCode: '1-nam',
        genderPostCode: 'ca-hai',
        expectedRevision: '{{manualEditJobRevision}}'
    }, null, 2),
    test: [...showHelper, ...ok(() => {
        const job = pm.response.json().data;
        const webOrigin = pm.environment.get('origin') || '';
        pm.environment.set('manualEditJobRevision', job.editRevision);
        show(true, 'Đã cập nhật tin #' + job.id + ' (Trạng thái: ' + job.statusCode + ')',
            job.statusCode === 'PS3'
                ? 'Nội dung tin thay đổi nên chuyển về PS3 để kiểm duyệt lại (nếu là tin vừa tạo ở Bước 1, có thể bấm lại Bước 2 để Admin duyệt lên PS1).'
                : 'Tin đã cập nhật và đồng bộ lên trình duyệt.', [
                    { label: 'Mã tin', value: job.id },
                    { label: 'Tiêu đề mới', value: job.name },
                    { label: 'Trạng thái hiện tại', value: job.statusCode },
                    { label: 'Quản lý tin NTD (Web)', value: webOrigin + '/admin/list-post' },
                    { label: 'Chi tiết tin công khai (Web)', value: webOrigin + '/detail-job/' + job.id }
                ]);
    })]
});

const recruiterCloseJob = req('Bước 5 - Gỡ / Đóng tin tuyển dụng vừa tạo (PS4)', {
    method: 'DELETE', path: '/api/jobs/{{manualCreatedJobId}}', token: 'recruiter',
    description: 'Chỉ chạy khi bạn muốn gỡ tin vừa đăng ở Bước 1 (chuyển sang PS4 và xoá khỏi kết quả tìm kiếm công khai).',
    pre: script(() => {
        if (!pm.environment.get('manualCreatedJobId')) {
            console.log('Chưa có manualCreatedJobId để gỡ.');
            pm.execution.skipRequest();
        }
    }),
    test: [...showHelper, ...ok(() => {
        const closedId = pm.environment.get('manualCreatedJobId');
        const webOrigin = pm.environment.get('origin') || '';
        if (pm.environment.get('manualPostId') === String(closedId)) {
            pm.environment.set('manualPostId', '234');
        }
        show(true, 'Đã gỡ tin #' + closedId + ' (PS4)', 'Tin đã được ẩn khỏi trang Việc làm & Elasticsearch; manualPostId đã trả về tin mặc định #234.', [
            { label: 'Tin đã gỡ', value: closedId },
            { label: 'Quản lý tin NTD (Web)', value: webOrigin + '/admin/list-post' }
        ]);
    })]
});

// ==================== 4. ỨNG VIÊN NỘP CV ỨNG TUYỂN ====================
const openJobsList = req('Danh sách tin còn hạn của công ty nhà tuyển dụng', {
    path: '/api/jobs/manage?limit=50&offset=0&statusCode=PS1', token: 'recruiter',
    description: 'Xem các tin đang tuyển (PS1, còn hạn) của công ty nhà tuyển dụng (recruiterPhone). Chọn mã tin đặt vào biến manualPostId.',
    test: [...showHelper, ...ok(() => {
        const all = pm.response.json().data || [];
        const now = Date.now();
        const open = all.filter((j) => Number(j.timeEnd) > now);
        const webOrigin = pm.environment.get('origin') || '';
        if (open.length && !pm.environment.get('manualPostId')) {
            pm.environment.set('manualPostId', String(open[0].id));
        }
        const rows = open.map((j) => ({
            label: 'Mã tin ' + j.id,
            value: (j.name || '') + ' · Hạn nộp: ' + new Date(Number(j.timeEnd)).toISOString().slice(0, 10)
                + ' · Web: ' + webOrigin + '/detail-job/' + j.id
        }));
        show(true, open.length + ' tin đang nhận hồ sơ (công ty của recruiter)',
            'Biến manualPostId hiện tại: ' + (pm.environment.get('manualPostId') || '(chưa đặt)') + '. Đổi manualPostId trong Environment nếu muốn nộp vào tin khác.',
            rows);
    })]
});

const applyPreflight = req('Bước 1 - Kiểm tra trước khi nộp CV (chưa nộp)', {
    path: '/api/jobs/{{manualPostId}}', token: 'manualCandidate',
    description: 'Kiểm tra tài khoản ứng viên (manualCandidatePhone), tin tuyển dụng (manualPostId) còn hạn và chưa nộp trùng. KHÔNG lưu CV.',
    pre: script(() => {
        const postId = String(pm.environment.get('manualPostId') || '');
        if (!/^[1-9][0-9]*$/.test(postId)) {
            console.log('Chưa chọn tin tuyển dụng: đặt biến manualPostId là mã tin hợp lệ (xem request "Danh sách tin còn hạn").');
            pm.execution.skipRequest();
            return;
        }
        const base = pm.environment.get('baseUrl');
        const token = pm.environment.get('manualCandidateAccessToken');
        pm.sendRequest({ url: base + '/api/auth/me', header: { Authorization: 'Bearer ' + token } }, (err, meRes) => {
            const me = !err && meRes.code === 200 ? meRes.json().data : null;
            pm.variables.set('manualApplyMe', JSON.stringify(me || null));
            pm.sendRequest({ url: base + '/api/my-applications', header: { Authorization: 'Bearer ' + token } }, (err2, appRes) => {
                const apps = !err2 && appRes.code === 200 ? (appRes.json().data || []) : [];
                const found = apps.find((a) => String(a.job_id) === postId) || null;
                pm.variables.set('manualApplyExisting', JSON.stringify(found));
            });
        });
    }),
    test: [...showHelper, ...script(() => {
        const body = pm.response.json();
        const me = JSON.parse(pm.variables.get('manualApplyMe') || 'null');
        const existing = JSON.parse(pm.variables.get('manualApplyExisting') || 'null');
        const webOrigin = pm.environment.get('origin') || '';
        const job = pm.response.code === 200 && body.errCode === 0 ? body.data : null;
        const isCandidate = Boolean(me && me.roleCode === 'CANDIDATE');
        const isOpen = Boolean(job && job.statusCode === 'PS1' && Number(job.timeEnd) > Date.now());
        const canApply = isCandidate && isOpen && !existing;

        if (existing && job) {
            pm.environment.unset('manualApplyPostId');
            if (!pm.environment.get('manualApplicationId')) {
                pm.environment.set('manualApplicationId', String(existing.id));
            }
            pm.test('Ứng viên đã nộp tin này trước đó (đã có mã hồ sơ Kanban #' + existing.id + ')', () => pm.expect(true).to.be.true);
            show(false, 'Ứng viên này đã ứng tuyển tin #' + job.id + ' trước đó',
                'Mỗi ứng viên chỉ nộp 1 lần cho mỗi tin. Bạn có thể dùng luôn Mã hồ sơ #' + existing.id + ' ở Thư mục 5-9, hoặc đổi sang manualPostId khác / tạo ứng viên mới ở Thư mục 1.', [
                    { label: 'Mã hồ sơ Kanban đã có', value: '#' + existing.id + ' (giai đoạn: ' + existing.stage + ')' },
                    { label: 'Biến manualApplicationId hiện tại', value: pm.environment.get('manualApplicationId') },
                    { label: 'Tin tuyển dụng', value: '#' + job.id + ' - ' + job.name },
                    { label: 'Xem trên trình duyệt (Ứng viên)', value: webOrigin + '/candidate/cv-post/' },
                    { label: 'Xem trên trình duyệt (Kanban NTD)', value: webOrigin + '/admin/pipeline' }
                ]);
            return;
        }

        const errReason = !isCandidate ? 'Tài khoản manualCandidatePhone không phải vai trò CANDIDATE'
            : !job ? (body.errMessage || 'Không tìm thấy tin tuyển dụng #' + pm.environment.get('manualPostId'))
            : 'Tin tuyển dụng đã hết hạn hoặc không còn mở nhận hồ sơ';
        pm.test('Kiểm tra đạt: có thể nộp CV vào tin #' + pm.environment.get('manualPostId'), () => pm.expect(canApply, errReason).to.be.true);
        if (canApply) {
            pm.environment.set('manualApplyPostId', String(job.id));
            pm.environment.set('manualApplyAt', Date.now());
            show(true, 'Đạt - Sẵn sàng nộp CV (CHƯA nộp)', 'Bấm Bước 2 trong 15 phút để nộp CV thật và đồng bộ sang Kanban.', [
                { label: 'Tài khoản ứng viên nộp', value: pm.environment.get('manualCandidatePhone') + ' (userId: ' + me.userId + ')' },
                { label: 'Tin tuyển dụng', value: '#' + job.id + ' - ' + job.name },
                { label: 'Công ty nhận hồ sơ', value: (job.companyName || '') + ' (companyId: ' + job.companyId + ')' },
                { label: 'Hạn nhận hồ sơ', value: new Date(Number(job.timeEnd)).toISOString().slice(0, 10) },
                { label: 'Xem tin trên trình duyệt', value: webOrigin + '/detail-job/' + job.id }
            ]);
        } else {
            pm.environment.unset('manualApplyPostId');
            show(false, 'Chưa đạt - không thể nộp CV', errReason);
        }
    })]
});

const applySubmit = req('Bước 2 - Nộp CV thật (tạo hồ sơ ứng tuyển)', {
    method: 'POST', path: '/api/create-new-cv', token: 'manualCandidate',
    description: 'Nộp CV PDF mẫu (có sẵn kỹ năng Nodejs, Reactjs, JS, SQL, Docker) vào đúng tin đã kiểm tra ở Bước 1. Có thể sửa lời giới thiệu "description".',
    pre: script(() => {
        const postId = pm.environment.get('manualApplyPostId');
        const at = Number(pm.environment.get('manualApplyAt') || 0);
        if (!postId) {
            console.log('KHÔNG GỬI "' + pm.info.requestName + '": chưa chạy "Bước 1 - Kiểm tra trước khi nộp CV" đạt.');
            pm.execution.skipRequest();
        } else if (Date.now() - at > 15 * 60000) {
            pm.environment.unset('manualApplyPostId');
            console.log('KHÔNG GỬI "' + pm.info.requestName + '": kết quả kiểm tra Bước 1 đã quá 15 phút. Chạy lại Bước 1.');
            pm.execution.skipRequest();
        }
    }),
    body: JSON.stringify({
        postId: '__MANUAL_APPLY_POST_ID__',
        description: 'Em xin ứng tuyển vị trí tại quý công ty. Em có nền tảng về ReactJS, Node.js, SQL và Docker, rất mong có cơ hội trao đổi thêm trong buổi phỏng vấn.',
        file: CV_PDF_DATA_URL
    }, null, 2).replace('"__MANUAL_APPLY_POST_ID__"', '{{manualApplyPostId}}'),
    test: [...showHelper, ...ok(() => {
        const body = pm.response.json();
        const appliedPostId = pm.environment.get('manualApplyPostId');
        pm.test('Đã tạo CV mới (cvId = ' + body.cvId + ')', () => pm.expect(body.cvId).to.be.a('number'));
        pm.environment.set('manualLastCvId', String(body.cvId));
        pm.environment.set('manualLastAppliedPostId', String(appliedPostId));
        pm.environment.unset('manualApplyPostId');
        pm.environment.unset('manualApplyAt');
        show(true, 'Đã nộp CV thành công (cvId #' + body.cvId + ')',
            'Bấm tiếp "Bước 3 - Đồng bộ sang Kanban & tự điền manualApplicationId" để lấy mã hồ sơ Kanban và thao tác mời phỏng vấn / gửi offer.', [
                { label: 'Mã CV vừa nộp (legacy_cv_id)', value: body.cvId },
                { label: 'Mã tin đã ứng tuyển', value: appliedPostId },
                { label: 'Ứng viên', value: pm.environment.get('manualCandidatePhone') }
            ]);
    })]
});

const applySyncKanban = req('Bước 3 - Đồng bộ sang Kanban & tự điền manualApplicationId', {
    path: '/api/applications?jobId={{manualLastAppliedPostId}}&limit=100', token: 'recruiter',
    description: 'Chờ Outbox -> RabbitMQ -> Application Service đồng bộ CV vừa nộp lên Kanban của nhà tuyển dụng, rồi tự điền biến manualApplicationId.',
    pre: script(() => {
        if (!pm.environment.get('manualLastCvId') || !pm.environment.get('manualLastAppliedPostId')) {
            console.log('Chưa có CV vừa nộp từ Bước 2: hãy chạy Bước 2 trước (hoặc chọn hồ sơ có sẵn ở Thư mục 5).');
            pm.execution.skipRequest();
            return;
        }
        const deadline = Date.now() + 20000;
        const targetCvId = Number(pm.environment.get('manualLastCvId'));
        const poll = () => pm.sendRequest({
            url: pm.environment.get('baseUrl') + '/api/applications?jobId=' + pm.environment.get('manualLastAppliedPostId') + '&limit=100',
            header: { Authorization: 'Bearer ' + pm.environment.get('recruiterAccessToken') }
        }, (err, res) => {
            const rows = (!err && res.code === 200 && res.json().data) || [];
            if (!rows.some((a) => Number(a.legacy_cv_id) === targetCvId) && Date.now() < deadline) setTimeout(poll, 1200);
        });
        poll();
    }),
    test: [...showHelper, ...ok(() => {
        const targetCvId = Number(pm.environment.get('manualLastCvId'));
        const app = (pm.response.json().data || []).find((a) => Number(a.legacy_cv_id) === targetCvId);
        const webOrigin = pm.environment.get('origin') || '';
        pm.test('Hồ sơ đã xuất hiện trên Kanban của nhà tuyển dụng', () => pm.expect(app, 'Chưa thấy hồ sơ trên Kanban (kiểm tra tin có thuộc đúng công ty của recruiterPhone không)').to.not.be.undefined);
        if (app) {
            pm.environment.set('manualApplicationId', String(app.id));
            show(true, 'Đã đồng bộ lên Kanban - Mã hồ sơ #' + app.id,
                'Biến manualApplicationId đã được tự động điền = ' + app.id + '. Bạn có thể mở trình duyệt xem ngay hoặc chuyển sang Thư mục 6-9 để mời phỏng vấn / gửi offer!', [
                    { label: 'manualApplicationId (đã tự lưu)', value: app.id },
                    { label: 'Ứng viên', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
                    { label: 'Tin tuyển dụng', value: app.job_title },
                    { label: 'Giai đoạn hiện tại', value: app.stage },
                    { label: 'Xem trên trình duyệt (Kanban NTD)', value: webOrigin + '/admin/pipeline' },
                    { label: 'Xem trên trình duyệt (Việc đã nộp - UV)', value: webOrigin + '/candidate/cv-post/' }
                ]);
        }
    })]
});

// ==================== 5-9. QUẢN LÝ HỒ SƠ, PHỎNG VẤN, OFFER, TỪ CHỐI, KANBAN ====================
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

const applicationReal = (key, check) => [...showHelper, ...ok(() => {
    const body = pm.response.json();
    const app = body.data || {};
    const webOrigin = pm.environment.get('origin') || '';
    if (body.emailQueued !== undefined) pm.test('Đã lưu và xếp email vào hàng đợi gửi', () => pm.expect(body.emailQueued).to.be.true);
    pm.test('Giai đoạn hồ sơ sau khi gửi: ' + app.stage, () => pm.expect(app.stage).to.be.a('string'));
    show(true, 'Đã gửi thật & đồng bộ lên trình duyệt (Hồ sơ #' + app.id + ')',
        'Dữ liệu đã ghi vào CSDL và phát sự kiện thông báo/email. Mở hoặc F5 trang trình duyệt bên dưới để xem ngay kết quả đồng bộ.', [
            { label: 'Hồ sơ', value: '#' + app.id + ' - ' + (app.job_title || '') },
            { label: 'Ứng viên', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
            { label: 'Giai đoạn mới trên Kanban', value: app.stage },
            { label: 'Hàng đợi gửi email', value: body.emailQueued ? 'Đã xếp vào hàng đợi gửi email' : 'Bước này không gửi email' },
            { label: 'Trình duyệt NTD (Bảng Kanban)', value: webOrigin + '/admin/pipeline' },
            { label: 'Trình duyệt NTD (Lịch phỏng vấn)', value: webOrigin + '/admin/interviews' },
            { label: 'Trình duyệt Ứng viên (Thông báo)', value: webOrigin + '/candidate/notifications' },
            { label: 'Trình duyệt Ứng viên (Lịch PV / Việc đã nộp)', value: webOrigin + '/candidate/interviews  |  ' + webOrigin + '/candidate/cv-post/' }
        ]);
}), ...script(check), ...consume(key)];

const datesPre = script(() => {
    const vnDate = (days) => new Date(Date.now() + days * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    pm.environment.set('suggestedInterviewDate', vnDate(7));
    pm.environment.set('suggestedConfirmBy', vnDate(5) + 'T17:00');
    pm.environment.set('suggestedStartDate', vnDate(21));
    pm.environment.set('suggestedResponseDeadline', vnDate(14) + 'T17:00');
});

const interviewBody = JSON.stringify({
    message: 'Chào bạn, hồ sơ của bạn rất phù hợp với vị trí đang tuyển. Mời bạn tham dự buổi phỏng vấn theo thông tin bên dưới.',
    interview: {
        companyName: 'Sao Khuê Digital',
        interviewDate: '{{suggestedInterviewDate}}',
        interviewTime: '09:30',
        durationMinutes: '60',
        timeZone: 'Asia/Ho_Chi_Minh',
        interviewMode: 'onsite',
        location: 'Tầng 5, Tòa nhà Sao Khuê, Quận Hải Châu, Đà Nẵng',
        meetingUrl: '',
        round: 'Vòng 1 - Phỏng vấn chuyên môn',
        interviewers: 'Anh Trần Minh Hoàng - Tech Lead',
        preparation: 'Mang theo laptop cá nhân và CV bản in (nếu có)',
        contactName: 'Phòng Nhân sự - Sao Khuê Digital',
        contactEmail: '{{hrContactEmail}}',
        contactPhone: '0918800001',
        confirmBy: '{{suggestedConfirmBy}}'
    }
}, null, 2);
const offerBody = JSON.stringify({
    decision: 'accepted',
    message: 'Chúc mừng bạn đã vượt qua các vòng phỏng vấn! Chúng tôi trân trọng gửi tới bạn thư mời nhận việc chính thức.',
    offer: {
        companyName: 'Sao Khuê Digital',
        startDate: '{{suggestedStartDate}}',
        startTime: '08:30',
        timeZone: 'Asia/Ho_Chi_Minh',
        responseDeadline: '{{suggestedResponseDeadline}}',
        workMode: 'onsite',
        location: 'Tầng 5, Tòa nhà Sao Khuê, Quận Hải Châu, Đà Nẵng',
        meetingUrl: '',
        contactName: 'Phòng Nhân sự - Sao Khuê Digital',
        contactEmail: '{{hrContactEmail}}',
        contactPhone: '0918800001',
        workSchedule: 'Thứ Hai - Thứ Sáu, 08:30 - 17:30 (nghỉ Thứ Bảy, Chủ Nhật)',
        salary: '15.000.000 VNĐ gross/tháng',
        probation: '2 tháng (hưởng 85% mức lương chính thức)',
        benefits: 'Đóng BHXH đầy đủ theo luật, 12 ngày phép/năm, thưởng lễ Tết và đánh giá tăng lương 2 lần/năm',
        requiredDocuments: 'CCCD công chứng, sơ yếu lý lịch, bản sao bằng tốt nghiệp/bảng điểm và 02 ảnh 3x4',
        onboardingInstructions: 'Vui lòng có mặt tại quầy Lễ tân tầng 5 lúc 08:15 ngày nhận việc để nhận máy tính và tài khoản nội bộ'
    }
}, null, 2);

const needApplication = script(() => {
    if (!/^[1-9][0-9]*$/.test(String(pm.environment.get('manualApplicationId') || ''))) {
        console.log('Chưa chọn hồ sơ: hãy nộp CV ở Thư mục 4 (tự động điền manualApplicationId) hoặc đặt biến manualApplicationId ở Thư mục 5 rồi bấm Ctrl+S.');
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
        description: `Gửi đúng body và hồ sơ đã kiểm tra đạt ở Bước 1 (biến ${key}Body, ${key}AppId) và đồng bộ trực tiếp lên trình duyệt. Không sửa body ở đây.`,
        test: applicationReal(key, after)
    })
], { pre: datesPre });

const recruiterMe = req('Tài khoản nhà tuyển dụng đang dùng', { path: '/api/auth/me', token: 'recruiter', test: [...showHelper, ...ok(() => {
    const me = pm.response.json().data;
    const webOrigin = pm.environment.get('origin') || '';
    pm.test('Là nhà tuyển dụng có công ty đã duyệt', () => {
        pm.expect(me.roleCode).to.be.oneOf(['COMPANY', 'EMPLOYER', 'ADMIN']);
        if (me.roleCode !== 'ADMIN') pm.expect(me.companyCensorCode).to.eql('CS1');
    });
    if (me.companyId) pm.environment.set('manualCompanyId', String(me.companyId));
    pm.environment.set('recruiterUserId', String(me.userId));
    show(true, 'Thao tác bằng tài khoản nhà tuyển dụng này', 'Đăng nhập cùng tài khoản recruiterPhone trên trình duyệt để xem bảng Kanban đồng bộ.', [
        { label: 'Số điện thoại (recruiterPhone)', value: pm.environment.get('recruiterPhone') },
        { label: 'Mã người dùng (recruiterUserId)', value: me.userId }, { label: 'Vai trò', value: me.roleCode }, { label: 'Công ty (manualCompanyId)', value: me.companyId },
        { label: 'Bảng Kanban trên trình duyệt', value: webOrigin + '/admin/pipeline' }
    ]);
})] });
const applicationList = req('Danh sách hồ sơ của công ty (tìm theo tên hoặc email)', {
    path: '/api/applications?q={{manualSearch}}&limit=50', token: 'recruiter',
    description: 'Đặt biến manualSearch để lọc (để trống = tất cả). Chép số ở cột "Mã hồ sơ" vào biến manualApplicationId rồi bấm Ctrl+S.',
    test: [...showHelper, ...ok(() => {
        const rows = pm.response.json().data.map((a) => ({
            label: 'Mã hồ sơ ' + a.id,
            value: (a.candidate_name || '') + ' <' + (a.candidate_email || '') + '> · ' + (a.job_title || '') + ' · ' + a.stage
        }));
        show(true, pm.response.json().count + ' hồ sơ', 'Chọn một mã hồ sơ, điền vào Current value của biến manualApplicationId rồi bấm Ctrl+S.', rows);
    })]
});
const applicationDetail = req('Hồ sơ đang chọn (manualApplicationId)', {
    path: '/api/applications/{{manualApplicationId}}', token: 'recruiter', pre: needApplication,
    description: 'Xem chi tiết hồ sơ đang chọn trong biến manualApplicationId trước khi gửi thư mời hoặc chuyển giai đoạn.',
    test: [...showHelper, ...ok(() => {
        const app = pm.response.json().data;
        const last = app.latestDecision;
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Hồ sơ #' + app.id, 'Kiểm tra đúng người trước khi gửi thư.', [
            { label: 'Ứng viên', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
            { label: 'Tin tuyển dụng', value: app.job_title },
            { label: 'Giai đoạn hiện tại', value: app.stage },
            { label: 'Thư gần nhất', value: last ? last.decision + ' lúc ' + last.requestedAt : 'Chưa gửi thư nào' },
            { label: 'Xem trên Kanban trình duyệt', value: webOrigin + '/admin/pipeline' }
        ].concat((app.timeline || []).slice(0, 5).map((e) => ({ label: 'Lịch sử ' + e.created_at, value: (e.from_stage || '') + ' → ' + e.to_stage + ' · ' + (e.reason || '') }))));
    })]
});

// ==================== 10. NHẮN TIN CHAT REALTIME ỨNG VIÊN <-> NHÀ TUYỂN DỤNG ====================
const chatPrepareIds = req('Bước 1 - Kết nối cặp tài khoản Chat (Ứng viên <-> Nhà tuyển dụng)', {
    path: '/api/auth/me', token: 'recruiter', pre: ensureCandidateId,
    description: 'Tự động lấy mã người nhận của cả hai phía (recruiterUserId & manualCandidateUserId) để gửi tin nhắn 2 chiều ở Bước 2 & Bước 3.',
    test: [...showHelper, ...ok(() => {
        const rec = pm.response.json().data;
        const candId = pm.environment.get('manualCandidateUserId');
        const webOrigin = pm.environment.get('origin') || '';
        pm.environment.set('recruiterUserId', String(rec.userId));
        show(true, 'Sẵn sàng nhắn tin Chat 2 chiều', 'Tin nhắn gửi từ Bước 2 & Bước 3 sẽ nhảy realtime qua Socket.IO lên khung Chat trình duyệt của cả 2 bên.', [
            { label: 'Ứng viên (manualCandidatePhone)', value: pm.environment.get('manualCandidatePhone') + ' (userId: ' + candId + ')' },
            { label: 'Nhà tuyển dụng (recruiterPhone)', value: pm.environment.get('recruiterPhone') + ' (userId: ' + rec.userId + ')' },
            { label: 'Khung Chat Ứng viên (Web)', value: webOrigin + '/chat' },
            { label: 'Khung Chat Nhà tuyển dụng (Web)', value: webOrigin + '/admin/chat/' + candId }
        ]);
    })]
});

const chatCandidateToRecruiter = req('Bước 2 - Ứng viên gửi tin nhắn cho Nhà tuyển dụng', {
    method: 'POST', path: '/api/send-chat-message', token: 'manualCandidate',
    description: 'Sửa nội dung "content" rồi bấm Send. Mỗi lần bấm tự sinh clientMessageId mới và đẩy realtime lên khung Chat của Nhà tuyển dụng.',
    pre: script(() => {
        if (!pm.environment.get('recruiterUserId')) {
            console.log('Chưa có recruiterUserId: hãy chạy "Bước 1 - Kết nối cặp tài khoản Chat" trước.');
            pm.execution.skipRequest();
            return;
        }
        pm.environment.set('manualChatMsgId', 'manual-cand-msg-' + Date.now());
    }),
    body: JSON.stringify({
        v: 1,
        receiverId: '__RECRUITER_USER_ID__',
        content: 'Em chào anh/chị Phòng Nhân sự Sao Khuê Digital ạ! Em vừa nộp hồ sơ ứng tuyển vị trí Lập trình viên Web, rất mong nhận được phản hồi từ quý công ty.',
        clientMessageId: '{{manualChatMsgId}}'
    }, null, 2).replace('"__RECRUITER_USER_ID__"', '{{recruiterUserId}}'),
    test: [...showHelper, ...ok(() => {
        const msg = pm.response.json().data;
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Ứng viên đã gửi tin nhắn #' + msg.id + ' (Realtime)',
            'Mở trang Chat của Nhà tuyển dụng hoặc Ứng viên trên trình duyệt sẽ thấy tin nhắn nhảy lên ngay lập tức!', [
                { label: 'Nội dung đã gửi', value: msg.content },
                { label: 'Người nhận (recruiterUserId)', value: msg.receiverId },
                { label: 'Xem trên trình duyệt NTD', value: webOrigin + '/admin/chat/' + msg.senderId },
                { label: 'Xem trên trình duyệt Ứng viên', value: webOrigin + '/chat' }
            ]);
    })]
});

const chatRecruiterToCandidate = req('Bước 3 - Nhà tuyển dụng trả lời tin nhắn cho Ứng viên', {
    method: 'POST', path: '/api/send-chat-message', token: 'recruiter',
    description: 'Sửa nội dung trả lời "content" rồi bấm Send. Tin nhắn đẩy realtime lên khung Chat và badge tin nhắn trên Header của Ứng viên.',
    pre: script(() => {
        if (!pm.environment.get('manualCandidateUserId')) {
            console.log('Chưa có manualCandidateUserId: hãy chạy "Bước 1 - Kết nối cặp tài khoản Chat" trước.');
            pm.execution.skipRequest();
            return;
        }
        pm.environment.set('manualChatReplyId', 'manual-rec-msg-' + Date.now());
    }),
    body: JSON.stringify({
        v: 1,
        receiverId: '__CANDIDATE_USER_ID__',
        content: 'Chào bạn, Phòng Nhân sự Sao Khuê Digital đã nhận được CV của bạn rồi nhé! Bên mình đang xem xét và sẽ gửi lịch hẹn phỏng vấn qua email cho bạn sớm.',
        clientMessageId: '{{manualChatReplyId}}'
    }, null, 2).replace('"__CANDIDATE_USER_ID__"', '{{manualCandidateUserId}}'),
    test: [...showHelper, ...ok(() => {
        const msg = pm.response.json().data;
        const webOrigin = pm.environment.get('origin') || '';
        show(true, 'Nhà tuyển dụng đã trả lời tin nhắn #' + msg.id + ' (Realtime)',
            'Trên trình duyệt của Ứng viên, số tin nhắn chưa đọc trên Header và khung Chat cập nhật ngay!', [
                { label: 'Nội dung trả lời', value: msg.content },
                { label: 'Người nhận (manualCandidateUserId)', value: msg.receiverId },
                { label: 'Xem trên trình duyệt Ứng viên', value: webOrigin + '/chat' },
                { label: 'Xem trên trình duyệt NTD', value: webOrigin + '/admin/chat/' + msg.receiverId }
            ]);
    })]
});

const chatHistoryView = req('Bước 4 - Xem lịch sử hội thoại hai chiều', {
    path: '/api/get-chat-conversation?partnerId={{recruiterUserId}}', token: 'manualCandidate',
    test: [...showHelper, ...ok(() => {
        const list = pm.response.json().data || [];
        const recId = Number(pm.environment.get('recruiterUserId'));
        const rows = list.slice(-10).map((m) => ({
            label: (Number(m.senderId) === recId ? '🏢 Nhà tuyển dụng' : '👤 Ứng viên') + ' (#' + m.id + ')',
            value: m.content
        }));
        show(true, 'Hội thoại Chat (' + list.length + ' tin nhắn)', '10 tin nhắn gần nhất giữa hai tài khoản.', rows);
    })]
});

// ==================== 11. ỨNG VIÊN TƯƠNG TÁC: LƯU TIN, THEO DÕI & ĐÁNH GIÁ CÔNG TY ====================
const socialToggleSaveJob = req('Lưu / Bỏ lưu việc làm yêu thích (manualPostId)', {
    method: 'POST', path: '/api/toggle-favorite-post', token: 'manualCandidate',
    description: 'Bấm lần 1 để Lưu việc làm vào danh sách yêu thích, bấm lần 2 để Bỏ lưu. Đồng bộ với trang /candidate/saved-jobs/.',
    body: JSON.stringify({
        postId: '__POST_ID__'
    }, null, 2).replace('"__POST_ID__"', '{{manualPostId}}'),
    test: [...showHelper, ...ok(() => {
        const saved = Boolean(pm.response.json().isFavorite);
        const postId = pm.environment.get('manualPostId');
        const webOrigin = pm.environment.get('origin') || '';
        show(true, saved ? 'Đã LƯU việc làm #' + postId : 'Đã BỎ LƯU việc làm #' + postId,
            'Mở hoặc F5 trang Việc làm đã lưu trên trình duyệt của Ứng viên để thấy cập nhật.', [
                { label: 'Mã tin (postId)', value: postId },
                { label: 'Trạng thái hiện tại', value: saved ? 'Đã lưu yêu thích (isFavorite = true)' : 'Chưa lưu (isFavorite = false)' },
                { label: 'Trang Việc làm đã lưu (Web)', value: webOrigin + '/candidate/saved-jobs/' },
                { label: 'Trang chi tiết tin (Web)', value: webOrigin + '/detail-job/' + postId }
            ]);
    })]
});

const socialToggleFollowCompany = req('Theo dõi / Bỏ theo dõi công ty (manualCompanyId)', {
    method: 'POST', path: '/api/toggle-follow-company', token: 'manualCandidate',
    description: 'Bấm lần 1 để Theo dõi công ty (nhận thông báo khi công ty đăng tin mới), bấm lần 2 để Bỏ theo dõi.',
    body: JSON.stringify({
        companyId: '__COMPANY_ID__'
    }, null, 2).replace('"__COMPANY_ID__"', '{{manualCompanyId}}'),
    test: [...showHelper, ...ok(() => {
        const companyId = pm.environment.get('manualCompanyId');
        const webOrigin = pm.environment.get('origin') || '';
        const msg = pm.response.json().errMessage || 'Đã cập nhật trạng thái theo dõi công ty';
        show(true, msg + ' (Công ty #' + companyId + ')',
            'Đồng bộ trực tiếp lên trang Chi tiết công ty và trang Việc làm từ công ty theo dõi.', [
                { label: 'Mã công ty (companyId)', value: companyId },
                { label: 'Trang Chi tiết công ty (Web)', value: webOrigin + '/detail-company/' + companyId },
                { label: 'Trang Việc làm công ty theo dõi (Web)', value: webOrigin + '/candidate/followed-jobs' }
            ]);
    })]
});

const socialReviewCompany = req('Gửi / Cập nhật đánh giá sao cho công ty', {
    method: 'POST', path: '/api/create-company-review', token: 'manualCandidate', pre: ensureCandidateId,
    description: 'Đánh giá từ 1 đến 5 sao kèm nhận xét cho công ty manualCompanyId (mỗi ứng viên 1 đánh giá/công ty; gửi lại sẽ cập nhật nội dung mới). Đồng bộ ngay lên trang công ty.',
    body: JSON.stringify({
        companyId: '__COMPANY_ID__',
        star: 5,
        content: 'Quy trình tuyển dụng của công ty rất rõ ràng, chuyên nghiệp. Anh chị HR và Tech Lead hỗ trợ nhiệt tình, môi trường làm việc năng động.'
    }, null, 2).replace('"__COMPANY_ID__"', '{{manualCompanyId}}'),
    test: [...showHelper, ...ok(() => {
        const companyId = pm.environment.get('manualCompanyId');
        const webOrigin = pm.environment.get('origin') || '';
        const sent = JSON.parse(pm.variables.replaceIn(pm.request.body.raw));
        const base = pm.environment.get('baseUrl');
        const myId = Number(pm.environment.get('manualCandidateUserId'));
        pm.sendRequest({ url: base + '/api/get-review-by-company?companyId=' + companyId + '&limit=100&offset=0' }, (err, res) => {
            const list = (!err && res.code === 200 && res.json().data) || [];
            const mine = list.find((r) => Number(r.userId) === myId);
            if (mine) pm.environment.set('manualReviewId', String(mine.id));
        });
        show(true, (pm.response.json().errMessage || 'Đã lưu đánh giá') + ' (' + sent.star + ' ★)',
            'Mở hoặc F5 trang Chi tiết công ty trên trình duyệt để thấy đánh giá của bạn xuất hiện công khai!', [
                { label: 'Công ty được đánh giá', value: '#' + companyId },
                { label: 'Số sao', value: sent.star + ' / 5 ★' },
                { label: 'Nội dung nhận xét', value: sent.content },
                { label: 'Xem đánh giá trên trình duyệt', value: webOrigin + '/detail-company/' + companyId }
            ]);
    })]
});

const socialDeleteReview = req('Xoá đánh giá công ty vừa viết (nếu muốn gỡ)', {
    method: 'POST', path: '/api/delete-company-review', token: 'manualCandidate',
    description: 'Xoá đánh giá của chính bạn (biến manualReviewId đã được tự lưu khi bạn gửi đánh giá ở bước trên).',
    pre: script(() => {
        if (!pm.environment.get('manualReviewId')) {
            console.log('Chưa có manualReviewId: hãy gửi đánh giá công ty ở request trên trước.');
            pm.execution.skipRequest();
        }
    }),
    body: JSON.stringify({
        id: '__REVIEW_ID__'
    }, null, 2).replace('"__REVIEW_ID__"', '{{manualReviewId}}'),
    test: [...showHelper, ...ok(() => {
        const companyId = pm.environment.get('manualCompanyId');
        const webOrigin = pm.environment.get('origin') || '';
        const deletedId = pm.environment.get('manualReviewId');
        pm.environment.unset('manualReviewId');
        show(true, 'Đã xoá đánh giá #' + deletedId, 'F5 trang Chi tiết công ty trên trình duyệt sẽ thấy đánh giá đã được gỡ.', [
            { label: 'Trang Chi tiết công ty (Web)', value: webOrigin + '/detail-company/' + companyId }
        ]);
    })]
});

// ==================== DANH SÁCH 11 THƯ MỤC ====================
const manualFolders = [
    folder('1 - Đăng ký tài khoản', lines(
        'Bước 1 kiểm tra dữ liệu với server mà không tạo gì; Bước 2 tạo thật đúng dữ liệu đó; Bước 3 đăng nhập thử.',
        'Nếu đăng ký CANDIDATE, Bước 2 tự lưu vào manualCandidatePhone/manualCandidatePassword để dùng xuyên suốt các thư mục ứng viên bên dưới.'
    ), [registerCheck, registerReal, registerLogin]),
    folder('2 - Hồ sơ cá nhân & Tạo CV trực tuyến của Ứng viên (đồng bộ trang Hồ sơ & CV)', lines(
        'Xem và cập nhật họ tên, địa chỉ, cài đặt tìm việc, kỹ năng và tạo mẫu CV trực tuyến (MongoDB) cho ứng viên manualCandidatePhone.',
        'Đồng bộ trực tiếp lên /candidate/info, /candidate/usersetting và /candidate/ai-cv.'
    ), [candidateProfileView, candidateProfileUpdate, candidateSettingUpdate, candidateCreateOnlineCv]),
    folder('3 - Nhà tuyển dụng đăng tin, Admin duyệt công khai & Sửa/Gỡ tin (đồng bộ trang Việc làm)', lines(
        'Đăng tin mới (PS3), dùng Admin duyệt hiển thị công khai ngay lên trang Việc làm & Elasticsearch (PS1), sửa nội dung tin và gỡ tin (PS4).',
        'Khi Bước 2 duyệt xong, mã tin mới được tự gán vào manualPostId để Ứng viên có thể nộp CV ngay ở Thư mục 4.'
    ), [recruiterCreateJob, adminApproveJob, recruiterLoadJobRevision, recruiterUpdateJob, recruiterCloseJob]),
    folder('4 - Ứng viên nộp CV ứng tuyển (tạo hồ sơ mới & đồng bộ lên Kanban)', lines(
        'Nộp CV PDF mẫu trực tiếp từ Postman bằng tài khoản manualCandidatePhone vào tin manualPostId.',
        'Bước 3 chờ RabbitMQ đồng bộ xong và tự động điền mã hồ sơ mới vào biến manualApplicationId để dùng ngay cho Thư mục 6-9.'
    ), [openJobsList, applyPreflight, applySubmit, applySyncKanban]),
    folder('5 - Chọn hồ sơ ứng tuyển để thao tác', lines(
        'Dùng tài khoản nhà tuyển dụng recruiterPhone/recruiterPassword (mặc định: nhà tuyển dụng công ty B).',
        'Tìm hồ sơ có sẵn, đặt mã hồ sơ vào biến manualApplicationId (nhớ bấm Ctrl+S), xem lại đúng ứng viên trước khi gửi thư.'
    ), [recruiterMe, applicationList, applicationDetail]),
    actionFolder({
        name: '6 - Mời phỏng vấn (hẹn lịch)', key: 'manualInterview', method: 'POST', action: 'interview-invitation', body: interviewBody,
        description: lines(
            'interviewMode: onsite (cần location), online (cần meetingUrl), phone (cần contactPhone). Ngày giờ theo giờ Việt Nam.',
            'Gửi thật: hồ sơ trên Kanban chuyển sang "phỏng vấn", ứng viên nhận email + chuông thông báo realtime + lịch phỏng vấn trên trình duyệt.'
        ),
        after: () => pm.test('Lưu thư mời phỏng vấn, hồ sơ ở bước phong_van', () => pm.expect(pm.response.json().data.stage).to.eql('phong_van'))
    }),
    actionFolder({
        name: '7 - Gửi thư mời nhận việc (trúng tuyển)', key: 'manualOffer', method: 'POST', action: 'decision-notification', body: offerBody,
        description: lines(
            'workMode: onsite hoặc hybrid (cần location), remote (cần meetingUrl). responseDeadline phải trước ngày nhận việc.',
            'Gửi thật: hồ sơ trên Kanban chuyển sang "đề nghị", ứng viên nhận thư mời nhận việc + thông báo realtime trên trình duyệt.'
        ),
        after: () => pm.test('Hồ sơ ở bước de_nghi hoặc nhan_viec', () => pm.expect(pm.response.json().data.stage).to.be.oneOf(['de_nghi', 'nhan_viec']))
    }),
    actionFolder({
        name: '8 - Gửi email từ chối', key: 'manualReject', method: 'POST', action: 'decision-notification',
        body: JSON.stringify({
            decision: 'rejected',
            interviewed: true,
            message: 'Cảm ơn bạn đã dành thời gian ứng tuyển và trao đổi cùng Sao Khuê Digital. Rất tiếc hiện tại chúng tôi chưa thể đồng hành cùng bạn và xin phép lưu hồ sơ cho các cơ hội phù hợp sắp tới.'
        }, null, 2),
        description: lines(
            'interviewed: true (thư cảm ơn đã tham gia phỏng vấn), false (từ chối hồ sơ chưa phỏng vấn / vắng mặt).'
        ),
        after: () => pm.test('Hồ sơ ở bước tu_choi', () => pm.expect(pm.response.json().data.stage).to.eql('tu_choi'))
    }),
    actionFolder({
        name: '9 - Chuyển giai đoạn hồ sơ (như kéo thả trên Kanban)', key: 'manualStage', method: 'PATCH', action: 'stage',
        body: JSON.stringify({
            stage: 'dang_xem_xet',
            reason: 'Phòng Nhân sự đã tiếp nhận và đang đánh giá chuyên môn hồ sơ'
        }, null, 2),
        description: lines(
            'stage nhận 1 trong 6 giá trị: moi_ung_tuyen, dang_xem_xet, phong_van, de_nghi, nhan_viec, tu_choi.',
            'Bước 1 cho biết bước mới có gửi email/thông báo cho ứng viên không (ví dụ "moi_ung_tuyen" thì không gửi email, rất tiện để reset hồ sơ).'
        ),
        after: () => pm.test('Hồ sơ đã ở giai đoạn yêu cầu', () => pm.expect(pm.response.json().data.stage).to.eql(JSON.parse(pm.variables.replaceIn(pm.request.body.raw)).stage))
    }),
    folder('10 - Nhắn tin Chat trực tiếp Ứng viên <-> Nhà tuyển dụng (đồng bộ Chat realtime)', lines(
        'Gửi tin nhắn 2 chiều giữa Ứng viên (manualCandidatePhone) và Nhà tuyển dụng (recruiterPhone).',
        'Tin nhắn và số badge chưa đọc nhảy realtime qua Socket.IO ngay trên trình duyệt (/chat và /admin/chat).'
    ), [chatPrepareIds, chatCandidateToRecruiter, chatRecruiterToCandidate, chatHistoryView]),
    folder('11 - Ứng viên tương tác: Lưu việc làm, Theo dõi & Đánh giá công ty (đồng bộ Web)', lines(
        'Lưu/bỏ lưu tin tuyển dụng (manualPostId), theo dõi/bỏ theo dõi công ty (manualCompanyId) và gửi/xoá đánh giá 5 sao.',
        'Đồng bộ trực tiếp lên /candidate/saved-jobs/, /candidate/followed-jobs và /detail-company/<id>.'
    ), [socialToggleSaveJob, socialToggleFollowCompany, socialReviewCompany, socialDeleteReview])
];

export { manualFolders };
