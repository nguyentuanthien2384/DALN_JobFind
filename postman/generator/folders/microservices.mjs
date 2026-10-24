import { script, req, folder, expectStatus, expectError, contractError, ok, created, skipUnless, aiQuotaGuard, recordAiQuota } from '../lib.mjs';

// Run the AI quota guard after the request's own pre-request (skipRequest stops the rest of
// the script) and record the remaining quota after the response.
const withAiQuota = (item) => {
    const pre = item.event.find((e) => e.listen === 'prerequest');
    const test = item.event.find((e) => e.listen === 'test');
    if (pre) pre.script.exec = [...pre.script.exec, ...aiQuotaGuard]; else item.event.unshift({ listen: 'prerequest', script: { type: 'text/javascript', exec: aiQuotaGuard } });
    if (test) test.script.exec = [...test.script.exec, ...recordAiQuota];
    return item;
};

const skipIfPreexisting = script(() => {
    if (pm.environment.get('talentPreexisting') !== 'false') {
        console.log('Bỏ qua "' + pm.info.requestName + '": ứng viên đã có sẵn trong kho, không ghi đè/xoá dữ liệu thật.');
        pm.execution.skipRequest();
    }
});

// ---------- 02 Identity ----------
const profileSchema = {
    type: 'object', required: ['errCode', 'data'],
    properties: { errCode: { const: 0 }, data: { type: 'object', required: ['_id', 'legacyUserId', 'roleCode', 'cvs'],
        properties: { legacyUserId: { type: 'integer' }, roleCode: { type: 'string' }, cvs: { type: 'array' } } } }
};
const f02 = folder('Identity Service (MongoDB): hồ sơ và CV', [
    'Hồ sơ mở rộng và CV Builder của từng người dùng, lưu ở MongoDB.',
    'Mọi dữ liệu tạo ra (headline, 2 CV) đều được khôi phục/xoá ở cuối thư mục.'
].join('\n'), [
    req('Hồ sơ của ứng viên', { path: '/api/profile', token: 'candidate', test: ok(() => {
        pm.test('Đúng schema Profile', () => pm.response.to.have.jsonSchema(__PROFILE__));
        const payload = pm.response.json().data;
        pm.test('Đúng người đang đăng nhập', () => {
            pm.expect(payload.legacyUserId).to.eql(Number(pm.environment.get('candidateUserId')));
            pm.expect(payload.roleCode).to.eql('CANDIDATE');
        });
        pm.environment.set('profileOriginalHeadline', JSON.stringify(payload.headline === undefined ? null : payload.headline));
    }).map((l) => l.replace('__PROFILE__', JSON.stringify(profileSchema))) }),
    req('Cập nhật headline', {
        method: 'PUT', path: '/api/profile', token: 'candidate', body: '{\n  "headline": "{{profileTestHeadline}}"\n}',
        pre: script(() => pm.environment.set('profileTestHeadline', 'Kiểm thử Postman ' + new Date().toISOString())),
        test: ok(() => {
            pm.test('Headline đã được lưu', () => pm.expect(pm.response.json().data.headline).to.eql(pm.environment.get('profileTestHeadline')));
        })
    }),
    req('Chặn leo thang đặc quyền: gửi roleCode -> 400', {
        method: 'PUT', path: '/api/profile', token: 'candidate', body: { roleCode: 'ADMIN', companyId: 1 }, test: contractError()
    }),
    req('Body rỗng -> 400', { method: 'PUT', path: '/api/profile', token: 'candidate', body: {}, test: contractError() }),
    req('Khôi phục headline ban đầu', {
        method: 'PUT', path: '/api/profile', token: 'candidate', body: '{\n  "headline": {{profileOriginalHeadline}}\n}',
        test: ok(() => {
            pm.test('Headline trở về như cũ', () => {
                const headline = pm.response.json().data.headline;
                pm.expect(headline === undefined ? null : headline).to.eql(JSON.parse(pm.environment.get('profileOriginalHeadline')));
            });
        })
    }),
    req('Hồ sơ của nhà tuyển dụng', { path: '/api/profile', token: 'employer', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Đúng người và công ty', () => {
            pm.expect(payload.legacyUserId).to.eql(Number(pm.environment.get('employerUserId')));
            pm.expect(payload.companyId).to.eql(Number(pm.environment.get('employerCompanyId')));
        });
    }) }),
    req('Danh sách CV', { path: '/api/profile/cvs', token: 'candidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('count = số phần tử', () => pm.expect(body.count).to.eql(body.data.length));
        pm.test('Không cho cache dữ liệu CV', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
        pm.environment.set('cvCountBefore', body.count);
    }) }),
    req('Tạo CV', {
        method: 'POST', path: '/api/profile/cvs', token: 'candidate',
        body: {
            title: 'CV kiểm thử Postman', template: 'basic', fullName: 'Ứng viên Postman', email: 'postman@example.com',
            summary: 'CV tạo tự động bởi bộ test Postman, sẽ bị xoá ngay.', skills: ['Node.js', 'MongoDB'], languages: ['Tiếng Anh'],
            experiences: [{ company: 'JobFind', position: 'Tester', from: '2025', to: '2026', description: 'Kiểm thử API' }],
            educations: [{ school: 'Đại học', major: 'CNTT', degree: 'Kỹ sư', year: '2026' }]
        },
        test: created(() => {
            const cv = pm.response.json().data;
            pm.test('CV có _id MongoDB và đúng dữ liệu', () => {
                pm.expect(cv._id).to.match(/^[a-f0-9]{24}$/);
                pm.expect(cv.skills).to.eql(['Node.js', 'MongoDB']);
                pm.expect(cv.experiences[0].company).to.eql('JobFind');
            });
            pm.environment.set('cvId', cv._id);
        })
    }),
    req('Sửa CV', {
        method: 'PUT', path: '/api/profile/cvs/{{cvId}}', token: 'candidate', body: { title: 'CV kiểm thử Postman (đã sửa)' },
        test: ok(() => {
            const cv = pm.response.json().data;
            pm.test('Tiêu đề đã đổi, dữ liệu khác giữ nguyên', () => {
                pm.expect(cv.title).to.eql('CV kiểm thử Postman (đã sửa)');
                pm.expect(cv.skills).to.eql(['Node.js', 'MongoDB']);
            });
        })
    }),
    req('CV mới có trong danh sách', { path: '/api/profile/cvs', token: 'candidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('Tăng đúng 1 CV', () => pm.expect(body.count).to.eql(Number(pm.environment.get('cvCountBefore')) + 1));
        pm.test('Chứa cvId vừa tạo', () => pm.expect(body.data.map((cv) => cv._id)).to.include(pm.environment.get('cvId')));
    }) }),
    req('Nhập CV từ kết quả AI bóc tách (import)', {
        method: 'POST', path: '/api/profile/cvs/import', token: 'candidate',
        body: {
            fileName: 'postman-cv.pdf',
            parsed: { fullName: 'Ứng viên Postman', email: 'postman@example.com', skills: ['Postman', 'Newman'], yearsOfExperience: 2,
                experiences: [{ company: 'JobFind', position: 'QA', duration: '2024 - 2026', description: 'Kiểm thử microservices' }] }
        },
        test: created(() => {
            const cv = pm.response.json().data;
            pm.test('Map đúng trường từ parser', () => {
                pm.expect(cv.title).to.eql('CV của Ứng viên Postman');
                pm.expect(cv.experiences[0].from).to.eql('2024 - 2026');
                pm.expect(cv.parsedFrom.fileName).to.eql('postman-cv.pdf');
            });
            pm.environment.set('importedCvId', cv._id);
        })
    }),
    req('Xoá CV đã import', { method: 'DELETE', path: '/api/profile/cvs/{{importedCvId}}', token: 'candidate', test: ok() }),
    req('Xoá CV đã tạo', { method: 'DELETE', path: '/api/profile/cvs/{{cvId}}', token: 'candidate', test: ok(() => {
        pm.test('Thông báo đã xoá', () => pm.expect(pm.response.json().errMessage).to.eql('Đã xóa CV'));
    }) }),
    req('Xoá lại CV đã xoá -> 404', { method: 'DELETE', path: '/api/profile/cvs/{{cvId}}', token: 'candidate', test: expectError(404, 'Không tìm thấy CV', 2) }),
    req('cvId sai định dạng -> 400', { method: 'PUT', path: '/api/profile/cvs/khong-phai-id', token: 'candidate', body: { title: 'x' }, test: contractError() }),
    req('Nhà tuyển dụng không quản lý CV cá nhân -> 403', { path: '/api/profile/cvs', token: 'employer', test: expectError(403, 'không có quyền') }),
    req('Danh sách CV trở lại như ban đầu', { path: '/api/profile/cvs', token: 'candidate', test: ok(() => {
        pm.test('Số CV bằng lúc đầu', () => pm.expect(pm.response.json().count).to.eql(Number(pm.environment.get('cvCountBefore'))));
    }) })
]);

