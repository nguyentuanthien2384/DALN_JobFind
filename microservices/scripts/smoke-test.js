// Kiem thu nhanh he thong microservices qua API Gateway.
// Chay:  node scripts/smoke-test.js
//
// Kiem tra ca luong CQRS (ghi MySQL -> event -> index Elasticsearch), phan quyen
// tai Gateway, va vong doi cua circuit breaker.

import { snapshot, restore } from './test-fixture.js';

const GW = process.env.GATEWAY_URL || 'http://localhost:4000';
const ES = process.env.ELASTICSEARCH_PUBLIC_URL || 'http://localhost:9201';
const EMPLOYER = { phonenumber: process.env.SMOKE_EMPLOYER_PHONE || '0795095042', password: '123456' };
const ADMIN = { phonenumber: process.env.SMOKE_ADMIN_PHONE || '0795095049', password: '123456' };
const CANDIDATE = { phonenumber: process.env.SMOKE_CANDIDATE_PHONE || '0764188123', password: '123456' };

const failures = [];
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures.push(name);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const req = async (path, opts = {}) => {
    const r = await fetch(GW + path, opts);
    let b;
    try { b = await r.json(); } catch { b = {}; }
    return { status: r.status, body: b };
};

const login = async (creds) => {
    const r = await req('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds)
    });
    if (r.body.errCode !== 0) throw new Error(`Không đăng nhập được ${creds.phonenumber}`);
    return r.body.token;
};

// Gateway cap nhat health theo chu ky 15 giay. Khi backend hoac Docker vua duoc
// khoi dong, /health cua Gateway co the da san sang trong khi /status van giu
// ket qua probe cu. Cho health registry hoi tu de smoke test khong bao loi gia.
const waitForHealthyServices = async ({ attempts = 12, delayMs = 2000 } = {}) => {
    let status = await req('/status');
    for (let attempt = 1; attempt < attempts; attempt += 1) {
        if (status.body.services?.length && status.body.services.every((service) => service.healthy)) {
            return status;
        }
        await sleep(delayMs);
        status = await req('/status');
    }
    return status;
};

const waitForAiTask = async (taskId, headers, { attempts = 20, delayMs = 500 } = {}) => {
    let task = await req(`/api/ai/tasks/${taskId}`, { headers });
    for (let attempt = 1; attempt < attempts; attempt += 1) {
        if (['done', 'failed'].includes(task.body.data?.status)) return task;
        await sleep(delayMs);
        task = await req(`/api/ai/tasks/${taskId}`, { headers });
    }
    return task;
};

