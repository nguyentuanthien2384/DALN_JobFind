// Direct 1-click manual demo collection: every write request has its full, literal JSON
// sample directly in the Body tab (no 2-step gate, no {{manual...Body}} indirection).
// Just open any request, edit the JSON fields you want, and click Send -> syncs live to Browser.
import { script, req, lines, ok, created } from '../lib.mjs';
import { CV_PDF_DATA_URL } from '../fixtures.mjs';

const VISUAL = `<style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;margin:12px}
.box{padding:10px 12px;border-radius:6px;margin-bottom:12px}
.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}.bad{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
table{border-collapse:collapse;width:100%;margin-bottom:12px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f9fafb;width:240px}
</style>
<div class="box {{#if ok}}ok{{else}}bad{{/if}}"><b>{{title}}</b><br>{{message}}</div>
{{#if rows.length}}<table>{{#each rows}}<tr><th>{{label}}</th><td>{{value}}</td></tr>{{/each}}</table>{{/if}}`;

const showHelper = script(() => {
    const show = (ok, title, message, rows) => pm.visualizer.set(__VISUAL__, { ok, title, message, rows: rows || [] });
}, { VISUAL: JSON.stringify(VISUAL) });

const datesPre = script(() => {
    const vnDate = (days) => new Date(Date.now() + days * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    pm.environment.set('suggestedInterviewDate', vnDate(7));
    pm.environment.set('suggestedConfirmBy', vnDate(5) + 'T17:00');
    pm.environment.set('suggestedStartDate', vnDate(21));
    pm.environment.set('suggestedResponseDeadline', vnDate(14) + 'T17:00');
});

const ensureCandidateId = script(() => {
    const base = pm.environment.get('baseUrl');
    const token = pm.environment.get('manualCandidateAccessToken');
    pm.sendRequest({ url: base + '/api/auth/me', header: { Authorization: 'Bearer ' + token } }, (err, res) => {
        if (!err && res.code === 200 && res.json().data) {
            pm.environment.set('manualCandidateUserId', String(res.json().data.userId));
        }
    });
});

// Auto-resolve manualApplicationId if empty or if a new CV was just submitted in step 08.
const ensureApplicationId = script(() => {
    const base = pm.environment.get('baseUrl');
    const token = pm.environment.get('recruiterAccessToken');
    const currentId = String(pm.environment.get('manualApplicationId') || '');
    const pendingCvId = Number(pm.environment.get('manualLastCvId') || 0);
    if (/^[1-9][0-9]*$/.test(currentId) && !pendingCvId) return;
    pm.sendRequest({ url: base + '/api/applications?limit=50', header: { Authorization: 'Bearer ' + token } }, (err, res) => {
        const list = (!err && res.code === 200 && res.json().data) || [];
        const matched = pendingCvId ? list.find((a) => Number(a.legacy_cv_id) === pendingCvId) : null;
        if (matched) {
            pm.environment.set('manualApplicationId', String(matched.id));
            pm.environment.unset('manualLastCvId');
        } else if (!/^[1-9][0-9]*$/.test(currentId) && list.length) {
            pm.environment.set('manualApplicationId', String(list[0].id));
        }
    });
});

// Resolve userId of another account (by logging in if its UserId variable is not cached yet).
const ensurePeerUserId = (account, phoneVar, passwordVar) => script(() => {
    if (/^[1-9][0-9]*$/.test(String(pm.environment.get('__ACC__UserId') || ''))) return;
    const base = pm.environment.get('baseUrl');
    const origin = pm.environment.get('origin');
    pm.sendRequest({
        url: base + '/api/login', method: 'POST',
        header: { 'Content-Type': 'application/json', Origin: origin },
        body: { mode: 'raw', raw: JSON.stringify({ identifier: pm.environment.get('__PHONE__'), password: pm.environment.get('__PASS__') }) }
    }, (err, res) => {
        if (!err && res.code === 200 && res.json().user) {
            pm.environment.set('__ACC__UserId', String(res.json().user.id));
            pm.environment.set('__ACC__AccessToken', res.json().token);
        }
    });
}, { ACC: account, PHONE: phoneVar, PASS: passwordVar });

const demoDirectItems = [
    req('01 - Đăng nhập lấy JWT Token (Test trực tiếp API Login)', {
        method: 'POST', path: '/api/login', headers: { Origin: '{{origin}}' },
        description: 'Điền SĐT hoặc Email vào "identifier" và mật khẩu vào "password" rồi bấm Send.',
        body: JSON.stringify({
            identifier: '0918800001',
            password: 'Demo@123456'
        }, null, 2),
        test: [...showHelper, ...ok(() => {
            const resBody = pm.response.json();
            const u = resBody.user || {};
            show(true, 'Đăng nhập thành công (User #' + u.id + ')', 'JWT Access Token đã trả về trong JSON body.', [
                { label: 'Mã người dùng', value: u.id },
                { label: 'Vai trò', value: u.roleCode },
                { label: 'Họ và tên', value: [u.firstName, u.lastName].filter(Boolean).join(' ') },
                { label: 'JWT Access Token', value: String(resBody.token || '').slice(0, 48) + '...' }
            ]);
        })]
    }),

    req('02 - Đăng ký tài khoản mới (Điền thông tin & Send tạo ngay)', {
        method: 'POST', path: '/api/create-new-user',
        description: 'Chỉ cần sửa "phonenumber" (10 số mới), "email" (email thật của bạn), "firstName", "lastName" rồi bấm Send là tạo thật ngay!',
        body: JSON.stringify({
            roleCode: 'CANDIDATE',
            firstName: 'Nguyễn',
            lastName: 'Văn Demo',
            phonenumber: '0988123456',
            email: 'dien-email-that-cua-ban@gmail.com',
            password: 'User@123456'
        }, null, 2),
        test: [...showHelper, ...script(() => {
            const resBody = pm.response.json();
            const sent = JSON.parse(pm.variables.replaceIn(pm.request.body.raw));
            const webOrigin = pm.environment.get('origin') || '';
            const passed = pm.response.code === 200 && resBody.errCode === 0;
            pm.test('Tạo tài khoản thành công', () => pm.expect(passed, resBody.errMessage).to.be.true);
            if (passed) {
                if (sent.roleCode === 'CANDIDATE' && sent.password) {
                    pm.environment.set('manualCandidatePhone', sent.phonenumber);
                    pm.environment.set('manualCandidatePassword', sent.password);
                    pm.environment.set('manualCandidateAccessToken', '');
                    pm.environment.set('manualCandidateRefreshToken', '');
                    pm.environment.unset('manualCandidateUserId');
                }
                show(true, 'Đã tạo tài khoản thành công: ' + sent.phonenumber,
                    'Tài khoản đã đồng bộ lên hệ thống và tự động gán cho các bước Ứng viên bên dưới!', [
                        { label: 'Số điện thoại đăng nhập', value: sent.phonenumber },
                        { label: 'Email', value: sent.email },
                        { label: 'Vai trò', value: sent.roleCode },
                        { label: 'Đăng nhập ngay trên Trình duyệt', value: webOrigin + '/login' }
                    ]);
            } else {
                const errs = resBody.fieldErrors || {};
                show(false, 'Chưa tạo được - kiểm tra lại thông tin', resBody.errMessage || 'Lỗi dữ liệu',
                    Object.keys(errs).map((k) => ({ label: k, value: errs[k] })));
            }
        })]
    }),

    req('03 - Cập nhật hồ sơ cá nhân Ứng viên', {
        method: 'PUT', path: '/api/update-user', token: 'manualCandidate', pre: ensureCandidateId,
        description: 'Sửa họ tên, địa chỉ, giới tính (M / FE), ngày sinh rồi bấm Send -> F5 trang /candidate/info trên trình duyệt.',
        body: JSON.stringify({
            id: '__CANDIDATE_ID__',
            firstName: 'Nguyễn',
            lastName: 'Văn Demo',
            address: '125 Nguyễn Văn Linh, Quận Hải Châu, Đà Nẵng',
            genderCode: 'M',
            dob: '2002-08-20'
        }, null, 2).replace('"__CANDIDATE_ID__"', '{{manualCandidateUserId}}'),
        test: [...showHelper, ...ok(() => {
            const u = pm.response.json().user || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã cập nhật hồ sơ cá nhân', 'Đồng bộ lên trang Thông tin tài khoản trên trình duyệt.', [
                { label: 'Họ tên', value: [u.firstName, u.lastName].filter(Boolean).join(' ') },
                { label: 'Địa chỉ', value: u.address || '' },
                { label: 'Xem trên trình duyệt', value: webOrigin + '/candidate/info' }
            ]);
        })]
    }),

    req('04 - Tạo CV trực tuyến cho Ứng viên (MongoDB Identity)', {
        method: 'POST', path: '/api/profile/cvs', token: 'manualCandidate',
        description: 'Sửa thông tin CV trực tuyến rồi bấm Send -> F5 trang /candidate/ai-cv trên trình duyệt.',
        body: JSON.stringify({
            title: 'CV Fullstack Web Developer - Nguyễn Văn Demo',
            template: 'modern',
            fullName: 'Nguyễn Văn Demo',
            email: 'nguyenvandemo@gmail.com',
            phone: '0988123456',
            address: 'Quận Hải Châu, Đà Nẵng',
            summary: 'Lập trình viên Web có nền tảng vững về ReactJS, Node.js, RESTful API, MySQL/PostgreSQL và Docker.',
            skills: ['JavaScript (ES6+)', 'ReactJS', 'Node.js / Express', 'MySQL & PostgreSQL', 'Docker', 'Git'],
            languages: ['Tiếng Việt (Bản ngữ)', 'Tiếng Anh (Đọc hiểu tài liệu kỹ thuật)'],
            experiences: [
                {
                    company: 'Dự án Website Tuyển dụng JobFind',
                    position: 'Fullstack Developer',
                    from: '01/2026',
                    to: 'Hiện tại',
                    description: 'Xây dựng hệ thống tuyển dụng Microservices với ReactJS, Node.js, API Gateway, RabbitMQ và Elasticsearch.'
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
            show(true, 'Đã tạo CV trực tuyến #' + cv._id, 'Đồng bộ ngay lên mục CV và trợ lý AI của Ứng viên.', [
                { label: 'Tiêu đề CV', value: cv.title },
                { label: 'Xem trên trình duyệt', value: webOrigin + '/candidate/ai-cv' }
            ]);
        })]
    }),

    req('05 - Nhà tuyển dụng đăng tin tuyển dụng mới', {
        method: 'POST', path: '/api/jobs', token: 'recruiter',
        headers: { 'Idempotency-Key': '{{manualJobIdempotencyKey}}' },
        description: 'Sửa tiêu đề "name", mô tả, mức lương, địa điểm rồi bấm Send. Sau đó bấm tiếp request 06 để Admin duyệt hiển thị công khai.',
        pre: script(() => {
            pm.environment.set('manualJobIdempotencyKey', 'demo-job-' + Date.now());
            pm.environment.set('manualJobTimeEnd', String(Date.now() + 30 * 24 * 3600 * 1000));
        }),
        body: JSON.stringify({
            name: '[Demo Live] Tuyển Lập trình viên Fullstack (ReactJS / Node.js)',
            descriptionHTML: '<h3>Mô tả công việc</h3><ul><li>Phát triển giao diện web với <b>ReactJS</b> và hệ thống Microservices <b>Node.js</b>.</li><li>Làm việc với MySQL, PostgreSQL, RabbitMQ, Docker.</li></ul><h3>Yêu cầu</h3><ul><li>Có kiến thức tốt về JavaScript, Reactjs, Nodejs, SQL.</li></ul><h3>Quyền lợi</h3><ul><li>Thu nhập 10 - 15 triệu/tháng + thưởng dự án, đóng BHXH đầy đủ.</li></ul>',
            descriptionMarkdown: '### Mô tả công việc\n- Phát triển Web ReactJS & Node.js.\n### Yêu cầu\n- JavaScript, Reactjs, Nodejs, SQL.\n### Quyền lợi\n- Lương 10 - 15 triệu/tháng.',
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
        }, null, 2),
        test: [...showHelper, ...created(() => {
            const job = pm.response.json().data;
            const webOrigin = pm.environment.get('origin') || '';
            pm.environment.set('manualCreatedJobId', String(job.id));
            pm.environment.set('manualCreatedJobRevision', job.editRevision || '');
            show(true, 'Đã tạo tin mới #' + job.id + ' (Chờ duyệt PS3)',
                'Bấm tiếp request "06 - Admin duyệt tin..." ngay bên dưới để tin hiển thị công khai lên trang Việc làm!', [
                    { label: 'Mã tin mới', value: job.id },
                    { label: 'Tiêu đề', value: job.name },
                    { label: 'Quản lý tin NTD (Web)', value: webOrigin + '/admin/list-post' }
                ]);
        })]
    }),

    req('06 - Admin duyệt tin vừa đăng lên công khai (PS1)', {
        method: 'PUT', path: '/api/accept-post', token: 'admin',
        description: 'Duyệt tin vừa tạo ở bước 05 (hoặc vừa sửa ở bước 07) lên trạng thái công khai PS1 và tự gán vào manualPostId cho bước 08 nộp CV.',
        pre: script(() => {
            const id = pm.environment.get('manualCreatedJobId') || pm.environment.get('manualPostId');
            const adminToken = pm.environment.get('adminAccessToken');
            if (id) pm.environment.set('manualCreatedJobId', String(id));
            if (id && adminToken) {
                pm.sendRequest({
                    url: pm.environment.get('baseUrl') + '/api/get-all-post-admin?limit=20&offset=0&search=' + encodeURIComponent(String(id)),
                    header: { Authorization: 'Bearer ' + adminToken }
                }, (err, res) => {
                    const rows = (!err && res.code === 200 && res.json().data) || [];
                    const live = rows.find((p) => Number(p.id) === Number(id));
                    if (live) {
                        pm.environment.set('manualCreatedJobRevision', live.editRevision);
                        if (live.statusCode === 'PS1') {
                            pm.environment.set('manualPostId', String(live.id));
                            console.log('Tin #' + live.id + ' đã ở trạng thái công khai PS1!');
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
            show(true, 'Tin #' + id + ' đã lên sóng công khai (PS1)',
                'Đã tự gán manualPostId = ' + id + '. Mở trang Việc làm trên trình duyệt là thấy ngay!', [
                    { label: 'Chi tiết tin trên trình duyệt', value: webOrigin + '/detail-job/' + id },
                    { label: 'Trang danh sách Việc làm', value: webOrigin + '/job' }
                ]);
        })]
    }),

    req('07 - Nhà tuyển dụng sửa nội dung tin tuyển dụng', {
        method: 'PUT', path: '/api/jobs/{{manualPostId}}', token: 'recruiter',
        description: 'Pre-request tự động lấy editRevision mới nhất của tin manualPostId; bạn chỉ việc sửa JSON bên dưới rồi bấm Send!',
        pre: script(() => {
            const id = pm.environment.get('manualPostId');
            const token = pm.environment.get('recruiterAccessToken');
            pm.sendRequest({
                url: pm.environment.get('baseUrl') + '/api/jobs/' + id + '/manage',
                header: { Authorization: 'Bearer ' + token }
            }, (err, res) => {
                if (!err && res.code === 200 && res.json().data) {
                    pm.environment.set('manualEditJobRevision', res.json().data.editRevision);
                }
            });
        }),
        body: JSON.stringify({
            name: '[Demo Live] Tuyển Lập trình viên Fullstack ReactJS / Node.js (Đã cập nhật)',
            descriptionHTML: '<h3>Mô tả công việc (Cập nhật)</h3><ul><li>Phát triển Web với <b>ReactJS</b> và Microservices <b>Node.js</b>.</li></ul><h3>Yêu cầu</h3><ul><li>Từ 1 năm kinh nghiệm JavaScript, Reactjs, Nodejs, SQL, Docker.</li></ul><h3>Quyền lợi</h3><ul><li>Thu nhập 12 - 18 triệu/tháng + thưởng quý.</li></ul>',
            descriptionMarkdown: '### Mô tả công việc (Cập nhật)\n- ReactJS & Node.js Microservices.\n### Quyền lợi\n- Lương 12 - 18 triệu/tháng.',
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
            pm.environment.set('manualCreatedJobId', String(job.id));
            pm.environment.set('manualCreatedJobRevision', job.editRevision || '');
            show(true, 'Đã sửa tin #' + job.id + ' (Trạng thái: ' + job.statusCode + ')',
                job.statusCode === 'PS3' ? 'Tin sửa nội dung chuyển sang PS3 chờ duyệt lại (bấm lại bước 06 nếu muốn duyệt công khai ngay).' : 'Đã đồng bộ lên trình duyệt.', [
                    { label: 'Tiêu đề mới', value: job.name },
                    { label: 'Quản lý tin NTD (Web)', value: webOrigin + '/admin/list-post' }
                ]);
        })]
    }),

    req('08 - Ứng viên nộp CV ứng tuyển vào tin (Tự đồng bộ sang Kanban)', {
        method: 'POST', path: '/api/create-new-cv', token: 'manualCandidate',
        description: 'Nộp CV PDF mẫu vào tin manualPostId (mặc định #234 hoặc tin mới tạo ở bước 05-06). Tự động đồng bộ sang Kanban và lưu manualApplicationId!',
        body: JSON.stringify({
            postId: '__POST_ID__',
            description: 'Em xin ứng tuyển vị trí Lập trình viên tại quý công ty. Em có kinh nghiệm làm việc với ReactJS, Node.js, SQL và Docker. Rất mong nhận được cơ hội phỏng vấn ạ!',
            file: CV_PDF_DATA_URL
        }, null, 2).replace('"__POST_ID__"', '{{manualPostId}}'),
        test: [...showHelper, ...script(() => {
            const resBody = pm.response.json();
            const webOrigin = pm.environment.get('origin') || '';
            const okApply = (pm.response.code === 200 && resBody.errCode === 0) || (pm.response.code === 409 && resBody.errCode === 5);
            pm.test('Nộp CV thành công (hoặc đã nộp trước đó)', () => pm.expect(okApply, resBody.errMessage).to.be.true);
            if (resBody.cvId) {
                pm.environment.set('manualLastCvId', String(resBody.cvId));
                // Thu lay luon manualApplicationId neu recruiterAccessToken da co san
                const recToken = pm.environment.get('recruiterAccessToken');
                if (recToken) {
                    const targetCv = Number(resBody.cvId);
                    setTimeout(() => {
                        pm.sendRequest({
                            url: pm.environment.get('baseUrl') + '/api/applications?jobId=' + pm.environment.get('manualPostId') + '&limit=50',
                            header: { Authorization: 'Bearer ' + recToken }
                        }, (err, r) => {
                            const found = (!err && r.code === 200 && (r.json().data || []).find((a) => Number(a.legacy_cv_id) === targetCv)) || null;
                            if (found) {
                                pm.environment.set('manualApplicationId', String(found.id));
                                pm.environment.unset('manualLastCvId');
                            }
                        });
                    }, 1200);
                }
                show(true, (resBody.errCode === 0 ? 'Đã nộp CV mới thành công' : 'Ứng viên đã nộp tin này trước đó') + ' (cvId #' + resBody.cvId + ')',
                    'Hồ sơ đang đồng bộ qua RabbitMQ sang bảng Kanban. Bạn có thể bấm F5 Kanban trên trình duyệt hoặc chạy tiếp bước 10 (Mời phỏng vấn) ngay!', [
                        { label: 'Mã CV (cvId)', value: resBody.cvId },
                        { label: 'Mã tin (postId)', value: pm.environment.get('manualPostId') },
                        { label: 'Bảng Kanban NTD (Web)', value: webOrigin + '/admin/pipeline' },
                        { label: 'Việc làm đã nộp UV (Web)', value: webOrigin + '/candidate/cv-post/' }
                    ]);
            }
        })]
    }),

    req('09 - Xem danh sách hồ sơ trên Kanban công ty', {
        path: '/api/applications?q={{manualSearch}}&limit=50', token: 'recruiter',
        description: 'Xem toàn bộ hồ sơ trên bảng Kanban của công ty (và tự gán hồ sơ mới nhất vào manualApplicationId nếu đang trống).',
        test: [...showHelper, ...ok(() => {
            const list = pm.response.json().data || [];
            const pendingCv = Number(pm.environment.get('manualLastCvId') || 0);
            const matched = pendingCv ? list.find((a) => Number(a.legacy_cv_id) === pendingCv) : null;
            if (matched) {
                pm.environment.set('manualApplicationId', String(matched.id));
                pm.environment.unset('manualLastCvId');
            } else if (!pm.environment.get('manualApplicationId') && list.length) {
                pm.environment.set('manualApplicationId', String(list[0].id));
            }
            const rows = list.map((a) => ({
                label: 'Mã hồ sơ ' + a.id,
                value: (a.candidate_name || '') + ' <' + (a.candidate_email || '') + '> · ' + (a.job_title || '') + ' · Cột: ' + a.stage
            }));
            show(true, list.length + ' hồ sơ trên Kanban (Đang chọn manualApplicationId = ' + (pm.environment.get('manualApplicationId') || 'chưa có') + ')',
                'Muốn thao tác trên hồ sơ khác, sửa Current value của biến manualApplicationId trong Environment rồi bấm Ctrl+S.', rows);
        })]
    }),

    req('10 - Mời phỏng vấn & Gửi Email thật ngay (Điền JSON & Send)', {
        method: 'POST', path: '/api/applications/{{manualApplicationId}}/interview-invitation', token: 'recruiter',
        pre: [...datesPre, ...ensureApplicationId],
        description: lines(
            'Điền thẳng thông tin phỏng vấn vào JSON bên dưới rồi bấm Send -> Lưu lịch, chuyển cột Kanban sang "Phỏng vấn", bắn chuông thông báo Realtime & gửi Email thật!',
            'Lưu ý: nếu đổi "interviewMode" sang "online" thì điền link Google Meet/Zoom vào "meetingUrl".'
        ),
        body: JSON.stringify({
            message: 'Chào bạn, hồ sơ của bạn rất phù hợp với vị trí đang tuyển. Mời bạn tham dự buổi phỏng vấn theo lịch hẹn dưới đây.',
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
        }, null, 2),
        test: [...showHelper, ...ok(() => {
            const app = pm.response.json().data || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã gửi thư mời phỏng vấn cho Hồ sơ #' + app.id,
                'Đã chuyển sang cột "phong_van", bắn thông báo Realtime & xếp hàng gửi Email thật tới ' + (app.candidate_email || ''), [
                    { label: 'Ứng viên nhận email', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
                    { label: 'Cột Kanban hiện tại', value: app.stage },
                    { label: 'Kanban & Lịch PV NTD (Web)', value: webOrigin + '/admin/pipeline  |  ' + webOrigin + '/admin/interviews' },
                    { label: 'Lịch PV & Thông báo Ứng viên (Web)', value: webOrigin + '/candidate/interviews  |  ' + webOrigin + '/candidate/notifications' }
                ]);
        })]
    }),

    req('11 - Gửi thư mời nhận việc (Offer trúng tuyển) & Email thật ngay', {
        method: 'POST', path: '/api/applications/{{manualApplicationId}}/decision-notification', token: 'recruiter',
        pre: [...datesPre, ...ensureApplicationId],
        description: 'Sửa mức lương "salary", ngày đi làm, chế độ đãi ngộ trong JSON bên dưới rồi bấm Send -> Gửi Email Offer thật & chuyển cột Kanban sang "Đề nghị"!',
        body: JSON.stringify({
            decision: 'accepted',
            message: 'Chúc mừng bạn đã vượt qua kỳ phỏng vấn! Sao Khuê Digital trân trọng gửi tới bạn thư mời nhận việc chính thức.',
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
                benefits: 'Đóng BHXH đầy đủ theo luật, 12 ngày phép/năm, thưởng lễ Tết và xét tăng lương 2 lần/năm',
                requiredDocuments: 'CCCD công chứng, sơ yếu lý lịch, bản sao bằng tốt nghiệp/bảng điểm và 02 ảnh 3x4',
                onboardingInstructions: 'Vui lòng có mặt tại quầy Lễ tân tầng 5 lúc 08:15 ngày nhận việc để nhận thiết bị và tài khoản'
            }
        }, null, 2),
        test: [...showHelper, ...ok(() => {
            const app = pm.response.json().data || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã gửi thư mời nhận việc (Offer) cho Hồ sơ #' + app.id,
                'Đã chuyển sang cột "' + app.stage + '", bắn thông báo Realtime & gửi Email Offer tới ' + (app.candidate_email || ''), [
                    { label: 'Ứng viên nhận Offer', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
                    { label: 'Kanban NTD (Web)', value: webOrigin + '/admin/pipeline' },
                    { label: 'Việc đã nộp & Thông báo UV (Web)', value: webOrigin + '/candidate/cv-post/  |  ' + webOrigin + '/candidate/notifications' }
                ]);
        })]
    }),

    req('12 - Gửi email Cảm ơn & Từ chối hồ sơ', {
        method: 'POST', path: '/api/applications/{{manualApplicationId}}/decision-notification', token: 'recruiter',
        pre: ensureApplicationId,
        description: 'Sửa lời nhắn "message" ("interviewed": true nếu đã phỏng vấn, false nếu chưa phỏng vấn) rồi bấm Send.',
        body: JSON.stringify({
            decision: 'rejected',
            interviewed: true,
            message: 'Cảm ơn bạn đã dành thời gian tham gia phỏng vấn tại Sao Khuê Digital. Rất tiếc hiện tại chúng tôi chưa thể đồng hành cùng bạn và xin phép lưu hồ sơ cho các đợt tuyển dụng tiếp theo.'
        }, null, 2),
        test: [...showHelper, ...ok(() => {
            const app = pm.response.json().data || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã gửi email từ chối Hồ sơ #' + app.id, 'Hồ sơ trên Kanban đã chuyển sang cột "tu_choi".', [
                { label: 'Ứng viên', value: (app.candidate_name || '') + ' <' + (app.candidate_email || '') + '>' },
                { label: 'Kanban NTD (Web)', value: webOrigin + '/admin/pipeline' }
            ]);
        })]
    }),

    req('13 - Chuyển cột giai đoạn hồ sơ trên bảng Kanban', {
        method: 'PATCH', path: '/api/applications/{{manualApplicationId}}/stage', token: 'recruiter',
        pre: ensureApplicationId,
        description: 'Đổi "stage" thành 1 trong 6 cột: moi_ung_tuyen, dang_xem_xet, phong_van, de_nghi, nhan_viec, tu_choi rồi bấm Send. (Dùng "moi_ung_tuyen" để reset hồ sơ mà không gửi email).',
        body: JSON.stringify({
            stage: 'dang_xem_xet',
            reason: 'Phòng Nhân sự đang đánh giá hồ sơ chuyên môn'
        }, null, 2),
        test: [...showHelper, ...ok(() => {
            const app = pm.response.json().data || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã chuyển Hồ sơ #' + app.id + ' sang cột: ' + app.stage, 'Bấm F5 bảng Kanban trên trình duyệt sẽ thấy thẻ hồ sơ nhảy sang cột mới!', [
                { label: 'Cột Kanban mới', value: app.stage },
                { label: 'Bảng Kanban NTD (Web)', value: webOrigin + '/admin/pipeline' }
            ]);
        })]
    }),

    req('14 - Ứng viên gửi tin nhắn Chat Realtime cho Nhà tuyển dụng', {
        method: 'POST', path: '/api/send-chat-message', token: 'manualCandidate',
        description: 'Sửa nội dung "content" rồi bấm Send -> Tin nhắn nhảy Realtime ngay lập tức trên màn hình Chat của Nhà tuyển dụng!',
        pre: [...ensurePeerUserId('recruiter', 'recruiterPhone', 'recruiterPassword'), ...script(() => {
            pm.environment.set('manualChatMsgId', 'demo-cand-chat-' + Date.now());
        })],
        body: JSON.stringify({
            v: 1,
            receiverId: '__RECRUITER_ID__',
            content: 'Em chào anh/chị HR Sao Khuê Digital ạ! Em vừa nộp CV ứng tuyển, cho em hỏi quy trình phỏng vấn của vị trí này gồm mấy vòng ạ?',
            clientMessageId: '{{manualChatMsgId}}'
        }, null, 2).replace('"__RECRUITER_ID__"', '{{recruiterUserId}}'),
        test: [...showHelper, ...ok(() => {
            const msg = pm.response.json().data;
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã gửi tin nhắn Realtime #' + msg.id, 'Tin nhắn đã hiển thị tức thì trên khung Chat trình duyệt!', [
                { label: 'Nội dung', value: msg.content },
                { label: 'Khung Chat NTD (Web)', value: webOrigin + '/admin/chat/' + msg.senderId },
                { label: 'Khung Chat Ứng viên (Web)', value: webOrigin + '/chat' }
            ]);
        })]
    }),

    req('15 - Nhà tuyển dụng trả lời Chat Realtime cho Ứng viên', {
        method: 'POST', path: '/api/send-chat-message', token: 'recruiter',
        description: 'Sửa câu trả lời "content" rồi bấm Send -> Tin nhắn nhảy Realtime ngay trên màn hình Chat của Ứng viên!',
        pre: [...ensurePeerUserId('manualCandidate', 'manualCandidatePhone', 'manualCandidatePassword'), ...script(() => {
            pm.environment.set('manualChatReplyId', 'demo-rec-chat-' + Date.now());
        })],
        body: JSON.stringify({
            v: 1,
            receiverId: '__CANDIDATE_ID__',
            content: 'Chào bạn nhé! Vị trí này chỉ gồm 1 vòng phỏng vấn chuyên môn cùng Tech Lead (60 phút). Bên mình vừa gửi thư mời phỏng vấn qua email cho bạn đó!',
            clientMessageId: '{{manualChatReplyId}}'
        }, null, 2).replace('"__CANDIDATE_ID__"', '{{manualCandidateUserId}}'),
        test: [...showHelper, ...ok(() => {
            const msg = pm.response.json().data;
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã trả lời tin nhắn Realtime #' + msg.id, 'Khung Chat của Ứng viên trên trình duyệt đã nhận được ngay!', [
                { label: 'Nội dung trả lời', value: msg.content },
                { label: 'Khung Chat Ứng viên (Web)', value: webOrigin + '/chat' }
            ]);
        })]
    }),

    req('16 - Ứng viên Lưu / Bỏ lưu việc làm yêu thích', {
        method: 'POST', path: '/api/toggle-favorite-post', token: 'manualCandidate',
        description: 'Điền mã tin "postId" rồi bấm Send (lần 1 Lưu, lần 2 Bỏ lưu) -> Đồng bộ trang /candidate/saved-jobs/.',
        body: JSON.stringify({
            postId: '__POST_ID__'
        }, null, 2).replace('"__POST_ID__"', '{{manualPostId}}'),
        test: [...showHelper, ...ok(() => {
            const saved = Boolean(pm.response.json().isFavorite);
            const webOrigin = pm.environment.get('origin') || '';
            show(true, saved ? 'Đã lưu việc làm yêu thích' : 'Đã bỏ lưu việc làm', 'F5 trang Việc làm đã lưu để xem.', [
                { label: 'Xem trên trình duyệt', value: webOrigin + '/candidate/saved-jobs/' }
            ]);
        })]
    }),

    req('17 - Ứng viên Theo dõi / Bỏ theo dõi công ty', {
        method: 'POST', path: '/api/toggle-follow-company', token: 'manualCandidate',
        description: 'Điền mã công ty "companyId" (mặc định 28 = Sao Khuê Digital) rồi bấm Send.',
        body: JSON.stringify({
            companyId: '__COMPANY_ID__'
        }, null, 2).replace('"__COMPANY_ID__"', '{{manualCompanyId}}'),
        test: [...showHelper, ...ok(() => {
            const cid = pm.environment.get('manualCompanyId');
            const webOrigin = pm.environment.get('origin') || '';
            show(true, pm.response.json().errMessage || 'Đã cập nhật theo dõi công ty', 'Đồng bộ lên trang Công ty.', [
                { label: 'Trang công ty (Web)', value: webOrigin + '/detail-company/' + cid }
            ]);
        })]
    }),

    req('18 - Ứng viên viết Đánh giá 5 sao cho công ty', {
        method: 'POST', path: '/api/create-company-review', token: 'manualCandidate',
        description: 'Sửa số sao "star" (1-5) và nhận xét "content" rồi bấm Send -> F5 trang /detail-company/28 thấy đánh giá ngay!',
        body: JSON.stringify({
            companyId: '__COMPANY_ID__',
            star: 5,
            content: 'Quy trình phỏng vấn của Sao Khuê Digital rất chuyên nghiệp, phản hồi nhanh và tôn trọng ứng viên!'
        }, null, 2).replace('"__COMPANY_ID__"', '{{manualCompanyId}}'),
        test: [...showHelper, ...ok(() => {
            const cid = pm.environment.get('manualCompanyId');
            const webOrigin = pm.environment.get('origin') || '';
            show(true, pm.response.json().errMessage || 'Đã đăng đánh giá công ty', 'F5 trang Chi tiết công ty trên trình duyệt để xem đánh giá.', [
                { label: 'Xem đánh giá trên trình duyệt', value: webOrigin + '/detail-company/' + cid }
            ]);
        })]
    }),

    req('19 - [Search Service - Elasticsearch] Tìm kiếm việc làm chịu lỗi sai chính tả (CQRS Read)', {
        path: '/api/search/jobs?q=develper&limit=5',
        description: 'Thử cố tình gõ sai chính tả từ khoá "q" ở tab Params (ví dụ "develper" thiếu chữ o, hoặc đổi thành "react", "nodejs") rồi bấm Send -> Elasticsearch vẫn chấm điểm _score và tìm ra tin!',
        test: [...showHelper, ...ok(() => {
            const resBody = pm.response.json();
            const jobs = resBody.data || [];
            const webOrigin = pm.environment.get('origin') || '';
            const rows = jobs.map((j) => ({
                label: 'Tin #' + j.id + ' (_score: ' + Number(j._score || 0).toFixed(2) + ')',
                value: (j.name || '') + ' · Địa điểm: ' + (j.addressCode || '') + ' · Lương: ' + (j.salaryJobCode || '')
            }));
            rows.push({ label: 'Trang tìm kiếm Việc làm (Web)', value: webOrigin + '/job' });
            show(true, 'Elasticsearch tìm thấy ' + (resBody.count || jobs.length) + ' việc làm phù hợp',
                'Dù từ khoá gõ thiếu chữ ("develper"), Search Service vẫn tìm đúng nhờ Fuzzy Matching trên Elasticsearch!', rows);
        })]
    }),

    req('20 - [Search Service - Elasticsearch] Bộ đếm bộ lọc đa chiều (Facets Aggregation)', {
        path: '/api/search/facets',
        description: 'Bấm Send để xem Elasticsearch thống kê tức thì số lượng tin theo từng Ngành nghề, Tỉnh thành, Mức lương (dùng cho cột bộ lọc bên trái trang Việc làm).',
        test: [...showHelper, ...ok(() => {
            const facets = pm.response.json().data || {};
            const topCats = (facets.categories || []).slice(0, 4).map((b) => b.code + ' (' + b.count + ')').join(', ');
            const topProvs = (facets.provinces || []).slice(0, 4).map((b) => b.code + ' (' + b.count + ')').join(', ');
            const topSals = (facets.salaries || []).slice(0, 4).map((b) => b.code + ' (' + b.count + ')').join(', ');
            show(true, 'Đã tổng hợp Facets từ Elasticsearch', 'Số đếm bộ lọc hiển thị theo thời gian thực trên trang tìm kiếm việc làm.', [
                { label: 'Top Ngành nghề', value: topCats || 'Chưa có' },
                { label: 'Top Tỉnh / Thành phố', value: topProvs || 'Chưa có' },
                { label: 'Top Mức lương', value: topSals || 'Chưa có' }
            ]);
        })]
    }),

    req('21 - [Admin Service - Đa CSDL] Báo cáo thống kê tổng quan toàn hệ thống', {
        path: '/api/admin/reports/overview', token: 'admin',
        description: 'Bấm Send để Admin Service gom số liệu trực tiếp từ MySQL (người dùng, công ty, tin, doanh thu) + PostgreSQL (phễu hồ sơ Kanban) -> Đồng bộ trang /admin/reports.',
        test: [...showHelper, ...ok(() => {
            const ov = pm.response.json().data || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Báo cáo tổng hợp đa nguồn CSDL (MySQL + PostgreSQL + MongoDB)',
                'Dữ liệu tổng hợp cho Dashboard Quản trị viên toàn sàn JobFind.', [
                    { label: 'Người dùng hoạt động (MySQL)', value: ((ov.nguoiDung && ov.nguoiDung.tong) || 0) + ' (Mới 30 ngày: ' + ((ov.nguoiDung && ov.nguoiDung.moi) || 0) + ')' },
                    { label: 'Tổng số công ty (MySQL)', value: ov.congTy || 0 },
                    { label: 'Tin tuyển dụng (MySQL)', value: 'Đang hiển thị PS1: ' + ((ov.tinTuyenDung && ov.tinTuyenDung.dangHienThi) || 0) + ' | Chờ duyệt PS3: ' + ((ov.tinTuyenDung && ov.tinTuyenDung.choDuyet) || 0) },
                    { label: 'Hồ sơ Kanban 30 ngày (PostgreSQL)', value: 'Tổng nộp: ' + ((ov.hoSoUngTuyen && ov.hoSoUngTuyen.tong) || 0) + ' | Đã nhận việc: ' + ((ov.hoSoUngTuyen && ov.hoSoUngTuyen.daTuyen) || 0) },
                    { label: 'Tổng doanh thu 30 ngày (USD)', value: ((ov.doanhThu && ov.doanhThu.tong) || 0) + ' (Gói đăng tin: ' + ((ov.doanhThu && ov.doanhThu.goiTin) || 0) + ' | Gói xem CV: ' + ((ov.doanhThu && ov.doanhThu.goiXemCv) || 0) + ')' },
                    { label: 'Dashboard Báo cáo Admin (Web)', value: webOrigin + '/admin/reports' }
                ]);
        })]
    }),

    req('22 - [Admin Service - MongoDB Audit] Xem Nhật ký kiểm toán các thao tác vừa chạy', {
        path: '/api/admin/audit?kind=action&limit=10', token: 'admin',
        description: 'Bấm Send để xem 10 bản ghi Audit Log mới nhất trong MongoDB — ghi lại chính xác các thao tác Đăng tin, Duyệt tin, Mời phỏng vấn, Gửi Offer... vừa chạy qua API Gateway kèm mã vết X-Correlation-Id!',
        test: [...showHelper, ...ok(() => {
            const logs = pm.response.json().data || [];
            const webOrigin = pm.environment.get('origin') || '';
            const rows = logs.map((row) => ({
                label: (row.name || 'action') + ' [HTTP ' + row.status + ']',
                value: 'User #' + (row.actorId || '-') + ' · Lúc: ' + (row.createdAt || '') + ' · Trace: ' + (row.correlationId || '')
            }));
            rows.push({ label: 'Xem trên trang Báo cáo Admin (Web)', value: webOrigin + '/admin/reports' });
            show(true, logs.length + ' bản ghi Nhật ký kiểm toán (Audit Logs) mới nhất từ MongoDB',
                'Mọi thao tác ghi đi qua API Gateway và RabbitMQ đều được lưu vết bất đồng bộ vào MongoDB.', rows);
        })]
    }),

    req('23 - [Support Chat Service - SSE] Hỏi Trợ lý ảo Chatbot hỗ trợ (Streaming SSE)', {
        method: 'POST', path: '/api/support/turn', token: 'manualCandidate',
        description: 'Sửa câu hỏi "text" trong JSON bên dưới rồi bấm Send -> Nhận dòng sự kiện trực tiếp Server-Sent Events (state -> token -> done), hiển thị câu trả lời ở tab Visualize và đồng bộ vào bong bóng Chatbot góc dưới trình duyệt!',
        body: JSON.stringify({
            requestId: '{{$guid}}',
            text: 'Trạng thái hồ sơ ứng tuyển của tôi thế nào?'
        }, null, 2),
        test: [...showHelper, ...script(() => {
            pm.test('HTTP 200 (SSE Stream)', () => pm.response.to.have.status(200));
            pm.test('Content-Type text/event-stream', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('text/event-stream'));
            const rawStream = pm.response.text();
            const events = rawStream.split(/\r?\n\r?\n/).filter((c) => c.trim()).map((chunk) => {
                const name = (/^event: (.+)$/m.exec(chunk) || [])[1];
                const rawPayload = (/^data: (.+)$/m.exec(chunk) || [])[1];
                let parsed = null;
                try { parsed = rawPayload ? JSON.parse(rawPayload) : null; } catch (e) { parsed = null; }
                return { name, payload: parsed };
            });
            const stateEv = events.find((e) => e.name === 'state');
            if (stateEv && stateEv.payload && stateEv.payload.id) {
                pm.environment.set('manualSupportConvId', stateEv.payload.id);
            }
            const fullAnswer = events.filter((e) => e.name === 'token')
                .map((e) => (e.payload && e.payload.text) || '').join('');
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Trợ lý Chatbot đã trả lời qua luồng SSE (' + events.length + ' sự kiện stream)',
                'Hội thoại đã lưu và đồng bộ lên bong bóng Trợ lý hỗ trợ góc dưới bên phải trang Web của Ứng viên!', [
                    { label: 'Mã hội thoại (manualSupportConvId)', value: pm.environment.get('manualSupportConvId') || '' },
                    { label: 'Câu trả lời của Chatbot', value: fullAnswer || '(Không có nội dung text)' },
                    { label: 'Xem bong bóng Chatbot trên Web', value: webOrigin }
                ]);
        })]
    }),

    req('24 - [Support Chat Service] Chuyển hội thoại Chatbot cho Nhân viên hỗ trợ (Admin Inbox)', {
        method: 'POST', path: '/api/support/conversations/{{manualSupportConvId}}/handoff', token: 'manualCandidate',
        description: 'Bấm Send với {"consent": true} để ứng viên yêu cầu gặp Nhân viên tư vấn thật -> Phiếu hỗ trợ xuất hiện ngay trên trang /admin/support của Quản trị viên!',
        pre: script(() => {
            if (pm.environment.get('manualSupportConvId')) return;
            const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            pm.sendRequest({
                url: pm.environment.get('baseUrl') + '/api/support/turn',
                method: 'POST',
                header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pm.environment.get('manualCandidateAccessToken') },
                body: { mode: 'raw', raw: JSON.stringify({ requestId: uuidv4(), text: 'Trạng thái hồ sơ ứng tuyển của tôi thế nào?' }) }
            }, (err, res) => {
                if (!err && res.code === 200) {
                    const match = /event: state\r?\ndata: (\{[^\r\n]+\})/.exec(res.text());
                    if (match) {
                        try { pm.environment.set('manualSupportConvId', JSON.parse(match[1]).id); } catch (e) {}
                    }
                }
            });
        }),
        body: JSON.stringify({
            consent: true
        }, null, 2),
        test: [...showHelper, ...ok(() => {
            const ticket = pm.response.json().data || {};
            const webOrigin = pm.environment.get('origin') || '';
            show(true, 'Đã tạo phiếu chuyển Nhân viên tư vấn (Trạng thái: ' + (ticket.status || 'waiting') + ')',
                'Đăng nhập tài khoản Admin (0795095049 / 123456) trên trình duyệt và mở Hộp thư hỗ trợ để tiếp nhận!', [
                    { label: 'Mã hội thoại / Ticket', value: ticket.id || pm.environment.get('manualSupportConvId') },
                    { label: 'Trạng thái hàng đợi', value: ticket.status || 'waiting' },
                    { label: 'Hộp thư Hỗ trợ Admin (Web)', value: webOrigin + '/admin/support' }
                ]);
        })]
    }),

    req('25 - [AI Worker - RabbitMQ + Claude] Gửi bản nháp nhờ AI viết lại chuyên nghiệp (Async 202)', {
        method: 'POST', path: '/api/ai/chat-assist', token: 'manualCandidate',
        headers: { 'Idempotency-Key': '{{manualAiIdempotencyKey}}' },
        description: 'Sửa câu nháp không dấu / viết vội ở trường "draft" rồi bấm Send -> Job Core ghi Outbox + bắn qua RabbitMQ sang AI Worker, trả về ngay HTTP 202 + taskId (không bắt người dùng treo máy chờ)! Sau đó bấm tiếp mục 26 để lấy câu chữ hoàn chỉnh.',
        pre: script(() => {
            pm.environment.set('manualAiIdempotencyKey', 'demo-ai-' + Date.now());
        }),
        body: JSON.stringify({
            mode: 'polish',
            language: 'vi',
            draft: 'em chao anh chi hr, em muon hoi vi tri fullstack developer ben minh con tuyen khong va quy trinh phong van gom may vong a'
        }, null, 2),
        test: [...showHelper, ...script(() => {
            pm.test('HTTP 202 Accepted (Đã xếp hàng RabbitMQ)', () => pm.response.to.have.status(202));
            const resBody = pm.response.json();
            pm.test('errCode = 0 và có taskId', () => {
                pm.expect(resBody.errCode).to.eql(0);
                pm.expect(resBody.taskId).to.be.a('string').and.not.empty;
            });
            if (resBody.taskId) pm.environment.set('manualAiTaskId', resBody.taskId);
            show(true, 'Đã đẩy tác vụ sang AI Worker qua RabbitMQ (taskId: ' + (resBody.taskId || '') + ')',
                'Bấm tiếp mục "26 - [AI Worker] Nhận kết quả câu chữ do AI xử lý xong" ngay bên dưới để xem bản viết lại!', [
                    { label: 'Mã tác vụ AI (manualAiTaskId)', value: resBody.taskId || '' },
                    { label: 'Cơ chế kiến trúc', value: 'API Gateway -> Job Core (Outbox) -> RabbitMQ -> AI Worker (Claude LLM)' }
                ]);
        })]
    }),

    req('26 - [AI Worker] Nhận kết quả câu chữ do AI xử lý xong', {
        path: '/api/ai/tasks/{{manualAiTaskId}}', token: 'manualCandidate',
        description: 'Bấm Send (nếu AI Worker đang xử lý, Pre-request tự động đợi vài giây tới khi hoàn tất rồi trả kết quả câu văn chuyên nghiệp ngay ở tab Body & Visualize).',
        pre: script(() => {
            const taskId = pm.environment.get('manualAiTaskId');
            if (!taskId) {
                console.log('Chưa có manualAiTaskId: hãy bấm mục 25 trước.');
                pm.execution.skipRequest();
                return;
            }
            const deadline = Date.now() + 45000;
            const poll = () => pm.sendRequest({
                url: pm.environment.get('baseUrl') + '/api/ai/tasks/' + taskId,
                header: { Authorization: 'Bearer ' + pm.environment.get('manualCandidateAccessToken') }
            }, (err, res) => {
                const st = (!err && res.code === 200 && res.json().data) ? res.json().data.status : 'pending';
                if (st === 'pending' && Date.now() < deadline) setTimeout(poll, 2500);
            });
            poll();
        }),
        test: [...showHelper, ...ok(() => {
            const task = pm.response.json().data || {};
            const suggestions = (task.result && task.result.suggestions) || [];
            const rows = suggestions.map((s, idx) => ({ label: 'Phương án AI #' + (idx + 1), value: s }));
            if (!rows.length && task.result) rows.push({ label: 'Kết quả AI', value: JSON.stringify(task.result) });
            if (task.error) rows.push({ label: 'Thông báo lỗi (nếu có)', value: task.error });
            show(task.status === 'done', 'Trạng thái AI Worker: ' + (task.status || 'unknown'),
                task.status === 'done' ? 'AI Worker đã biên tập xong tin nhắn chuyên nghiệp qua RabbitMQ!' : 'Tác vụ chưa hoàn tất hoặc hết quota AI.',
                rows);
        })]
    })
];

export { demoDirectItems };