// ---------- 03 Job Core ----------
const f03 = folder('Job Core Service (MySQL): bên Ghi của CQRS', [
    'Tin tuyển dụng: đọc công khai, không gian quản lý theo công ty (tenant), optimistic locking',
    'bằng editRevision và kiểm tra đầu vào. Các request ghi ở đây hoặc bị từ chối trước khi ghi,',
    'hoặc là lần sửa "không đổi nội dung" (không tạo phiên bản, không gọi AI kiểm duyệt).',
    'Muốn thử tạo/gỡ tin thật: xem thư mục "Luồng ghi CQRS thật" (tùy chọn).'
].join('\n'), [
    req('Chi tiết tin công khai', { path: '/api/jobs/{{jobId}}', test: ok(() => {
        const job = pm.response.json().data;
        pm.test('Đúng tin, đang hiển thị (PS1), thuộc công ty A', () => {
            pm.expect(job.id).to.eql(Number(pm.environment.get('jobId')));
            pm.expect(job.statusCode).to.eql('PS1');
            pm.expect(job.companyId).to.eql(Number(pm.environment.get('employerCompanyId')));
        });
        pm.test('Không lộ trạng thái kiểm duyệt nội bộ của công ty', () => {
            pm.expect(job).to.not.have.any.keys('companyStatusCode', 'companyCensorCode');
        });
    }) }),
    req('ID tin không hợp lệ -> 400', { path: '/api/jobs/abc', test: contractError() }),
    req('Tin không tồn tại -> 404', { path: '/api/jobs/999999999', test: expectError(404, 'Không tìm thấy tin tuyển dụng', 2) }),
    req('Danh sách tin của công ty', { path: '/api/jobs/manage?limit=5&offset=0', token: 'employer', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số và tối đa 5 dòng', () => {
            pm.expect(body.count).to.be.a('number');
            pm.expect(body.data.length).to.be.at.most(5);
        });
        pm.test('Chỉ thấy tin của công ty mình', () => {
            body.data.forEach((job) => pm.expect(job.companyId).to.eql(Number(pm.environment.get('employerCompanyId'))));
        });
        pm.test('private, no-store', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
    }) }),
    req('limit=0 -> 400', { path: '/api/jobs/manage?limit=0', token: 'employer', test: contractError() }),
    req('Ứng viên vào trang quản lý tin -> 403', { path: '/api/jobs/manage', token: 'candidate', test: expectError(403, 'không có quyền') }),
    req('Chi tiết tin để sửa (có editRevision)', { path: '/api/jobs/{{jobId}}/manage', token: 'employer', test: ok(() => {
        const job = pm.response.json().data;
        pm.test('editRevision dạng jv1-<sha256>', () => pm.expect(job.editRevision).to.match(/^jv1-[a-f0-9]{64}$/));
        pm.environment.set('jobRevision', job.editRevision);
        pm.environment.set('jobNameJson', JSON.stringify(job.name));
        pm.environment.set('jobStatusCode', job.statusCode);
    }) }),
    req('Công ty B không thấy tin của công ty A -> 404', {
        path: '/api/jobs/{{jobId}}/manage', token: 'employer2',
        description: 'Cùng một câu trả lời cho ID không tồn tại và ID của tenant khác: không đoán được ID.',
        test: expectError(404, 'Không tìm thấy tin trong phạm vi quản lý', 2)
    }),
    req('Lịch sử kiểm duyệt tin', { path: '/api/jobs/{{jobId}}/review?limit=5', token: 'employer', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Đúng tin và trạng thái review hợp lệ', () => {
            pm.expect(payload.job.id).to.eql(Number(pm.environment.get('jobId')));
            pm.expect(payload.job.reviewState).to.be.oneOf(['untracked', 'no_active_ai', 'ai_requested', 'ai_failed', 'ai_applied']);
            pm.expect(payload.notes).to.be.an('array');
            pm.expect(payload.count).to.be.a('number');
        });
    }) }),
    req('Tạo tin thiếu trường bắt buộc -> 400 (không ghi DB)', { method: 'POST', path: '/api/jobs', token: 'employer', body: {}, test: contractError() }),
    req('Ứng viên đăng tin -> 403', {
        method: 'POST', path: '/api/jobs', token: 'candidate',
        body: { name: 'Không được tạo', descriptionHTML: '<p>x</p>', categoryJobCode: 'cong-nghe-thong-tin' },
        test: expectError(403, 'không có quyền')
    }),
    req('Đăng lại tin thiếu Idempotency-Key -> 400', {
        method: 'POST', path: '/api/jobs/{{jobId}}/repost', token: 'employer', body: '{\n  "timeEnd": "{{futureTimeEnd}}"\n}',
        pre: script(() => pm.environment.set('futureTimeEnd', String(Date.now() + 30 * 24 * 3600 * 1000))),
        test: contractError()
    }),
    req('Sửa với editRevision cũ -> 409 (optimistic locking)', {
        method: 'PUT', path: '/api/jobs/{{jobId}}', token: 'employer',
        body: '{\n  "name": {{jobNameJson}},\n  "expectedRevision": "jv1-0000000000000000000000000000000000000000000000000000000000000000"\n}',
        test: [...expectError(409, 'Tin đã thay đổi', 4), ...script(() => {
            pm.test('Có cờ conflict để giao diện yêu cầu tải lại', () => pm.expect(pm.response.json().conflict).to.be.true);
        })]
    }),
    req('Công ty B sửa tin của công ty A -> 403', {
        method: 'PUT', path: '/api/jobs/{{jobId}}', token: 'employer2', body: { name: 'Sửa trái phép' },
        test: expectError(403, 'không có quyền sửa tin', 3)
    }),
    req('Sửa không đổi nội dung -> 200, giữ nguyên phiên bản', {
        method: 'PUT', path: '/api/jobs/{{jobId}}', token: 'employer', headers: { 'X-Correlation-Id': '{{auditCorrelationId}}' },
        body: '{\n  "name": {{jobNameJson}},\n  "expectedRevision": "{{jobRevision}}"\n}',
        description: 'Gửi lại đúng tên + editRevision hiện tại: không tạo bản mới, không đổi trạng thái, không gọi AI. Request mang X-Correlation-Id riêng để thư mục Admin tra nhật ký.',
        pre: script(() => pm.environment.set('auditCorrelationId', 'postman-audit-' + Date.now())),
        test: ok(() => {
            const job = pm.response.json().data;
            pm.test('editRevision không đổi', () => pm.expect(job.editRevision).to.eql(pm.environment.get('jobRevision')));
            pm.test('Trạng thái không bị đưa về chờ duyệt', () => pm.expect(job.statusCode).to.eql(pm.environment.get('jobStatusCode')));
        })
    }),
    req('Tin vẫn nguyên phiên bản sau lần sửa không đổi', { path: '/api/jobs/{{jobId}}/manage', token: 'employer', test: ok(() => {
        pm.test('editRevision không đổi', () => pm.expect(pm.response.json().data.editRevision).to.eql(pm.environment.get('jobRevision')));
    }) })
]);