const run = async () => {
    console.log(`Kiểm tra hệ thống microservices tại ${GW}`);

    const health = await req('/health');
    check('Gateway phản hồi', health.body.status === 'ok');

    const status = await waitForHealthyServices();
    check('Tất cả service đang sống',
        status.body.services?.every((s) => s.healthy),
        `${status.body.services?.length ?? 0} service`);

    section('Tìm kiếm (Search Service — Elasticsearch)');
    let r = await req('/api/search/jobs?limit=5&offset=0');
    check('Danh sách việc làm', r.body.errCode === 0, `${r.body.count} tin, ${r.body.took}ms`);

    r = await req('/api/search/jobs?q=reactjs&limit=5');
    check('Tìm theo từ khóa', r.body.errCode === 0 && r.body.count > 0, `${r.body.count} kết quả`);

    r = await req('/api/search/jobs?q=reactjts&limit=3');
    check('Tìm sai chính tả vẫn ra kết quả (fuzzy)', r.body.count > 0, `${r.body.count} kết quả`);

    r = await req('/api/search/facets');
    check('Thống kê theo danh mục', r.body.errCode === 0,
        `${r.body.data?.categories?.length ?? 0} ngành nghề`);

    section('Định tuyến về backend cũ');
    r = await req('/api/get-filter-post?limit=3&offset=0');
    check('API cũ vẫn chạy qua Gateway', r.body.errCode === 0, `${r.body.count} tin`);

    const employerToken = await login(EMPLOYER);
    const candidateToken = await login(CANDIDATE);
    const adminToken = await login(ADMIN);
    const auth = { Authorization: `Bearer ${employerToken}`, 'Content-Type': 'application/json' };
    const adminAuth2 = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
    // Id cua nha tuyen dung, can cho API cu (no nhan userId tu body).
    const employerUserId = JSON.parse(
        Buffer.from(employerToken.split('.')[1], 'base64').toString()
    ).sub;
    check('Đăng nhập qua Gateway', Boolean(employerToken));

    section('Phân quyền tại Gateway');
    r = await req('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x' })
    });
    check('Chặn đăng tin khi chưa đăng nhập', r.status === 401);

    r = await req('/api/jobs', {
        method: 'POST',
        headers: { Authorization: `Bearer ${candidateToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', descriptionHTML: 'y', categoryJobCode: 'z' })
    });
    check('Ứng viên không đăng được tin tuyển dụng', r.status === 403);

    section('Hồ sơ & CV (Identity Service — MongoDB)');
    r = await req('/api/profile', { headers: auth });
    check('Đọc hồ sơ', r.body.errCode === 0);

    r = await req('/api/profile/cvs', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ title: 'CV kiểm thử', fullName: 'Kiểm Thử', skills: ['React'] })
    });
    check('Tạo CV', r.body.errCode === 0);
    const cvId = r.body.data?._id;
    if (cvId) await req(`/api/profile/cvs/${cvId}`, { method: 'DELETE', headers: auth });

    section('CQRS: ghi MySQL → event → index Elasticsearch');
    const uniqueName = `Kiem Thu CQRS ${Date.now()}`;
    r = await req('/api/jobs', {
        method: 'POST', headers: auth,
        body: JSON.stringify({
            name: uniqueName,
            descriptionHTML: '<p>Tuyển lập trình viên Golang, làm việc tại Đà Nẵng.</p>',
            categoryJobCode: 'cong-nghe-thong-tin', addressCode: 'Đà Nẵng', amount: 2
        })
    });
    check('Đăng tin (bên Ghi → MySQL)', r.body.errCode === 0, `id ${r.body.data?.id}`);
    check('Tin mới ở trạng thái chờ kiểm duyệt', r.body.data?.statusCode === 'PS3');
    const newId = r.body.data?.id;

    if (newId) {
        // Su kien di qua RabbitMQ nen can mot chut thoi gian.
        await new Promise((s) => setTimeout(s, 3000));
        const doc = await fetch(`${ES}/jobs/_doc/${newId}`).then((x) => x.json()).catch(() => ({}));
        check('Search Service tự đồng bộ vào index', doc.found === true, doc._source?.name);

        r = await req('/api/ai/match-cv', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ resumeText: '3 năm kinh nghiệm Golang', jobId: newId })
        });
        const aiAccepted = r.status === 202 && Boolean(r.body.taskId);
        check('AI Worker nhận việc qua RabbitMQ', aiAccepted);
        if (aiAccepted) {
            const aiTask = await waitForAiTask(r.body.taskId, auth);
            const terminalStatus = ['done', 'failed'].includes(aiTask.body.data?.status);
            check('AI Worker phản hồi kết quả qua RabbitMQ', terminalStatus,
                aiTask.body.data?.status === 'failed'
                    ? `failed có kiểm soát: ${aiTask.body.data?.error}`
                    : aiTask.body.data?.status);
        }

        await req(`/api/jobs/${newId}`, { method: 'DELETE', headers: auth });
    }

    // Index phai khop chinh xac voi CSDL nguon. Lech nghia la co tin ma (tin da
    // xoa nhung con tim thay duoc) hoac tin that lac (co that nhung khong ai tim ra).
    const esCount = await fetch(`${ES}/jobs/_count`).then((x) => x.json()).catch(() => ({}));
    const legacyAll = await req('/api/get-all-post-admin?limit=1&offset=0&search=&censorCode=', {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    check('Số tin trong index khớp với CSDL nguồn',
        esCount.count === legacyAll.body.count,
        `Elasticsearch ${esCount.count} / MySQL ${legacyAll.body.count}`);

    section('Đồng bộ từ backend cũ sang microservices');

    // Canh gac cho hai loi da tung xay ra that: frontend van dang tin va nop CV
    // qua API cu, nen neu backend cu khong phat su kien thi Search Service va
    // Application Service khong bao gio biet - tin dang xong khong ai tim thay,
    // ho so nop xong khong hien tren bang Kanban.
    const legacyName = `Kiem Thu Dong Bo ${Date.now()}`;
    r = await req('/api/create-new-post', {
        method: 'POST', headers: auth,
        body: JSON.stringify({
            name: legacyName,
            descriptionHTML: '<p>Tuyển lập trình viên Golang</p>',
            descriptionMarkdown: 'Golang',
            categoryJobCode: 'cong-nghe-thong-tin', addressCode: 'Đà Nẵng',
            salaryJobCode: '10-15tr', amount: 1, categoryJoblevelCode: 'nhan-vien',
            categoryWorktypeCode: 'fulltime', experienceJobCode: '1-nam',
            genderPostCode: 'ca-hai', isHot: 0,
            timeEnd: String(Date.now() + 30 * 24 * 3600 * 1000),
            userId: Number(employerUserId)
        })
    });
    const legacyPosted = r.body.errCode === 0;
    check('Đăng tin qua API cũ', legacyPosted, r.body.errMessage);

    let legacyPostId = null;
    if (legacyPosted) {
        await new Promise((s) => setTimeout(s, 4000));
        const hits = await fetch(
            `${ES}/jobs/_search?q=${encodeURIComponent(`name:"Kiem Thu Dong Bo"`)}`
        ).then((x) => x.json()).catch(() => ({}));
        const doc = (hits.hits?.hits || []).find((h) => h._source.name === legacyName);
        legacyPostId = doc?._source?.id ?? null;
        check('Tin đăng qua API cũ tự vào Elasticsearch', Boolean(doc), `id ${legacyPostId}`);
        check('Tin chờ duyệt chưa hiển thị với ứng viên', doc?._source?.statusCode === 'PS3');

        // Duyet tin -> trang thai trong index phai doi theo, neu khong tin da duyet
        // van khong ai tim thay.
        r = await req('/api/accept-post', {
            method: 'PUT', headers: adminAuth2,
            body: JSON.stringify({ id: legacyPostId, statusCode: 'PS1' })
        });
        await new Promise((s) => setTimeout(s, 4000));
        const afterAccept = await fetch(`${ES}/jobs/_doc/${legacyPostId}`)
            .then((x) => x.json()).catch(() => ({}));
        check('Duyệt tin thì trạng thái trong index đổi theo',
            afterAccept._source?.statusCode === 'PS1');

        r = await req(`/api/search/jobs?q=${encodeURIComponent(legacyName)}&limit=20`);
        check('Ứng viên tìm thấy tin vừa được duyệt',
            (r.body.data || []).some((x) => x.id === legacyPostId));

        // Nop CV qua API cu -> phai vao bang Kanban.
        const boardBefore = await req('/api/applications/board', { headers: auth });
        r = await req('/api/create-new-cv', {
            method: 'POST',
            headers: { Authorization: `Bearer ${candidateToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                postId: legacyPostId,
                file: 'data:application/pdf;base64,JVBERi0xLjQKdHJhaWxlcgo8PC9TaXplIDEvUm9vdCAxIDAgUj4+CiUlRU9GCg==',
                description: 'Kiểm thử đồng bộ hồ sơ'
            })
        });
        const applied = r.body.errCode === 0;
        check('Ứng viên nộp CV qua API cũ', applied, r.body.errMessage);

        if (applied) {
            await new Promise((s) => setTimeout(s, 4000));
            const boardAfter = await req('/api/applications/board', { headers: auth });
            const items = (boardAfter.body.data?.columns || []).flatMap((c) => c.items);
            check('Hồ sơ nộp qua API cũ tự vào bảng Kanban',
                items.some((i) => i.job_id === legacyPostId),
                `${boardBefore.body.data?.total} → ${boardAfter.body.data?.total} hồ sơ`);
        }

        // Khoa tin -> phai bien khoi ket qua tim kiem.
        r = await req('/api/ban-post', {
            method: 'PUT', headers: adminAuth2,
            body: JSON.stringify({ postId: legacyPostId, note: 'kiểm thử tự động', userId: 1 })
        });
        await new Promise((s) => setTimeout(s, 4000));
        r = await req(`/api/search/jobs?q=${encodeURIComponent(legacyName)}&limit=20`);
        check('Tin bị khóa biến khỏi kết quả tìm kiếm',
            !(r.body.data || []).some((x) => x.id === legacyPostId));
    }

    section('Quy trình tuyển dụng (Application Service — PostgreSQL)');
    r = await req('/api/applications/board', { headers: auth });
    check('Đọc bảng Kanban', r.body.errCode === 0,
        `${r.body.data?.total} hồ sơ, ${r.body.data?.columns?.length} cột`);

    const board = r.body.data;
    const allItems = (board?.columns || []).flatMap((c) => c.items);
    // Uu tien ho so cua chinh tin kiem thu vua tao. Truoc day cho lay dai ho so
    // dau tien tren bang, tuc la thao tac len ho so THAT cua mot ung vien that:
    // doi buoc tuyen dung cua ho, cham sao cho ho, va gui cho ho thong bao
    // "Ban duoc moi phong van" cho mot vi tri ho khong he duoc moi. Nhung thong
    // bao do cung khong don duoc vi chung mang ten tin that.
    const sample = allItems.find((i) => i.job_id === legacyPostId) || allItems[0];

    if (sample) {
        const originalStage = sample.stage;
        r = await req(`/api/applications/${sample.id}/stage`, {
            method: 'PATCH', headers: auth,
            body: JSON.stringify({ stage: 'phong_van', reason: 'kiểm thử tự động' })
        });
        check('Chuyển bước (kéo thả Kanban)', r.body.data?.stage === 'phong_van');

        r = await req(`/api/applications/${sample.id}`, { headers: auth });
        check('Ghi lại lịch sử chuyển bước', (r.body.data?.timeline?.length ?? 0) > 0);

        r = await req(`/api/applications/${sample.id}/rating`, {
            method: 'PATCH', headers: auth, body: JSON.stringify({ rating: 4 })
        });
        check('Chấm sao ứng viên', r.body.data?.rating === 4);

        r = await req(`/api/applications/${sample.id}/rating`, {
            method: 'PATCH', headers: auth, body: JSON.stringify({ rating: 9 })
        });
        check('Chặn điểm đánh giá không hợp lệ', r.status === 400);

        r = await req(`/api/applications/${sample.id}/notes`, {
            method: 'POST', headers: auth, body: JSON.stringify({ body: 'Ghi chú kiểm thử' })
        });
        check('Thêm ghi chú nội bộ', r.body.errCode === 0);

        // Tra ve trang thai ban dau de khong lam lech du lieu that.
        await req(`/api/applications/${sample.id}/stage`, {
            method: 'PATCH', headers: auth,
            body: JSON.stringify({ stage: originalStage, reason: 'hoàn tác kiểm thử' })
        });
    }

    r = await req('/api/applications/board', { headers: { Authorization: `Bearer ${candidateToken}` } });
    check('Ứng viên không mở được bảng Kanban', r.status === 403);

    r = await req('/api/my-applications', { headers: { Authorization: `Bearer ${candidateToken}` } });
    check('Ứng viên xem được lịch sử ứng tuyển của mình', r.body.errCode === 0, `${r.body.count} hồ sơ`);

    r = await req('/api/applications/funnel', { headers: auth });
    check('Thống kê phễu tuyển dụng', r.body.errCode === 0,
        `tỷ lệ tuyển ${r.body.data?.conversionRate}%`);

    section('Thông báo realtime (Notification Service)');

    // Canh gac cho mot loi da tung xay ra: khi frontend tro sang Gateway, WebSocket
    // ngung hoat dong vi lop proxy dua tren axios khong xu ly duoc HTTP Upgrade.
    // Chat va thong bao realtime chet lang, khong bao loi gi.
    const handshake = await fetch(`${GW}/socket.io/?EIO=4&transport=polling`);
    const handshakeBody = await handshake.text();
    check('WebSocket bắt tay được qua Gateway',
        handshake.status === 200 && handshakeBody.includes('"sid"'));
    check('Gateway chào nâng cấp lên websocket', handshakeBody.includes('websocket'));

    // Endpoint noi bo phai tu choi khi khong co khoa - neu khong, bat ky ai cung
    // day duoc thong bao gia mao vao trinh duyet nguoi khac.
    const legacyUrl = process.env.LEGACY_URL || 'http://localhost:5000';
    const noSecret = await fetch(`${legacyUrl}/internal/emit-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 1, notification: { content: 'giả mạo' } })
    }).catch(() => ({ status: 0 }));
    check('Chặn đẩy thông báo khi không có khóa nội bộ', noSecret.status === 403);

    section('Báo cáo & Nhật ký (Admin & Reporting Service)');

    const adminAuth = { Authorization: `Bearer ${adminToken}` };

    r = await req('/api/admin/reports/overview', { headers: auth });
    check('Nhà tuyển dụng không mở được báo cáo', r.status === 403);

    r = await req('/api/admin/reports/overview');
    check('Khách vãng lai không mở được báo cáo', r.status === 401);

    r = await req('/api/admin/reports/overview', { headers: adminAuth });
    check('Báo cáo tổng quan', r.body.errCode === 0,
        `${r.body.data?.nguoiDung?.tong} người dùng, ${r.body.data?.congTy} công ty`);

    r = await req('/api/admin/reports/distribution', { headers: adminAuth });
    check('Phân bố theo danh mục', (r.body.data?.theoNganhNghe?.length ?? 0) > 0,
        `${r.body.data?.theoNganhNghe?.length} ngành nghề`);

    r = await req('/api/admin/reports/funnel', { headers: adminAuth });
    check('Phễu tuyển dụng toàn hệ thống', r.body.errCode === 0,
        `${r.body.data?.tong} hồ sơ`);

    r = await req('/api/admin/reports/timeseries', { headers: adminAuth });
    check('Chuỗi số liệu theo thời gian', r.body.errCode === 0);

    // Audit log phai ghi lai duoc su kien di qua RabbitMQ. Tin vua tao o phan CQRS
    // sinh ra job.created, nen tra cuu theo chinh tin do.
    if (newId) {
        r = await req(`/api/admin/audit/target/job/${newId}`, { headers: adminAuth });
        check('Nhật ký lần vết được một tin qua nhiều service', (r.body.count ?? 0) > 0,
            `${r.body.count} dấu vết cho tin #${newId}`);
    }

    r = await req('/api/admin/audit?kind=action&limit=5', { headers: adminAuth });
    check('Nhật ký ghi lại thao tác người dùng', r.body.errCode === 0,
        `${r.body.count} bản ghi`);

    r = await req('/api/admin/master-data?type=JOBTYPE', { headers: adminAuth });
    check('Đọc được master data kèm lớp bổ nghĩa', (r.body.count ?? 0) > 0,
        `${r.body.count} mã ngành nghề`);

    if (failures.length) {
        console.error(`\nKhông đạt: ${failures.join(', ')}`);
        process.exitCode = 1;
        return;
    }
    console.log('\nTất cả kiểm tra đều đạt.');
};

// Chup anh CSDL truoc, tra lai nguyen trang sau - ke ca khi kiem thu that bai
// giua chung, vi do dung la luc de lai nhieu rac nhat.
(async () => {
    let before = null;
    try {
        before = await snapshot();
    } catch (error) {
        console.log(`(khong chup duoc anh CSDL: ${error.message} - se khong don sau khi chay)`);
    }

    try {
        await run();
    } catch (error) {
        console.error(`Không chạy được kiểm thử: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (before) await restore(before).catch((e) => console.log(`(don dep loi: ${e.message})`));
    }
})();