// ---------- 04 Search ----------
const f04 = folder('Search Service (Elasticsearch): bên Đọc của CQRS', [
    'Tìm kiếm full-text (BM25 + fuzzy), lọc, phân trang, facets, gợi ý, tin liên quan (More Like This),',
    'giới hạn cửa sổ kết quả, và đối chiếu bản đọc (Elasticsearch) với nguồn ghi (Job Core/MySQL).',
    'API công khai: không cần token.'
].join('\n'), [
    req('Tìm tất cả tin đang mở', { path: '/api/search/jobs?limit=5', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số, thời gian truy vấn và tối đa 5 kết quả', () => {
            pm.expect(body.count).to.be.at.least(body.data.length);
            pm.expect(body.took).to.be.a('number');
            pm.expect(body.data.length).to.be.at.most(5);
        });
        pm.test('Chỉ tin đã duyệt (PS1) và còn hạn', () => body.data.forEach((job) => {
            pm.expect(job.statusCode).to.eql('PS1');
            pm.expect(Number(job.timeEnd)).to.be.at.least(Date.now() - 60000);
        }));
        pm.test('Không lộ trường đồng bộ nội bộ', () => body.data.forEach((job) => pm.expect(job).to.not.have.any.keys('searchSync', 'searchDeleted')));
        if (body.data.length) {
            pm.environment.set('searchJobId', body.data[0].id);
            pm.environment.set('searchJobName', body.data[0].name);
        }
    }) }),
    req('Tìm theo từ khoá (xếp hạng _score)', { path: '/api/search/jobs?q=developer&limit=5', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Có kết quả', () => pm.expect(payload.length).to.be.above(0));
        pm.test('_score giảm dần', () => {
            for (let i = 1; i < payload.length; i += 1) pm.expect(payload[i - 1]._score).to.be.at.least(payload[i]._score);
        });
    }) }),
    req('Gõ sai chính tả vẫn tìm được (fuzziness)', { path: '/api/search/jobs?q=develper&limit=5', test: ok(() => {
        pm.test('"develper" vẫn ra kết quả', () => pm.expect(pm.response.json().count).to.be.above(0));
    }) }),
    req('Bộ đếm facets', { path: '/api/search/facets', test: ok(() => {
        const payload = pm.response.json().data;
        for (const key of ['categories', 'provinces', 'salaries']) {
            pm.test(key + ': mảng {code, count} giảm dần', () => {
                pm.expect(payload[key]).to.be.an('array');
                payload[key].forEach((b, i) => {
                    pm.expect(b).to.have.all.keys('code', 'count');
                    if (i) pm.expect(payload[key][i - 1].count).to.be.at.least(b.count);
                });
            });
        }
        if (payload.categories.length) {
            pm.environment.set('searchCategoryCode', payload.categories[0].code);
            pm.environment.set('searchCategoryCount', payload.categories[0].count);
        }
        const salaries = payload.salaries.slice(0, 2).map((b) => b.code);
        pm.environment.set('searchSalary1', salaries[0] || '');
        pm.environment.set('searchSalary2', salaries[1] || salaries[0] || '');
    }) }),
    req('Lọc theo ngành: số lượng khớp facets', { path: '/api/search/jobs?categoryJobCode={{searchCategoryCode}}&limit=50', test: ok(() => {
        const body = pm.response.json();
        pm.test('Mọi kết quả đúng ngành', () => body.data.forEach((job) => pm.expect(job.categoryJobCode).to.eql(pm.environment.get('searchCategoryCode'))));
        pm.test('Tổng số = số đếm trong facets', () => pm.expect(body.count).to.eql(Number(pm.environment.get('searchCategoryCount'))));
    }) }),
    req('Lọc nhiều mức lương cùng lúc (mảng)', { path: '/api/search/jobs?salaryJobCode={{searchSalary1}}&salaryJobCode={{searchSalary2}}&limit=20', test: ok(() => {
        const codes = [pm.environment.get('searchSalary1'), pm.environment.get('searchSalary2')];
        pm.test('Mọi kết quả thuộc các mức lương đã chọn', () => pm.response.json().data.forEach((job) => pm.expect(job.salaryJobCode).to.be.oneOf(codes)));
    }) }),
    req('Phân trang - trang 1', { path: '/api/search/jobs?limit=3&offset=0', test: ok(() => {
        pm.environment.set('searchPage1Ids', JSON.stringify(pm.response.json().data.map((job) => job.id)));
    }) }),
    req('Phân trang - trang 2 không trùng trang 1', { path: '/api/search/jobs?limit=3&offset=3', test: ok(() => {
        const page1 = JSON.parse(pm.environment.get('searchPage1Ids'));
        pm.test('Không có id trùng', () => pm.response.json().data.forEach((job) => pm.expect(page1).to.not.include(job.id)));
    }) }),
    req('Chỉ tin nổi bật (isHot=1)', { path: '/api/search/jobs?isHot=1&limit=20', test: ok(() => {
        pm.test('Mọi kết quả isHot', () => pm.response.json().data.forEach((job) => pm.expect(job.isHot).to.be.oneOf([true, 1])));
    }) }),
    req('Vượt cửa sổ 10.000 kết quả -> 400', { path: '/api/search/jobs?offset=9995&limit=10', test: contractError() }),
    req('limit > 100 -> 400', { path: '/api/search/jobs?limit=101', test: contractError() }),
    req('Gợi ý từ khoá', { path: '/api/search/suggest?q=de', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Tối đa 8 gợi ý, mỗi gợi ý có id + name', () => {
            pm.expect(payload.length).to.be.at.most(8);
            payload.forEach((item) => pm.expect(item).to.include.keys('id', 'name'));
        });
    }) }),
    req('Gợi ý với 1 ký tự -> mảng rỗng', { path: '/api/search/suggest?q=d', test: ok(() => {
        pm.test('data = []', () => pm.expect(pm.response.json().data).to.eql([]));
    }) }),
    req('Tin liên quan (More Like This)', { path: '/api/search/related/{{searchJobId}}?limit=5', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Tối đa 5 tin, không chứa chính tin đang xem', () => {
            pm.expect(payload.length).to.be.at.most(5);
            pm.expect(payload.map((job) => job.id)).to.not.include(Number(pm.environment.get('searchJobId')));
        });
    }) }),
    req('CQRS: bản đọc khớp nguồn ghi (Job Core)', { path: '/api/jobs/{{searchJobId}}', test: ok(() => {
        const job = pm.response.json().data;
        pm.test('Tên tin trong Elasticsearch = trong MySQL', () => pm.expect(job.name).to.eql(pm.environment.get('searchJobName')));
        pm.test('Tin vẫn đang hiển thị', () => pm.expect(job.statusCode).to.eql('PS1'));
    }) })
]);

// ---------- 05 Applications ----------
const STAGES = ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'];
const needApp = skipUnless('applicationId', 'công ty A chưa có hồ sơ đã xem + đã chấm sao để thử an toàn.');
const f05 = folder('Application Service (PostgreSQL): hồ sơ ứng tuyển và Kanban', [
    'Bảng Kanban, phễu tuyển dụng, chi tiết hồ sơ, đánh giá sao, kho ứng viên, lịch phỏng vấn và',
    'phạm vi dữ liệu theo công ty. Không chuyển giai đoạn/gửi kết quả thật (sẽ phát email):',
    'các request đó chỉ thử đầu vào sai. Đánh giá sao được khôi phục, kho ứng viên được dọn lại.'
].join('\n'), [
    req('Các cột Kanban', { path: '/api/applications/stages', token: 'employer', test: ok(() => {
        pm.test('6 giai đoạn đúng thứ tự', () => pm.expect(pm.response.json().data.map((s) => s.stage)).to.eql(__STAGES__));
    }).map((l) => l.replace('__STAGES__', JSON.stringify(STAGES))) }),
    req('Bảng Kanban', { path: '/api/applications/board', token: 'employer', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('6 cột đúng thứ tự, cột rỗng vẫn có', () => pm.expect(payload.columns.map((c) => c.stage)).to.eql(__STAGES__));
        pm.test('count mỗi cột = số thẻ; total = tổng', () => {
            payload.columns.forEach((c) => pm.expect(c.count).to.eql(c.items.length));
            pm.expect(payload.total).to.eql(payload.columns.reduce((sum, c) => sum + c.count, 0));
        });
        pm.environment.set('boardTotal', payload.total);
        // Chon ho so DA XEM va DA CHAM SAO: mo chi tiet khong doi co is_read, sao khoi phuc duoc.
        const items = payload.columns.flatMap((c) => c.items);
        const target = items.find((a) => a.is_read && a.rating);
        if (target) {
            pm.environment.set('applicationId', target.id);
            pm.environment.set('applicationJobId', target.job_id);
            pm.environment.set('applicationOriginalRating', target.rating);
            pm.environment.set('applicationNewRating', target.rating === 5 ? 4 : target.rating + 1);
        } else {
            pm.environment.unset('applicationId');
        }
    }).map((l) => l.replace('__STAGES__', JSON.stringify(STAGES))) }),
    req('Kanban lọc theo tin', { path: '/api/applications/board?jobId={{applicationJobId}}', token: 'employer', pre: needApp, test: ok(() => {
        pm.test('Mọi thẻ thuộc đúng tin', () => pm.response.json().data.columns.flatMap((c) => c.items)
            .forEach((a) => pm.expect(a.job_id).to.eql(Number(pm.environment.get('applicationJobId')))));
    }) }),
    req('Phễu tuyển dụng', { path: '/api/applications/funnel', token: 'employer', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Tổng phễu = tổng Kanban', () => pm.expect(payload.total).to.eql(Number(pm.environment.get('boardTotal'))));
        pm.test('hired = số hồ sơ nhận việc', () => pm.expect(payload.hired).to.eql(payload.funnel.find((s) => s.stage === 'nhan_viec').count));
        pm.test('Tỷ lệ chuyển đổi tính đúng', () => {
            const expected = payload.total ? Number(((payload.hired / payload.total) * 100).toFixed(1)) : 0;
            pm.expect(payload.conversionRate).to.eql(expected);
        });
    }) }),
    req('Danh sách hồ sơ (phân trang)', { path: '/api/applications?limit=5&offset=0', token: 'employer', test: ok(() => {
        const body = pm.response.json();
        pm.test('Tổng số = tổng Kanban, tối đa 5 dòng', () => {
            pm.expect(body.count).to.eql(Number(pm.environment.get('boardTotal')));
            pm.expect(body.data.length).to.be.at.most(5);
        });
        pm.test('Chỉ hồ sơ của công ty mình', () => body.data.forEach((a) => pm.expect(a.company_id).to.eql(Number(pm.environment.get('employerCompanyId')))));
    }) }),
    req('Lọc theo giai đoạn phỏng vấn', { path: '/api/applications?stage=phong_van&limit=20', token: 'employer', test: ok(() => {
        pm.test('Mọi hồ sơ ở giai đoạn phong_van', () => pm.response.json().data.forEach((a) => pm.expect(a.stage).to.eql('phong_van')));
    }) }),
    req('Giai đoạn không hợp lệ -> 400', { path: '/api/applications?stage=abc', token: 'employer', test: contractError() }),
    req('Chi tiết hồ sơ (ghi chú + timeline)', { path: '/api/applications/{{applicationId}}', token: 'employer', pre: needApp, test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Đúng hồ sơ của công ty mình', () => {
            pm.expect(String(payload.id)).to.eql(String(pm.environment.get('applicationId')));
            pm.expect(payload.company_id).to.eql(Number(pm.environment.get('employerCompanyId')));
        });
        pm.test('Có notes và timeline', () => {
            pm.expect(payload.notes).to.be.an('array');
            pm.expect(payload.timeline).to.be.an('array');
        });
    }) }),
    req('Công ty B xem hồ sơ của công ty A -> 403', { path: '/api/applications/{{applicationId}}', token: 'employer2', pre: needApp, test: expectError(403, 'không có quyền xem hồ sơ', 3) }),
    req('Hồ sơ không tồn tại -> 404', { path: '/api/applications/999999999', token: 'employer', test: expectError(404, 'Không tìm thấy hồ sơ ứng tuyển', 2) }),
    req('Đánh giá sao ngoài 1-5 -> 400', { method: 'PATCH', path: '/api/applications/{{applicationId}}/rating', token: 'employer', pre: needApp, body: { rating: 6 }, test: contractError() }),
    req('Đổi đánh giá sao', {
        method: 'PATCH', path: '/api/applications/{{applicationId}}/rating', token: 'employer', pre: needApp,
        body: '{\n  "rating": {{applicationNewRating}}\n}',
        test: ok(() => pm.test('Đã lưu sao mới', () => pm.expect(pm.response.json().data.rating).to.eql(Number(pm.environment.get('applicationNewRating')))))
    }),
    req('Khôi phục đánh giá sao ban đầu', {
        method: 'PATCH', path: '/api/applications/{{applicationId}}/rating', token: 'employer', pre: needApp,
        body: '{\n  "rating": {{applicationOriginalRating}}\n}',
        test: ok(() => pm.test('Sao trở về như cũ', () => pm.expect(pm.response.json().data.rating).to.eql(Number(pm.environment.get('applicationOriginalRating')))))
    }),
    req('Chuyển sang giai đoạn không tồn tại -> 400 (không ghi)', {
        method: 'PATCH', path: '/api/applications/{{applicationId}}/stage', token: 'employer', pre: needApp, body: { stage: 'da_tuyen_ngay' }, test: contractError()
    }),
    req('Báo trúng tuyển thiếu offer -> 400 (không gửi email)', {
        method: 'POST', path: '/api/applications/{{applicationId}}/decision-notification', token: 'employer', pre: needApp,
        body: { decision: 'accepted', message: 'Chúc mừng' }, test: contractError()
    }),
    req('Mời phỏng vấn thiếu lịch -> 400 (không gửi email)', {
        method: 'POST', path: '/api/applications/{{applicationId}}/interview-invitation', token: 'employer', pre: needApp,
        body: { message: 'Mời bạn phỏng vấn' }, test: contractError()
    }),
    req('Ghi chú rỗng -> 400', { method: 'POST', path: '/api/applications/{{applicationId}}/notes', token: 'employer', pre: needApp, body: { body: '   ' }, test: contractError() }),
    req('Lịch phỏng vấn của công ty', { path: '/api/applications/interviews', token: 'employer', test: ok(() => {
        pm.test('data là mảng', () => pm.expect(pm.response.json().data).to.be.an('array'));
        pm.test('private, no-store', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
    }) }),
    req('Lịch phỏng vấn: from > to -> 400', { path: '/api/applications/interviews?from=2026-12-31&to=2026-01-01', token: 'employer', test: contractError() }),
    req('Kho ứng viên của công ty', { path: '/api/talent-pool', token: 'employer', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Chỉ dữ liệu của công ty mình', () => payload.forEach((t) => pm.expect(t.company_id).to.eql(Number(pm.environment.get('employerCompanyId')))));
        const exists = payload.some((t) => t.candidate_id === Number(pm.environment.get('candidateUserId')));
        pm.environment.set('talentPreexisting', String(exists));
    }) }),
    req('Lưu ứng viên vào kho', {
        method: 'POST', path: '/api/talent-pool', token: 'employer', pre: skipIfPreexisting,
        body: '{\n  "candidateId": {{candidateUserId}},\n  "candidateName": "{{candidateName}}",\n  "tags": ["postman-test"],\n  "note": "Lưu bởi bộ test Postman, sẽ bỏ ngay"\n}',
        test: created(() => {
            const row = pm.response.json().data;
            pm.test('Đúng ứng viên, đúng công ty', () => {
                pm.expect(row.candidate_id).to.eql(Number(pm.environment.get('candidateUserId')));
                pm.expect(row.company_id).to.eql(Number(pm.environment.get('employerCompanyId')));
                pm.expect(row.tags).to.eql(['postman-test']);
            });
        })
    }),
    req('Tìm trong kho theo tag', { path: '/api/talent-pool?tag=postman-test', token: 'employer', pre: skipIfPreexisting, test: ok(() => {
        pm.test('Có ứng viên vừa lưu', () => pm.expect(pm.response.json().data.map((t) => t.candidate_id)).to.include(Number(pm.environment.get('candidateUserId'))));
    }) }),
    req('Bỏ ứng viên khỏi kho', { method: 'DELETE', path: '/api/talent-pool/{{candidateUserId}}', token: 'employer', pre: skipIfPreexisting, test: ok() }),
    req('Bỏ lần nữa -> 404', { method: 'DELETE', path: '/api/talent-pool/{{candidateUserId}}', token: 'employer', pre: skipIfPreexisting, test: expectError(404, 'Không tìm thấy trong kho ứng viên', 2) }),
    req('Ứng viên: lịch sử ứng tuyển của tôi', { path: '/api/my-applications', token: 'candidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('count = số phần tử, có nhãn giai đoạn', () => {
            pm.expect(body.count).to.eql(body.data.length);
            body.data.forEach((a) => pm.expect(a.stageLabel).to.be.a('string'));
        });
        pm.test('Không lộ dữ liệu nội bộ của nhà tuyển dụng', () => body.data.forEach((a) => pm.expect(a).to.not.have.any.keys('rating', 'candidate_email', 'match_score')));
        pm.test('private, no-store', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
    }) }),
    req('Ứng viên: lịch phỏng vấn của tôi', { path: '/api/my-interviews', token: 'candidate', test: ok(() => {
        pm.test('data là mảng', () => pm.expect(pm.response.json().data).to.be.an('array'));
    }) }),
    req('Ứng viên vào kho ứng viên -> 403', { path: '/api/talent-pool', token: 'candidate', test: expectError(403, 'không có quyền') })
]);

// ---------- 06 Admin ----------
// Ghi nhat ky va su kien deu KHONG DONG BO (Gateway fire-and-forget, Outbox -> RabbitMQ).
// Hoi lai toi da 15 giay de ban ghi xuat hien truoc khi gui request chinh.
const pollAudit = (query, matchExpr, requiredVar) => script(() => {
    const deadline = Date.now() + (pm.environment.get('__REQUIRED__') ? 15000 : 0);
    const poll = () => pm.sendRequest({
        url: pm.environment.get('baseUrl') + __QUERY__,
        header: { Authorization: 'Bearer ' + pm.environment.get('adminAccessToken') }
    }, (err, res) => {
        const payload = (!err && res.code === 200 && res.json().data) || [];
        if (!payload.some((item) => __MATCH__) && Date.now() < deadline) setTimeout(poll, 1000);
    });
    if (deadline > Date.now()) poll();
}, { QUERY: query, MATCH: matchExpr, REQUIRED: requiredVar });
const f06 = folder('Admin & Reporting Service (MongoDB + nguồn MySQL/PostgreSQL)', [
    'Báo cáo tổng hợp từ nhiều kho dữ liệu, nhật ký hệ thống (Gateway ghi thao tác, RabbitMQ ghi sự kiện)',
    'và lớp bổ nghĩa master data. Tag tạo thử được xoá ngay. Chỉ ADMIN.'
].join('\n'), [
    req('Báo cáo tổng quan', { path: '/api/admin/reports/overview', token: 'admin', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Có đủ nhóm số liệu', () => pm.expect(payload).to.include.all.keys('khoangThoiGian', 'nguoiDung', 'congTy', 'tinTuyenDung', 'hoSoUngTuyen', 'doanhThu'));
        pm.test('Tổng doanh thu = gói tin + gói xem CV', () => {
            pm.expect(payload.doanhThu.tong).to.be.closeTo(payload.doanhThu.goiTin + payload.doanhThu.goiXemCv, 0.01);
        });
    }) }),
    req('Báo cáo tổng quan theo khoảng ngày', { path: '/api/admin/reports/overview?fromDate=2026-01-01&toDate=2026-12-31', token: 'admin', test: ok(() => {
        const range = pm.response.json().data.khoangThoiGian;
        pm.test('Ngày lịch Việt Nam (UTC+7), tính trọn ngày cuối', () => {
            pm.expect(Date.parse(range.from)).to.eql(Date.parse('2026-01-01T00:00:00.000+07:00'));
            pm.expect(Date.parse(range.to)).to.eql(Date.parse('2026-12-31T23:59:59.999+07:00'));
        });
    }) }),
    req('fromDate > toDate -> 400', { path: '/api/admin/reports/overview?fromDate=2026-12-31&toDate=2026-01-01', token: 'admin', test: contractError() }),
    req('Chuỗi thời gian', { path: '/api/admin/reports/timeseries', token: 'admin', test: ok(() => {
        const payload = pm.response.json().data;
        for (const key of ['tinTuyenDung', 'nguoiDungMoi', 'doanhThu', 'doanhThuXemCv', 'hoSoUngTuyen']) {
            pm.test(key + ' là mảng', () => pm.expect(payload[key]).to.be.an('array'));
        }
    }) }),
    req('Phân bố', { path: '/api/admin/reports/distribution', token: 'admin', test: ok(() => {
        const payload = pm.response.json().data;
        for (const key of ['theoNganhNghe', 'theoTinhThanh', 'theoMucLuong', 'theoVaiTro']) {
            pm.test(key + ': mảng {ten, soLuong}', () => payload[key].forEach((row) => pm.expect(row).to.include.keys('ten', 'soLuong')));
        }
    }) }),
    req('Phễu tuyển dụng toàn hệ thống', { path: '/api/admin/reports/funnel', token: 'admin', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Tổng = cộng các bước', () => pm.expect(payload.tong).to.eql(payload.pheu.reduce((sum, s) => sum + s.soLuong, 0)));
        pm.test('Có top công ty', () => pm.expect(payload.topCongTy).to.be.an('array'));
    }) }),
    req('Hoạt động hệ thống', { path: '/api/admin/reports/activity', token: 'admin', test: ok(() => {
        pm.test('Có theoLoai, theoService, theoNgay', () => pm.expect(pm.response.json().data).to.include.all.keys('theoLoai', 'theoService', 'theoNgay'));
    }) }),
    req('Nhật ký thao tác (5 dòng mới nhất)', { path: '/api/admin/audit?kind=action&limit=5', token: 'admin', test: ok(() => {
        const body = pm.response.json();
        pm.test('Tối đa 5 dòng, đều là action', () => {
            pm.expect(body.data.length).to.be.at.most(5);
            body.data.forEach((row) => pm.expect(row.kind).to.eql('action'));
        });
        pm.test('Mới nhất trước', () => {
            for (let i = 1; i < body.data.length; i += 1) pm.expect(new Date(body.data[i - 1].createdAt) >= new Date(body.data[i].createdAt)).to.be.true;
        });
    }) }),
    req('Gateway -> Admin: thao tác PUT ở thư mục Job Core đã được ghi (theo correlationId)', {
        path: '/api/admin/audit?kind=action&correlationId={{auditCorrelationId}}', token: 'admin',
        pre: [...skipUnless('auditCorrelationId', 'chưa chạy request "Sửa không đổi nội dung" ở thư mục Job Core.'),
            ...pollAudit("'/api/admin/audit?kind=action&correlationId=' + pm.environment.get('auditCorrelationId')", 'true', 'auditCorrelationId')],
        test: ok(() => {
            const row = pm.response.json().data[0];
            pm.test('Tìm thấy đúng 1 bản ghi', () => pm.expect(pm.response.json().data).to.have.lengthOf(1));
            pm.test('Đúng route, người làm, kết quả', () => {
                pm.expect(row.name).to.eql('PUT /api/jobs/' + pm.environment.get('jobId'));
                pm.expect(row.actorId).to.eql(Number(pm.environment.get('employerUserId')));
                pm.expect(row.companyId).to.eql(Number(pm.environment.get('employerCompanyId')));
                pm.expect(row.status).to.eql(200);
            });
        })
    }),
    req('Lịch sử theo đối tượng (tin tuyển dụng)', { path: '/api/admin/audit/target/job/{{jobId}}', token: 'admin', test: ok(() => {
        pm.test('Mọi bản ghi gắn đúng tin', () => pm.response.json().data.forEach((row) => {
            pm.expect(row.targetType).to.eql('job');
            pm.expect(row.targetId).to.eql(String(pm.environment.get('jobId')));
        }));
    }) }),
    req('Master data: ngành nghề', { path: '/api/admin/master-data?type=JOBTYPE', token: 'admin', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Có dữ liệu, đúng loại, có lớp bổ nghĩa', () => {
            pm.expect(payload.length).to.be.above(0);
            payload.forEach((row) => {
                pm.expect(row.type).to.eql('JOBTYPE');
                pm.expect(row.aliases).to.be.an('array');
                pm.expect(row.hasTag).to.be.a('boolean');
            });
        });
    }) }),
    req('Tạo tag bổ nghĩa (loại riêng cho kiểm thử)', {
        method: 'POST', path: '/api/admin/master-data', token: 'admin',
        body: { type: 'POSTMAN_TEST', name: 'Tag kiểm thử Postman', aliases: ['postman', 'newman'], group: 'Kiểm thử', weight: 1, isActive: true },
        test: ok(() => {
            const tag = pm.response.json().data;
            pm.test('Tag có _id và đúng dữ liệu', () => {
                pm.expect(tag._id).to.match(/^[a-f0-9]{24}$/);
                pm.expect(tag.slug).to.eql('tag-kiểm-thử-postman');
                pm.expect(tag.createdBy).to.eql(Number(pm.environment.get('adminUserId')));
            });
            pm.environment.set('tagId', tag._id);
        })
    }),
    req('Xoá tag kiểm thử', { method: 'DELETE', path: '/api/admin/master-data/{{tagId}}', token: 'admin', test: ok() }),
    req('Xoá lại -> 404', { method: 'DELETE', path: '/api/admin/master-data/{{tagId}}', token: 'admin', test: expectError(404, 'Không tìm thấy danh mục', 2) }),
    req('tagId sai định dạng -> 400', { method: 'DELETE', path: '/api/admin/master-data/abc', token: 'admin', test: contractError() }),
    req('Nhà tuyển dụng ghi master data -> 403', {
        method: 'POST', path: '/api/admin/master-data', token: 'employer', body: { type: 'POSTMAN_TEST', name: 'x' }, test: expectError(403, 'không có quyền')
    })
]);

// ---------- 07 Support ----------
const f07 = folder('Support Chat Service: chatbot hỗ trợ (SSE)', [
    'Kho kiến thức, hội thoại của khách/người dùng, công cụ tra cứu riêng tư và hàng đợi chuyển nhân viên.',
    'Câu hỏi thử là câu hỏi về tài khoản ("hồ sơ ứng tuyển của tôi") nên được trả lời trực tiếp',
    'từ dữ liệu, KHÔNG gọi AI. Hội thoại tạo thử bị xoá ở cuối thư mục.'
].join('\n'), [
    req('Kho kiến thức (khách vãng lai)', { path: '/api/support/knowledge', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Có bài viết với id/title/href/text/version', () => {
            pm.expect(payload.length).to.be.above(0);
            payload.forEach((a) => pm.expect(a).to.include.all.keys('id', 'title', 'href', 'text', 'version'));
        });
        pm.test('Không lộ từ khoá nội bộ', () => payload.forEach((a) => pm.expect(a).to.not.have.property('keywords')));
    }) }),
    req('Khách vãng lai được cấp mã guest', { path: '/api/support/conversations', test: ok(() => {
        pm.test('Có header X-Support-Guest', () => pm.expect(pm.response.headers.get('X-Support-Guest')).to.be.a('string').and.not.empty);
        pm.test('Khách mới chưa có hội thoại', () => pm.expect(pm.response.json().data).to.eql([]));
    }) }),
    req('Công cụ riêng tư: đơn ứng tuyển của tôi', { path: '/api/support/private/getMyApplications', token: 'pm', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('Có title, lines, href', () => {
            pm.expect(payload.title).to.be.a('string');
            pm.expect(payload.lines).to.be.an('array');
            pm.expect(payload.href).to.match(/^\//);
        });
    }) }),
    req('Tên công cụ không cho phép -> 400', { path: '/api/support/private/xoaDuLieu', token: 'pm', test: contractError() }),
    req('Khách gọi công cụ riêng tư -> 401', { path: '/api/support/private/getMyApplications', test: expectError(401, 'Bạn cần đăng nhập') }),
    withAiQuota(req('Hỏi chatbot về tài khoản (SSE, không gọi AI)', {
        method: 'POST', path: '/api/support/turn', token: 'pm',
        pre: script(() => { pm.environment.unset('supportConversationId'); pm.environment.unset('supportAnswerId'); }),
        body: '{\n  "requestId": "{{$guid}}",\n  "text": "Trạng thái hồ sơ ứng tuyển của tôi thế nào?"\n}',
        description: 'Response là Server-Sent Events: state -> token -> done.',
        test: expectStatus(200, () => {
            pm.test('Content-Type text/event-stream', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('text/event-stream'));
            const events = pm.response.text().split(/\r?\n\r?\n/).filter((chunk) => chunk.trim()).map((chunk) => {
                const name = (/^event: (.+)$/m.exec(chunk) || [])[1];
                const payload = (/^data: (.+)$/m.exec(chunk) || [])[1];
                return { name, data: payload ? JSON.parse(payload) : null };
            });
            pm.test('Thứ tự sự kiện state -> token -> done', () => {
                pm.expect(events.map((e) => e.name)).to.eql(['state', 'token', 'done']);
            });
            const token = events.find((e) => e.name === 'token');
            pm.test('Trả lời từ dữ liệu tài khoản, không gửi cho AI', () => pm.expect(token.data.text).to.include('không gửi kết quả cho AI'));
            const state = events[0].data;
            pm.environment.set('supportConversationId', state.id);
            pm.environment.set('supportAnswerId', state.answerId);
        })
    })),
    req('Xem lại hội thoại vừa tạo', { pre: skipUnless('supportConversationId', 'request hỏi chatbot đã bị bỏ qua (hết hạn mức AI trong giờ).'), path: '/api/support/conversations/{{supportConversationId}}', token: 'pm', test: ok(() => {
        const payload = pm.response.json().data;
        pm.test('2 tin: câu hỏi + câu trả lời hoàn tất', () => {
            pm.expect(payload.messages.map((m) => m.role)).to.eql(['user', 'assistant']);
            pm.expect(payload.messages[1].status).to.eql('complete');
            pm.expect(payload.messages[1].id).to.eql(pm.environment.get('supportAnswerId'));
        });
    }) }),
    req('Danh sách hội thoại có cuộc vừa tạo', { pre: skipUnless('supportConversationId', 'request hỏi chatbot đã bị bỏ qua (hết hạn mức AI trong giờ).'), path: '/api/support/conversations', token: 'pm', test: ok(() => {
        pm.test('Chứa supportConversationId', () => pm.expect(pm.response.json().data.map((c) => c.id)).to.include(pm.environment.get('supportConversationId')));
    }) }),
    req('Đánh giá câu trả lời (thumbs up)', {
        pre: skipUnless('supportConversationId', 'request hỏi chatbot đã bị bỏ qua (hết hạn mức AI trong giờ).'),
        method: 'POST', path: '/api/support/conversations/{{supportConversationId}}/messages/{{supportAnswerId}}/feedback',
        token: 'pm', body: { value: 'up' },
        test: ok(() => pm.test('saved = true', () => pm.expect(pm.response.json().data.saved).to.be.true))
    }),
    req('Người khác đọc hội thoại -> 404', {
        pre: skipUnless('supportConversationId', 'request hỏi chatbot đã bị bỏ qua (hết hạn mức AI trong giờ).'),
        path: '/api/support/conversations/{{supportConversationId}}', token: 'employer',
        test: expectError(404, 'Không tìm thấy hội thoại')
    }),
    req('Xoá hội thoại', { pre: skipUnless('supportConversationId', 'request hỏi chatbot đã bị bỏ qua (hết hạn mức AI trong giờ).'), method: 'DELETE', path: '/api/support/conversations/{{supportConversationId}}', token: 'pm', test: ok(() => {
        pm.test('deleted = true', () => pm.expect(pm.response.json().data.deleted).to.be.true);
    }) }),
    req('Hội thoại đã xoá -> 404', { pre: skipUnless('supportConversationId', 'request hỏi chatbot đã bị bỏ qua (hết hạn mức AI trong giờ).'), path: '/api/support/conversations/{{supportConversationId}}', token: 'pm', test: expectError(404, 'Không tìm thấy hội thoại') }),
    req('Hàng đợi chuyển nhân viên (ADMIN)', { path: '/api/support/handoffs', token: 'admin', test: ok(() => {
        pm.test('Mỗi phiếu có trạng thái hợp lệ', () => pm.response.json().data.forEach((t) => pm.expect(t.status).to.be.oneOf(['waiting', 'assigned', 'resolved'])));
    }) }),
    req('Ứng viên xem hàng đợi -> 403', { path: '/api/support/handoffs', token: 'candidate', test: expectError(403, 'không có quyền') })
]);

// ---------- 08 AI ----------
const aiGuard = script(() => {
    if (pm.environment.get('allowAiCalls') !== 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": đặt allowAiCalls = true trong environment để gọi AI thật (tốn quota).');
        pm.execution.skipRequest();
    }
});
const f08 = folder('AI: Job Core -> RabbitMQ -> AI Worker', [
    'Tính năng AI chạy bất đồng bộ: Job Core ghi ai_tasks + outbox rồi trả 202 + taskId; AI Worker',
    'nhận việc qua RabbitMQ, gọi Claude, phát ai.result; client hỏi lại GET /api/ai/tasks/:id.'
].join('\n'), [
    folder('a - Kiểm tra đầu vào và phân quyền (không gọi AI)', 'Mọi request bị từ chối trước khi tạo tác vụ.', [
        withAiQuota(req('Gợi ý trả lời khi tin cuối là của mình -> 400', {
            method: 'POST', path: '/api/ai/chat-assist', token: 'pm',
            body: { mode: 'suggest', language: 'vi', messages: [{ from: 'me', text: 'Chào anh, em muốn hỏi về vị trí này.' }] },
            test: expectError(400, 'Chưa có tin nhắn mới của đối phương', 1)
        })),
        withAiQuota(req('Chế độ không tồn tại -> 400', {
            method: 'POST', path: '/api/ai/chat-assist', token: 'pm', body: { mode: 'hack', draft: 'x' }, test: contractError()
        })),
        req('Ứng viên chấm CV (chỉ nhà tuyển dụng) -> 403', {
            method: 'POST', path: '/api/ai/screen-application', token: 'pm', body: { cvId: 1 }, test: expectError(403, 'không có quyền')
        }),
        req('Nhà tuyển dụng tạo CV bằng AI (chỉ ứng viên) -> 403', {
            method: 'POST', path: '/api/ai/generate-cv', token: 'employer', body: { sourceText: 'Kinh nghiệm Node.js', language: 'vi' }, test: expectError(403, 'không có quyền')
        }),
        withAiQuota(req('Idempotency-Key sai định dạng -> 400', {
            method: 'POST', path: '/api/ai/chat-assist', token: 'pm', headers: { 'Idempotency-Key': '!!!' },
            body: { mode: 'polish', language: 'vi', draft: 'Xin chào' }, test: contractError()
        })),
        req('Tác vụ không tồn tại -> 404', { path: '/api/ai/tasks/khong-ton-tai', token: 'pm', test: expectError(404, 'Không tìm thấy yêu cầu', 2) }),
        req('Kết quả AI chấm CV theo tin', { path: '/api/ai/jobs/{{jobId}}/screenings', token: 'employer', test: ok(() => {
            pm.test('data là mảng', () => pm.expect(pm.response.json().data).to.be.an('array'));
            pm.test('private, no-store', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));
        }) })
    ]),
    folder('b - Gọi AI thật (cần allowAiCalls = true)', [
        'Tốn 1 lượt gọi Claude (viết lại một tin nhắn ngắn). Mặc định bị bỏ qua.',
        'Hạn mức Gateway: 30 lượt AI/giờ cho mỗi tài khoản (test dùng tài khoản Postman).'
    ].join('\n'), [
        withAiQuota(req('Tạo tác vụ viết lại tin nhắn -> 202', {
            method: 'POST', path: '/api/ai/chat-assist', token: 'pm', headers: { 'Idempotency-Key': '{{aiIdempotencyKey}}' },
            body: { mode: 'polish', language: 'vi', draft: 'em chao anh, em muon hoi ve vi tri backend con tuyen ko a' },
            pre: script(() => { pm.environment.unset('aiTaskId'); pm.environment.set('aiIdempotencyKey', 'postman-ai-' + Date.now()); }),
            test: expectStatus(202, () => {
                const body = pm.response.json();
                pm.test('errCode = 0 và có taskId', () => {
                    pm.expect(body.errCode).to.eql(0);
                    pm.expect(body.taskId).to.be.a('string').and.not.empty;
                });
                pm.environment.set('aiTaskId', body.taskId);
            })
        })),
        withAiQuota(req('Gửi lại cùng Idempotency-Key -> cùng taskId (không gọi AI lần 2)', {
            pre: skipUnless('aiTaskId', 'request tạo tác vụ AI đã bị bỏ qua.'),
            method: 'POST', path: '/api/ai/chat-assist', token: 'pm', headers: { 'Idempotency-Key': '{{aiIdempotencyKey}}' },
            body: { mode: 'polish', language: 'vi', draft: 'em chao anh, em muon hoi ve vi tri backend con tuyen ko a' },
            test: expectStatus(202, () => {
                pm.test('Cùng taskId', () => pm.expect(pm.response.json().taskId).to.eql(pm.environment.get('aiTaskId')));
            })
        })),
        req('Chờ AI Worker xử lý xong', {
            path: '/api/ai/tasks/{{aiTaskId}}', token: 'pm',
            description: 'Pre-request tự hỏi lại mỗi 3 giây (tối đa 90 giây) tới khi tác vụ hết pending.',
            pre: [...skipUnless('aiTaskId', 'request tạo tác vụ AI đã bị bỏ qua.'), ...script(() => {
                const deadline = Date.now() + 90000;
                const poll = () => pm.sendRequest({
                    url: pm.environment.get('baseUrl') + '/api/ai/tasks/' + pm.environment.get('aiTaskId'),
                    header: { Authorization: 'Bearer ' + pm.environment.get('pmAccessToken') }
                }, (err, res) => {
                    const status = !err && res.code === 200 ? res.json().data.status : 'pending';
                    if (status === 'pending' && Date.now() < deadline) setTimeout(poll, 3000);
                });
                if (pm.environment.get('aiTaskId')) poll();
            })],
            test: ok(() => {
                const task = pm.response.json().data;
                pm.test('Tác vụ hoàn tất (done)', () => pm.expect(task.status, task.error || '').to.eql('done'));
                pm.test('Đúng loại write_assist và có kết quả', () => {
                    pm.expect(task.type).to.eql('write_assist');
                    pm.expect(task.result).to.not.be.null;
                });
            })
        }),
        req('Người khác xem kết quả AI -> 403', { pre: skipUnless('aiTaskId', 'request tạo tác vụ AI đã bị bỏ qua.'), path: '/api/ai/tasks/{{aiTaskId}}', token: 'employer', test: expectError(403, 'không có quyền xem kết quả', 3) })
    ], { pre: aiGuard })
]);

// ---------- 09 Side effects ----------
const sideEffectGuard = script(() => {
    if (pm.environment.get('allowSideEffects') !== 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": đặt allowSideEffects = true để chạy luồng ghi thật.');
        pm.execution.skipRequest();
    }
});
const jobBody = '{\n  "name": "[Postman] Tin kiểm thử - sẽ gỡ ngay",\n  "descriptionHTML": "<p>Tin tạo bởi bộ test Postman để kiểm tra Outbox/RabbitMQ.</p>",\n  "descriptionMarkdown": "Tin tạo bởi bộ test Postman để kiểm tra Outbox/RabbitMQ.",\n  "categoryJobCode": "cong-nghe-thong-tin",\n  "amount": 1\n}';
const pollTarget = (eventName) => [...script(() => {
    if (pm.environment.get('allowSideEffects') !== 'true') pm.environment.unset('newJobId');
}), ...pollAudit("'/api/admin/audit/target/job/' + pm.environment.get('newJobId')", `item.name === '${eventName}'`, 'newJobId')];
const f09 = folder('[Tùy chọn] Luồng ghi CQRS thật: tạo tin -> Outbox -> RabbitMQ -> gỡ tin', [
    'CHỈ chạy khi chấp nhận tác dụng phụ (đặt allowSideEffects = true):',
    '- trừ 1 lượt đăng tin trong gói của công ty B (không hoàn lại khi gỡ tin);',
    '- phát yêu cầu AI kiểm duyệt (tốn quota) - tin bị gỡ ngay nên kết quả bị bỏ qua;',
    '- để lại 1 tin trạng thái PS4 (đã gỡ) trong MySQL.',
    'Kiểm tra: idempotency khi đăng tin, tin chờ duyệt không lộ ra công khai, sự kiện job.created/',
    'job.deleted đi qua Outbox -> RabbitMQ tới Admin Service.'
].join('\n'), [
    req('Tạo tin (Idempotency-Key) -> 201, chờ duyệt PS3', {
        method: 'POST', path: '/api/jobs', token: 'employer2', headers: { 'Idempotency-Key': '{{jobIdempotencyKey}}' }, body: jobBody,
        pre: script(() => pm.environment.set('jobIdempotencyKey', 'postman-job-' + Date.now())),
        test: created(() => {
            const job = pm.response.json().data;
            pm.test('Tin mới ở trạng thái chờ duyệt, đúng công ty', () => {
                pm.expect(job.statusCode).to.eql('PS3');
                pm.expect(job.companyId).to.eql(Number(pm.environment.get('employer2CompanyId')));
            });
            pm.environment.set('newJobId', job.id);
        })
    }),
    req('Gửi lại cùng Idempotency-Key -> cùng tin, không trừ lượt lần 2', {
        method: 'POST', path: '/api/jobs', token: 'employer2', headers: { 'Idempotency-Key': '{{jobIdempotencyKey}}' }, body: jobBody,
        test: created(() => pm.test('Cùng id tin', () => pm.expect(pm.response.json().data.id).to.eql(Number(pm.environment.get('newJobId')))))
    }),
    req('Cùng Idempotency-Key nhưng nội dung khác -> 409', {
        method: 'POST', path: '/api/jobs', token: 'employer2', headers: { 'Idempotency-Key': '{{jobIdempotencyKey}}' },
        body: jobBody.replace('sẽ gỡ ngay', 'nội dung khác'),
        test: expectError(409, 'Mã thao tác đã dùng cho nội dung khác', 2)
    }),
    req('Tin chờ duyệt không xem được công khai -> 404', { path: '/api/jobs/{{newJobId}}', test: expectError(404, 'Không tìm thấy tin tuyển dụng', 2) }),
    req('Outbox -> RabbitMQ -> Admin ghi sự kiện job.created', {
        path: '/api/admin/audit/target/job/{{newJobId}}', token: 'admin', pre: pollTarget('job.created'),
        test: ok(() => pm.test('Có sự kiện job.created', () => pm.expect(pm.response.json().data.map((e) => e.name)).to.include('job.created')))
    }),
    req('Gỡ tin -> 200', { method: 'DELETE', path: '/api/jobs/{{newJobId}}', token: 'employer2', test: ok(() => {
        pm.test('Thông báo đã gỡ', () => pm.expect(pm.response.json().errMessage).to.eql('Đã gỡ tin tuyển dụng'));
    }) }),
    req('Tin đã gỡ chuyển PS4 (giữ lại để đối chiếu)', { path: '/api/jobs/{{newJobId}}/manage', token: 'employer2', test: ok(() => {
        pm.test('statusCode = PS4', () => pm.expect(pm.response.json().data.statusCode).to.eql('PS4'));
    }) }),
    req('Outbox -> RabbitMQ -> Admin ghi sự kiện job.deleted', {
        path: '/api/admin/audit/target/job/{{newJobId}}', token: 'admin', pre: pollTarget('job.deleted'),
        test: ok(() => pm.test('Có sự kiện job.deleted', () => pm.expect(pm.response.json().data.map((e) => e.name)).to.include('job.deleted')))
    }),
    req('Search không liệt kê tin đã gỡ', { path: '/api/search/jobs?q=Postman kiểm thử&limit=50', test: ok(() => {
        pm.test('Không có newJobId', () => pm.expect(pm.response.json().data.map((j) => j.id)).to.not.include(Number(pm.environment.get('newJobId'))));
    }) })
], { pre: sideEffectGuard });


export { f02 as identity, f03 as jobCore, f04 as search, f05 as applications, f06 as admin, f07 as support, f08 as ai, f09 as cqrsWrite, pollAudit, STAGES };
