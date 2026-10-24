// Business features still served by the legacy backend (routed by the gateway).
import {
    script, req, folder, lines, expectStatus, expectError, legacyError, legacyForbidden, ok, skipUnless
} from '../lib.mjs';
import { CV_PDF_DATA_URL, PUSH_SUBSCRIPTION } from '../fixtures.mjs';

const adminOnly = (name, method, path, body) => req(name, { method, path, token: 'employer', body, test: legacyForbidden() });

// Remove a leftover test row from an interrupted earlier run before creating it again.
const cleanupAllcode = script(() => {
    pm.sendRequest({
        url: pm.environment.get('baseUrl') + '/api/delete-all-code', method: 'DELETE',
        header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pm.environment.get('adminAccessToken') },
        body: { mode: 'raw', raw: JSON.stringify({ code: 'postman-test-code' }) }
    }, () => {});
});
const cleanupSkill = script(() => {
    const base = pm.environment.get('baseUrl');
    const auth = { Authorization: 'Bearer ' + pm.environment.get('adminAccessToken') };
    pm.sendRequest({ url: base + '/api/get-list-skill?categoryJobCode=cong-nghe-thong-tin&limit=50&offset=0&search=' + encodeURIComponent('Postman Test Skill'), header: auth }, (err, res) => {
        const rows = (!err && res.code === 200 && res.json().data) || [];
        rows.filter((s) => /^Postman Test Skill/.test(s.name)).forEach((s) => pm.sendRequest({
            url: base + '/api/delete-skill', method: 'DELETE', header: Object.assign({ 'Content-Type': 'application/json' }, auth),
            body: { mode: 'raw', raw: JSON.stringify({ id: s.id }) }
        }, () => {}));
    });
});

const catalog = folder('Danh mục dùng chung: mã danh mục và kỹ năng', lines(
    'Danh mục (allcodes: ngành, tỉnh, lương, kinh nghiệm...) và kỹ năng theo ngành. Đọc công khai;',
    'thêm/sửa/xoá chỉ ADMIN. Bản ghi thử dùng loại riêng POSTMAN_TEST và kỹ năng "Postman Test Skill", xoá ngay.'
), [
    req('Danh mục ngành nghề (JOBTYPE)', { path: '/api/get-all-code?type=JOBTYPE', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Có dữ liệu, đúng loại, có mã và tên', () => {
            pm.expect(rows.length).to.be.above(0);
            rows.forEach((r) => { pm.expect(r.type).to.eql('JOBTYPE'); pm.expect(r.code).to.be.a('string'); pm.expect(r.value).to.be.a('string'); });
        });
        pm.test('Có ngành Công nghệ thông tin', () => pm.expect(rows.map((r) => r.code)).to.include('cong-nghe-thong-tin'));
    }) }),
    req('Danh mục tỉnh thành (PROVINCE)', { path: '/api/get-all-code?type=PROVINCE', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Có tỉnh thành, đúng loại', () => {
            pm.expect(rows.length).to.be.above(0);
            rows.forEach((r) => pm.expect(r.type).to.eql('PROVINCE'));
        });
    }) }),
    req('Danh mục có phân trang', { path: '/api/get-list-allcode?type=JOBTYPE&limit=3&offset=0&search=', test: ok(() => {
        const body = pm.response.json();
        pm.test('Tối đa 3 dòng, có tổng số', () => {
            pm.expect(body.data.length).to.be.at.most(3);
            pm.expect(body.count).to.be.at.least(body.data.length);
        });
    }) }),
    req('Chi tiết danh mục theo mã', { path: '/api/get-detail-all-code-by-code?code=cong-nghe-thong-tin', test: ok(() => {
        const row = pm.response.json().data;
        pm.test('Đúng mã và tên', () => {
            pm.expect(row.code).to.eql('cong-nghe-thong-tin');
            pm.expect(row.value).to.eql('Công nghệ thông tin');
        });
    }) }),
    req('Số tin đang tuyển theo ngành', { path: '/api/get-list-job-count-post?limit=5&offset=0', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Tối đa 5 ngành, số lượng là số', () => {
            pm.expect(rows.length).to.be.at.most(5);
            rows.forEach((r) => pm.expect(Number(r.amount)).to.be.at.least(0));
        });
    }) }),
    req('Kỹ năng theo ngành', { path: '/api/get-all-skill-by-job-code?categoryJobCode=cong-nghe-thong-tin', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Đúng ngành, có Reactjs', () => {
            rows.forEach((r) => pm.expect(r.categoryJobCode).to.eql('cong-nghe-thong-tin'));
            pm.expect(rows.map((r) => r.name)).to.include('Reactjs');
        });
    }) }),
    req('Kỹ năng có phân trang', { path: '/api/get-list-skill?categoryJobCode=cong-nghe-thong-tin&limit=3&offset=0&search=', test: ok(() => {
        const body = pm.response.json();
        pm.test('Tối đa 3 dòng, có tổng số', () => {
            pm.expect(body.data.length).to.be.at.most(3);
            pm.expect(body.count).to.be.at.least(body.data.length);
        });
    }) }),
    req('Admin: chi tiết kỹ năng', { path: '/api/get-detail-skill-by-id?id=1', token: 'admin', test: ok(() => {
        pm.test('Có tên và ngành', () => {
            const skill = pm.response.json().data;
            pm.expect(skill.name).to.be.a('string');
            pm.expect(skill.jobTypeSkillData.code).to.eql(skill.categoryJobCode);
        });
    }) }),
    req('Admin: thêm mã danh mục thử', {
        method: 'POST', path: '/api/create-new-all-code', token: 'admin', pre: cleanupAllcode,
        body: { type: 'POSTMAN_TEST', code: 'postman-test-code', value: 'Mã kiểm thử Postman' }, test: ok()
    }),
    req('Thêm trùng mã -> errCode 2', {
        method: 'POST', path: '/api/create-new-all-code', token: 'admin',
        body: { type: 'POSTMAN_TEST', code: 'postman-test-code', value: 'Trùng mã' }, test: legacyError(2, 'Mã code đã tồn tại')
    }),
    req('Mã mới có trong danh mục', { path: '/api/get-all-code?type=POSTMAN_TEST', test: ok(() => {
        pm.test('Có postman-test-code', () => pm.expect(pm.response.json().data.map((r) => r.code)).to.include('postman-test-code'));
    }) }),
    req('Admin: sửa tên mã danh mục', {
        method: 'PUT', path: '/api/update-all-code', token: 'admin',
        body: { code: 'postman-test-code', value: 'Mã kiểm thử Postman (đã sửa)' }, test: ok()
    }),
    req('Tên mới đã được lưu', { path: '/api/get-detail-all-code-by-code?code=postman-test-code', test: ok(() => {
        pm.test('value đã đổi', () => pm.expect(pm.response.json().data.value).to.eql('Mã kiểm thử Postman (đã sửa)'));
    }) }),
    req('Admin: xoá mã danh mục thử', { method: 'DELETE', path: '/api/delete-all-code', token: 'admin', body: { code: 'postman-test-code' }, test: ok() }),
    req('Xoá lại mã đã xoá -> errCode 2', {
        method: 'DELETE', path: '/api/delete-all-code', token: 'admin', body: { code: 'postman-test-code' }, test: legacyError(2, 'Không tồn tại code')
    }),
    req('Thêm mã thiếu dữ liệu -> errCode 1', {
        method: 'POST', path: '/api/create-new-all-code', token: 'admin', body: { type: 'POSTMAN_TEST' }, test: legacyError(1, 'Missing required parameters')
    }),
    adminOnly('Nhà tuyển dụng thêm mã danh mục -> 403', 'POST', '/api/create-new-all-code', { type: 'POSTMAN_TEST', code: 'x', value: 'x' }),
    req('Admin: thêm kỹ năng thử', {
        method: 'POST', path: '/api/create-new-skill', token: 'admin', pre: cleanupSkill,
        body: { name: 'Postman Test Skill', categoryJobCode: 'cong-nghe-thong-tin' }, test: ok()
    }),
    req('Thêm trùng kỹ năng -> errCode 2', {
        method: 'POST', path: '/api/create-new-skill', token: 'admin',
        body: { name: 'Postman Test Skill', categoryJobCode: 'cong-nghe-thong-tin' }, test: legacyError(2, 'Tên kĩ năng đã có trong lĩnh vực này')
    }),
    req('Tìm kỹ năng vừa thêm', {
        path: '/api/get-list-skill?categoryJobCode=cong-nghe-thong-tin&limit=10&offset=0&search=Postman%20Test%20Skill', token: 'admin',
        test: ok(() => {
            const skill = pm.response.json().data.find((s) => s.name === 'Postman Test Skill');
            pm.test('Tìm thấy kỹ năng', () => pm.expect(skill).to.not.be.undefined);
            if (skill) pm.environment.set('testSkillId', skill.id);
        })
    }),
    req('Admin: đổi tên kỹ năng', {
        method: 'PUT', path: '/api/update-skill', token: 'admin',
        body: '{\n  "id": {{testSkillId}},\n  "name": "Postman Test Skill (đã sửa)",\n  "categoryJobCode": "cong-nghe-thong-tin"\n}', test: ok()
    }),
    req('Tên kỹ năng đã đổi', { path: '/api/get-detail-skill-by-id?id={{testSkillId}}', token: 'admin', test: ok(() => {
        pm.test('Tên mới', () => pm.expect(pm.response.json().data.name).to.eql('Postman Test Skill (đã sửa)'));
    }) }),
    req('Admin: xoá kỹ năng thử', { method: 'DELETE', path: '/api/delete-skill', token: 'admin', body: '{\n  "id": {{testSkillId}}\n}', test: ok() }),
    req('Xoá lại kỹ năng đã xoá -> errCode 2', {
        method: 'DELETE', path: '/api/delete-skill', token: 'admin', body: '{\n  "id": {{testSkillId}}\n}', test: legacyError(2, 'Không tồn tại kĩ năng')
    }),
    adminOnly('Nhà tuyển dụng xoá kỹ năng -> 403', 'DELETE', '/api/delete-skill', { id: 1 })
]);

const companies = folder('Công ty', lines(
    'Danh sách/chi tiết công ty công khai, thông tin riêng của công ty mình, nhân sự công ty, danh sách của admin',
    'và phân quyền các thao tác ghi (tạo, sửa, khoá, rời công ty). Không request nào ghi dữ liệu thật.'
), [
    req('Danh sách công ty (công khai)', { path: '/api/get-list-company?limit=5&offset=0&search=', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số, tối đa 5 dòng', () => {
            pm.expect(body.count).to.be.at.least(body.data.length);
            pm.expect(body.data.length).to.be.at.most(5);
        });
        pm.test('Chỉ công ty đang hoạt động và đã duyệt', () => body.data.forEach((c) => {
            pm.expect(c.statusCode).to.eql('S1');
            pm.expect(c.censorCode).to.eql('CS1');
        }));
        pm.test('Không lộ mã số thuế, hạn mức, giấy phép', () => body.data.forEach((c) => pm.expect(c).to.not.have.any.keys('taxnumber', 'allowPost', 'allowCv', 'file')));
    }) }),
    req('Tìm công ty theo tên', { path: '/api/get-list-company?limit=10&offset=0&search=Sao%20Khu%C3%AA', test: ok(() => {
        pm.test('Có công ty B', () => pm.expect(pm.response.json().data.map((c) => c.id)).to.include(Number(pm.environment.get('employer2CompanyId'))));
    }) }),
    req('Chi tiết công ty', { path: '/api/get-detail-company-by-id?id={{employer2CompanyId}}', test: ok(() => {
        const company = pm.response.json().data;
        pm.test('Đúng công ty', () => pm.expect(company.id).to.eql(Number(pm.environment.get('employer2CompanyId'))));
        pm.test('Không lộ mã số thuế, hạn mức', () => pm.expect(company).to.not.have.any.keys('taxnumber', 'allowPost', 'allowHotPost', 'allowCv'));
    }) }),
    req('Đánh giá của công ty', { path: '/api/get-review-by-company?companyId={{employer2CompanyId}}&limit=5&offset=0', test: ok(() => {
        const body = pm.response.json();
        pm.test('Sao trong khoảng 1-5, có điểm trung bình', () => {
            body.data.forEach((r) => pm.expect(r.star).to.be.within(1, 5));
            if (body.count) pm.expect(Number(body.averageStar)).to.be.within(1, 5);
        });
    }) }),
    req('Số người theo dõi công ty (khách)', { path: '/api/check-follow-company?companyId={{employer2CompanyId}}&userId=', test: ok(() => {
        const body = pm.response.json();
        pm.test('Khách chưa theo dõi, có số người theo dõi', () => {
            pm.expect(body.isFollow).to.be.false;
            pm.expect(body.countFollower).to.be.at.least(0);
        });
    }) }),
    req('Thông tin riêng của công ty mình', {
        path: '/api/get-detail-company-by-userId?userId={{employerUserId}}&companyId={{employerCompanyId}}', token: 'employer',
        test: ok(() => {
            const company = pm.response.json().data;
            pm.test('Đúng công ty, có thông tin riêng (mã số thuế)', () => {
                pm.expect(company.id).to.eql(Number(pm.environment.get('employerCompanyId')));
                pm.expect(company).to.have.property('taxnumber');
            });
        })
    }),
    req('Ứng viên xem thông tin riêng công ty -> 403', {
        path: '/api/get-detail-company-by-userId?userId={{employerUserId}}&companyId={{employerCompanyId}}', token: 'candidate', test: legacyForbidden()
    }),
    req('Nhân sự của công ty mình', { path: '/api/get-all-user-by-companyId?companyId={{employerCompanyId}}&limit=5&offset=0', token: 'employer', test: ok(() => {
        pm.test('Mọi người thuộc công ty A', () => pm.response.json().data.forEach((u) => pm.expect(u.companyId).to.eql(Number(pm.environment.get('employerCompanyId')))));
    }) }),
    req('Admin: tất cả công ty', { path: '/api/get-all-company?limit=5&offset=0', token: 'admin', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số, có trạng thái duyệt', () => {
            pm.expect(body.count).to.be.at.least(body.data.length);
            body.data.forEach((c) => pm.expect(c.censorCode).to.be.a('string'));
        });
    }) }),
    req('Admin: lọc công ty đã duyệt', { path: '/api/get-all-company?limit=10&offset=0&censorCode=CS1', token: 'admin', test: ok(() => {
        pm.test('Mọi công ty CS1', () => pm.response.json().data.forEach((c) => pm.expect(c.censorCode).to.eql('CS1')));
    }) }),
    adminOnly('Nhà tuyển dụng xem danh sách admin -> 403', 'GET', '/api/get-all-company?limit=5&offset=0'),
    req('Ứng viên sửa công ty -> 403', { method: 'PUT', path: '/api/update-company', token: 'candidate', body: { name: 'Sửa trái phép' }, test: legacyForbidden() }),
    req('Ứng viên tạo công ty -> 403', { method: 'POST', path: '/api/create-new-company', token: 'candidate', body: { name: 'Công ty trái phép' }, test: legacyForbidden() }),
    req('Chủ công ty đã có công ty tạo thêm -> 403', { method: 'POST', path: '/api/create-new-company', token: 'employer', body: { name: 'Công ty thứ hai' }, test: legacyForbidden() }),
    req('Ứng viên rời công ty -> 403', { method: 'PUT', path: '/api/quit-company', token: 'candidate', body: {}, test: legacyForbidden() }),
    req('Ứng viên thêm nhân sự vào công ty -> 403', { method: 'PUT', path: '/api/add-user-company', token: 'candidate', body: { phonenumber: '0900000000' }, test: legacyForbidden() }),
    adminOnly('Nhà tuyển dụng khoá công ty -> 403', 'PUT', '/api/ban-company', { id: 1 }),
    adminOnly('Nhà tuyển dụng duyệt công ty -> 403', 'PUT', '/api/accecpt-company', { id: 1 })
]);

const posts = folder('Tin tuyển dụng (API trang người dùng)', lines(
    'Các API tin tuyển dụng mà trang web dùng trực tiếp: lọc/tìm việc, chi tiết, việc tương tự, gợi ý cho ứng viên,',
    'không gian quản lý của nhà tuyển dụng, ghi chú kiểm duyệt, thống kê và danh sách của admin. Chỉ đọc + phân quyền.'
), [
    req('Lọc việc làm công khai', {
        path: '/api/get-filter-post?limit=5&offset=0&categoryJobCode=&addressCode=&salaryJobCode=&categoryJoblevelCode=&categoryWorktypeCode=&experienceJobCode=&sortName=&search=',
        test: ok(() => {
            const body = pm.response.json();
            pm.test('Tối đa 5 tin, có tổng số', () => {
                pm.expect(body.data.length).to.be.at.most(5);
                pm.expect(body.count).to.be.at.least(body.data.length);
            });
            pm.test('Chỉ tin đã duyệt và còn hạn', () => body.data.forEach((p) => {
                pm.expect(p.statusCode).to.eql('PS1');
                pm.expect(Number(p.timeEnd)).to.be.above(Date.now() - 60000);
            }));
        })
    }),
    req('Lọc việc làm theo ngành', {
        path: '/api/get-filter-post?limit=10&offset=0&categoryJobCode=cong-nghe-thong-tin&addressCode=&salaryJobCode=&categoryJoblevelCode=&categoryWorktypeCode=&experienceJobCode=&sortName=&search=',
        test: ok(() => pm.test('Mọi tin thuộc ngành CNTT', () => pm.response.json().data.forEach((p) => pm.expect(p.postDetailData.jobTypePostData.code).to.eql('cong-nghe-thong-tin'))))
    }),
    req('Tìm việc làm theo từ khoá', {
        path: '/api/get-filter-post?limit=10&offset=0&categoryJobCode=&addressCode=&salaryJobCode=&categoryJoblevelCode=&categoryWorktypeCode=&experienceJobCode=&sortName=&search=Developer',
        test: ok(() => {
            const rows = pm.response.json().data;
            pm.test('Có kết quả chứa "Developer"', () => {
                pm.expect(rows.length).to.be.above(0);
                rows.forEach((p) => pm.expect(p.postDetailData.name.toLowerCase()).to.include('developer'));
            });
        })
    }),
    req('Chỉ tin nổi bật', {
        path: '/api/get-filter-post?limit=10&offset=0&categoryJobCode=&addressCode=&salaryJobCode=&categoryJoblevelCode=&categoryWorktypeCode=&experienceJobCode=&sortName=&isHot=1&search=',
        test: ok(() => pm.test('Mọi tin isHot = 1', () => pm.response.json().data.forEach((p) => pm.expect(Number(p.isHot)).to.eql(1))))
    }),
    req('Chi tiết tin tuyển dụng', { path: '/api/get-detail-post-by-id?id={{testOfferJobId}}', test: ok(() => {
        const post = pm.response.json().data;
        pm.test('Đúng tin, đang hiển thị, có nội dung', () => {
            pm.expect(post.id).to.eql(Number(pm.environment.get('testOfferJobId')));
            pm.expect(post.statusCode).to.eql('PS1');
            pm.expect(post.postDetailData.name).to.be.a('string').and.not.empty;
        });
    }) }),
    req('Việc làm tương tự', { path: '/api/get-related-post?postId={{testOfferJobId}}&limit=4', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Tối đa 4 tin, không chứa tin đang xem', () => {
            pm.expect(rows.length).to.be.at.most(4);
            pm.expect(rows.map((p) => p.id)).to.not.include(Number(pm.environment.get('testOfferJobId')));
        });
    }) }),
    req('Gợi ý việc làm cho ứng viên', { path: '/api/get-recommended-post?userId=&limit=5', token: 'candidate', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Mỗi tin có điểm phù hợp', () => rows.forEach((p) => pm.expect(p.matchScore).to.be.a('number')));
    }) }),
    req('Nhà tuyển dụng xem gợi ý việc làm -> 403', { path: '/api/get-recommended-post?userId=&limit=5', token: 'employer', test: legacyForbidden() }),
    req('Tin của công ty mình (quản lý)', {
        path: '/api/get-list-post-admin?companyId={{employerCompanyId}}&limit=5&offset=0&search=&censorCode=', token: 'employer',
        test: ok(() => {
            const body = pm.response.json();
            pm.test('Có tổng số, mỗi tin có editRevision', () => {
                pm.expect(body.count).to.be.at.least(body.data.length);
                body.data.forEach((p) => pm.expect(p.editRevision).to.match(/^jv1-[a-f0-9]{64}$/));
            });
        })
    }),
    req('Ứng viên vào trang quản lý tin -> 403', {
        path: '/api/get-list-post-admin?companyId={{employerCompanyId}}&limit=5&offset=0&search=&censorCode=', token: 'candidate', test: legacyForbidden()
    }),
    req('Ghi chú kiểm duyệt của tin', { path: '/api/get-note-by-post?limit=5&offset=0&id={{jobId}}', token: 'employer', test: ok(() => {
        pm.test('Mọi ghi chú thuộc đúng tin', () => pm.response.json().data.forEach((n) => pm.expect(n.postId).to.eql(Number(pm.environment.get('jobId')))));
    }) }),
    req('Thống kê tin theo ngành', { path: '/api/get-statistical-post?limit=5', token: 'employer', test: ok(() => {
        pm.test('Có tổng số tin', () => pm.expect(pm.response.json().totalPost).to.be.a('number'));
    }) }),
    req('Admin: tất cả tin tuyển dụng', { path: '/api/get-all-post-admin?limit=5&offset=0', token: 'admin', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số, có trạng thái', () => {
            pm.expect(body.count).to.be.at.least(body.data.length);
            body.data.forEach((p) => pm.expect(p.statusCode).to.match(/^PS[1-4]$/));
        });
    }) }),
    req('Admin: lọc tin chờ duyệt', { path: '/api/get-all-post-admin?limit=10&offset=0&censorCode=PS3', token: 'admin', test: ok(() => {
        pm.test('Mọi tin PS3', () => pm.response.json().data.forEach((p) => pm.expect(p.statusCode).to.eql('PS3')));
    }) }),
    adminOnly('Nhà tuyển dụng xem danh sách tin của admin -> 403', 'GET', '/api/get-all-post-admin?limit=5&offset=0'),
    adminOnly('Nhà tuyển dụng duyệt tin -> 403', 'PUT', '/api/accept-post', { id: 22 }),
    adminOnly('Nhà tuyển dụng khoá tin -> 403', 'PUT', '/api/ban-post', { postId: 22, note: 'x' }),
    adminOnly('Nhà tuyển dụng mở lại tin -> 403', 'PUT', '/api/active-post', { id: 22 }),
    req('Ứng viên đăng tin -> 403', { method: 'POST', path: '/api/create-new-post', token: 'candidate', body: { name: 'Không được đăng' }, test: legacyForbidden() })
]);

const cvApply = JSON.stringify({ postId: '__POST__', file: CV_PDF_DATA_URL, description: 'Hồ sơ kiểm thử Postman (không phải ứng tuyển thật).' }, null, 2);
const applyBody = (postVar) => cvApply.replace('"__POST__"', `{{${postVar}}}`);

const cvs = folder('Ứng tuyển và tìm ứng viên (CV đã nộp)', lines(
    'Nộp CV vào tin (POST /api/create-new-cv) chỉ thử các trường hợp bị từ chối trước khi ghi: thiếu dữ liệu, sai vai trò,',
    'tin không tồn tại, tin hết hạn, nộp trùng. CV đã nộp, % khớp kỹ năng, chi tiết CV, thống kê, tìm ứng viên',
    'và mở hồ sơ ứng viên ĐÃ mở trước đó (không trừ lượt xem). Hồ sơ của ứng viên kiểm thử được lưu cho thư mục email.'
), [
    req('Ứng viên kiểm thử: lịch sử ứng tuyển', { path: '/api/my-applications', token: 'testCandidate', test: ok(() => {
        const rows = pm.response.json().data;
        const offer = rows.find((a) => a.job_id === Number(pm.environment.get('testOfferJobId')));
        const reject = rows.find((a) => a.job_id === Number(pm.environment.get('testRejectJobId')));
        pm.test('Có hồ sơ ở 2 tin dùng cho kiểm thử email', () => {
            pm.expect(offer, 'chưa có hồ sơ ở testOfferJobId').to.not.be.undefined;
            pm.expect(reject, 'chưa có hồ sơ ở testRejectJobId').to.not.be.undefined;
        });
        if (offer) { pm.environment.set('e2eOfferAppId', offer.id); pm.environment.set('e2eOfferCvId', offer.legacy_cv_id); }
        if (reject) { pm.environment.set('e2eRejectAppId', reject.id); pm.environment.set('e2eRejectCvId', reject.legacy_cv_id); }
    }) }),
    req('Nộp CV thiếu file và lời giới thiệu -> 400', {
        method: 'POST', path: '/api/create-new-cv', token: 'candidate', body: '{\n  "postId": {{testOfferJobId}}\n}',
        test: legacyError(1, 'Cần CV và lời giới thiệu', 400)
    }),
    req('Nhà tuyển dụng nộp CV -> 403', { method: 'POST', path: '/api/create-new-cv', token: 'employer', body: applyBody('testOfferJobId'), test: legacyForbidden() }),
    req('Nộp CV vào tin không tồn tại -> 404', {
        method: 'POST', path: '/api/create-new-cv', token: 'testCandidate', body: cvApply.replace('"__POST__"', '999999999'),
        test: legacyError(3, 'Không tìm thấy tin tuyển dụng', 404)
    }),
    req('Nộp CV vào tin đã hết hạn -> 409', {
        method: 'POST', path: '/api/create-new-cv', token: 'testCandidate', body: applyBody('jobId'),
        description: 'jobId (tin #22) hết hạn từ 2022: bị từ chối trước khi lưu CV.',
        test: legacyError(4, 'Tin tuyển dụng đã hết hạn ứng tuyển', 409)
    }),
    req('Nộp lại tin đã ứng tuyển -> 409 kèm cvId cũ', {
        method: 'POST', path: '/api/create-new-cv', token: 'testCandidate', body: applyBody('testOfferJobId'),
        pre: skipUnless('e2eOfferCvId', 'ứng viên kiểm thử chưa ứng tuyển testOfferJobId; không tự tạo hồ sơ mới.'),
        test: [...legacyError(5, 'Bạn đã ứng tuyển tin này', 409), ...script(() => {
            pm.test('Trả về đúng CV đã nộp trước đó', () => pm.expect(pm.response.json().cvId).to.eql(Number(pm.environment.get('e2eOfferCvId'))));
        })]
    }),
    req('Ứng viên: lịch sử CV đã nộp', { path: '/api/get-all-cv-by-userId?limit=5&offset=0&userId={{candidateUserId}}', token: 'candidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('Mọi CV thuộc ứng viên đang đăng nhập, có thông tin tin', () => body.data.forEach((cv) => {
            pm.expect(cv.userId).to.eql(Number(pm.environment.get('candidateUserId')));
            pm.expect(cv).to.have.property('postCvData');
        }));
    }) }),
    req('CV nộp vào tin của công ty (kèm % khớp)', { path: '/api/get-all-list-cv-by-post?limit=5&offset=0&postId={{jobId}}', token: 'employer', test: ok(() => {
        const rows = pm.response.json().data;
        pm.test('Mỗi CV có % khớp kỹ năng thay cho file PDF', () => rows.forEach((cv) => pm.expect(cv.file).to.match(/^\d+%$/)));
        pm.test('Không lộ mật khẩu ứng viên', () => pm.expect(JSON.stringify(rows)).to.not.include('"password"'));
    }) }),
    req('CV vào tin của công ty khác -> 403', {
        path: '/api/get-all-list-cv-by-post?limit=5&offset=0&postId={{testOfferJobId}}', token: 'employer',
        test: legacyError(3, 'Bạn không có quyền xem hồ sơ ứng tuyển của tin này', 403)
    }),
    req('Chi tiết CV (nhà tuyển dụng)', { path: '/api/get-detail-cv-by-id?cvId={{employerCvId}}&roleCode=COMPANY', token: 'employer', test: ok(() => {
        const cv = pm.response.json().data;
        pm.test('Có file PDF dạng data URL', () => pm.expect(cv.file).to.match(/^data:application\/pdf;base64,/));
        pm.test('Có thông tin ứng viên, không lộ mật khẩu', () => {
            pm.expect(cv.userCvData).to.be.an('object');
            pm.expect(JSON.stringify(cv)).to.not.include('"password"');
        });
    }) }),
    req('Chi tiết CV của công ty khác -> 403', {
        path: '/api/get-detail-cv-by-id?cvId={{e2eOfferCvId}}&roleCode=COMPANY', token: 'employer', test: legacyError(3, 'Bạn không có quyền xem hồ sơ này', 403)
    }),
    req('Thống kê CV theo thời gian', {
        path: '/api/get-statistical-cv?limit=5&offset=0&fromDate=2026-01-01&toDate=2026-12-31&companyId={{employerCompanyId}}', token: 'employer', test: ok()
    }),
    req('Thống kê CV thiếu khoảng ngày -> errCode 1', {
        path: '/api/get-statistical-cv?limit=5&offset=0&fromDate=&toDate=&companyId={{employerCompanyId}}', token: 'employer',
        test: legacyError(1, 'Missing required parameters')
    }),
    req('Tìm ứng viên (lọc hồ sơ)', { path: '/api/fillter-cv-by-selection?limit=5&offset=0', token: 'employer', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số và số lượt xem còn lại', () => {
            pm.expect(body.count).to.be.at.least(body.data.length);
            pm.expect(body.allowance).to.have.all.keys('free', 'paid');
        });
    }) }),
    req('Tìm ứng viên theo ngành', { path: '/api/fillter-cv-by-selection?limit=10&offset=0&categoryJobCode=cong-nghe-thong-tin', token: 'employer', test: ok(() => {
        pm.test('Mọi hồ sơ thuộc ngành CNTT', () => pm.response.json().data.forEach((c) => pm.expect(c.jobTypeSettingData.code).to.eql('cong-nghe-thong-tin')));
    }) }),
    req('Tin dùng để đối chiếu ứng viên', { path: '/api/candidate-search-jobs?limit=20&offset=0', token: 'employer', test: ok(() => {
        pm.test('Mỗi tin có id, tên, tiêu chí', () => pm.response.json().data.forEach((j) => pm.expect(j).to.include.all.keys('id', 'name', 'criteria')));
    }) }),
    req('Mở hồ sơ ứng viên đã mở trước đó (không trừ lượt)', { path: '/api/check-see-candiate?candidateId={{viewedCandidateId}}', token: 'employer', test: ok(() => {
        const body = pm.response.json();
        pm.test('Đã có quyền từ trước, không trừ lượt', () => {
            pm.expect(body.alreadyGranted).to.be.true;
            pm.expect(body.chargedAllowance).to.eql(null);
        });
    }) }),
    req('Mở hồ sơ thiếu candidateId -> errCode 1', { path: '/api/check-see-candiate', token: 'employer', test: legacyError(1, 'Missing required parameters') }),
    req('Ứng viên tìm ứng viên -> 403', { path: '/api/fillter-cv-by-selection?limit=5&offset=0', token: 'candidate', test: legacyForbidden() })
]);

const packages = folder('Gói dịch vụ và thanh toán', lines(
    'Bảng giá gói đăng tin/gói xem CV, lịch sử mua, thống kê doanh thu (admin) và các nhánh từ chối của thanh toán',
    'PayPal (số lượng sai, giao dịch giả mạo). Không request nào gọi PayPal hay cộng lượt.'
), [
    req('Gói đăng tin thường', { path: '/api/get-package-by-type?isHot=0', token: 'employer', test: ok(() => {
        pm.test('Mọi gói là gói thường, có giá', () => pm.response.json().data.forEach((p) => {
            pm.expect(Number(p.isHot)).to.eql(0);
            pm.expect(Number(p.price)).to.be.above(0);
        }));
    }) }),
    req('Gói đăng tin nổi bật', { path: '/api/get-package-by-type?isHot=1', token: 'employer', test: ok(() => {
        pm.test('Mọi gói là gói nổi bật', () => pm.response.json().data.forEach((p) => pm.expect(Number(p.isHot)).to.eql(1)));
    }) }),
    req('Chi tiết gói đăng tin', { path: '/api/get-package-by-id?id=1', token: 'employer', test: ok(() => {
        const pkg = pm.response.json().data;
        pm.test('Có tên, số lượt, giá', () => {
            pm.expect(pkg.id).to.eql(1);
            pm.expect(Number(pkg.value)).to.be.above(0);
            pm.expect(Number(pkg.price)).to.be.above(0);
        });
    }) }),
    req('Tất cả gói đăng tin (phân trang)', { path: '/api/get-all-package?limit=5&offset=0&search=', token: 'employer', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số', () => pm.expect(body.count).to.be.at.least(body.data.length));
    }) }),
    req('Chi tiết gói xem CV', { path: '/api/get-package-cv-by-id?id=1', token: 'employer', test: ok(() => {
        pm.test('Có số lượt xem và giá', () => pm.expect(Number(pm.response.json().data.value)).to.be.above(0));
    }) }),
    req('Tất cả gói xem CV', { path: '/api/get-all-package-cv?limit=5&offset=0&search=', token: 'employer', test: ok() }),
    req('Gói xem CV để chọn mua', { path: '/api/get-all-package-cv-select', token: 'employer', test: ok(() => {
        pm.test('Có danh sách gói', () => pm.expect(pm.response.json().data).to.be.an('array'));
    }) }),
    req('Lịch sử mua gói đăng tin của công ty', {
        path: '/api/get-history-trade-post?limit=5&offset=0&fromDate=&toDate=&companyId={{employerCompanyId}}', token: 'employer',
        test: ok(() => pm.test('Mỗi đơn có giá và số lượng', () => pm.response.json().data.forEach((o) => {
            pm.expect(Number(o.currentPrice)).to.be.above(0);
            pm.expect(Number(o.amount)).to.be.above(0);
        })))
    }),
    req('Lịch sử mua gói xem CV của công ty', {
        path: '/api/get-history-trade-cv?limit=5&offset=0&fromDate=&toDate=&companyId={{employerCompanyId}}', token: 'employer', test: ok()
    }),
    req('Admin: thống kê doanh thu gói đăng tin', {
        path: '/api/get-statistical-package?limit=5&offset=0&fromDate=2026-01-01&toDate=2026-12-31', token: 'admin', test: ok()
    }),
    req('Admin: thống kê doanh thu gói xem CV', {
        path: '/api/get-statistical-package-cv?limit=5&offset=0&fromDate=2026-01-01&toDate=2026-12-31', token: 'admin', test: ok()
    }),
    req('Admin: doanh thu gói đăng tin theo tháng', { path: '/api/get-sum-by-year-post?year=2026', token: 'admin', test: ok(() => {
        pm.test('Mỗi dòng có tháng 1-12 và tổng tiền', () => pm.response.json().data.forEach((m) => {
            pm.expect(m.month).to.be.within(1, 12);
            pm.expect(Number(m.total)).to.be.at.least(0);
        }));
    }) }),
    req('Admin: doanh thu gói xem CV theo tháng', { path: '/api/get-sum-by-year-cv?year=2026', token: 'admin', test: ok() }),
    req('Tạo link thanh toán với số lượng 0 -> errCode 1 (không gọi PayPal)', {
        path: '/api/get-payment-link?id=1&amount=0', token: 'employer', test: legacyError(1, 'Missing required parameters')
    }),
    req('Tạo link thanh toán với số lượng quá lớn -> errCode 1', {
        path: '/api/get-payment-link?id=1&amount=100000', token: 'employer', test: legacyError(1, 'Missing required parameters')
    }),
    req('Xác nhận thanh toán giả mạo -> errCode 2', {
        method: 'POST', path: '/api/payment-success', token: 'employer',
        body: { PayerID: 'POSTMAN', paymentId: 'PAYID-POSTMAN-GIA', token: 'EC-POSTMAN-GIA' }, test: legacyError(2, 'Giao dịch không tồn tại')
    }),
    req('Xác nhận thanh toán gói CV giả mạo -> errCode 2', {
        method: 'POST', path: '/api/payment-cv-success', token: 'employer',
        body: { PayerID: 'POSTMAN', paymentId: 'PAYID-POSTMAN-GIA', token: 'EC-POSTMAN-GIA' }, test: legacyError(2, 'Giao dịch không tồn tại')
    }),
    req('Ứng viên mua gói -> 403', { path: '/api/get-payment-link?id=1&amount=1', token: 'candidate', test: legacyForbidden() }),
    req('Ứng viên xem bảng giá -> 403', { path: '/api/get-all-package?limit=5&offset=0&search=', token: 'candidate', test: legacyForbidden() }),
    adminOnly('Nhà tuyển dụng tạo gói -> 403', 'POST', '/api/create-package-post', { name: 'x', value: 1, price: 1, isHot: 0 }),
    adminOnly('Nhà tuyển dụng bật/tắt gói -> 403', 'PUT', '/api/set-active-package-post', { id: 1, isActive: 0 }),
    adminOnly('Nhà tuyển dụng xem doanh thu toàn hệ thống -> 403', 'GET', '/api/get-sum-by-year-post?year=2026'),
    req('Admin bật/tắt gói thiếu tham số -> errCode 1', {
        method: 'PUT', path: '/api/set-active-package-post', token: 'admin', body: {}, test: legacyError(1, 'Missing required parameters')
    })
]);

const social = folder('Tương tác của ứng viên: lưu tin, theo dõi công ty, đánh giá công ty', lines(
    'Trên tài khoản Postman: lưu/bỏ lưu tin, theo dõi/bỏ theo dõi công ty B (số người theo dõi tăng rồi giảm đúng 1),',
    'gửi/sửa/xoá đánh giá công ty. Mọi thay đổi được đưa về trạng thái ban đầu trong cùng thư mục.'
), [
    req('Lưu tin: trạng thái ban đầu', { path: '/api/check-favorite-post?userId=&postId={{testOfferJobId}}', token: 'pm', test: ok(() => {
        pm.environment.set('favInitial', String(pm.response.json().isFavorite));
    }) }),
    req('Lưu tin', { method: 'POST', path: '/api/toggle-favorite-post', token: 'pm', body: '{\n  "postId": {{testOfferJobId}}\n}', test: ok(() => {
        pm.test('Trạng thái đảo ngược', () => pm.expect(String(pm.response.json().isFavorite)).to.not.eql(pm.environment.get('favInitial')));
    }) }),
    req('Danh sách tin đã lưu', { path: '/api/get-favorite-post-by-user?userId=&limit=20&offset=0', token: 'pm', test: ok(() => {
        const ids = pm.response.json().data.map((f) => f.postId || (f.postData && f.postData.id) || f.id);
        const saved = pm.environment.get('favInitial') !== 'true';
        pm.test(saved ? 'Có tin vừa lưu' : 'Không còn tin vừa bỏ lưu', () => {
            if (saved) pm.expect(ids).to.include(Number(pm.environment.get('testOfferJobId')));
            else pm.expect(ids).to.not.include(Number(pm.environment.get('testOfferJobId')));
        });
    }) }),
    req('Bỏ lưu tin (về trạng thái ban đầu)', { method: 'POST', path: '/api/toggle-favorite-post', token: 'pm', body: '{\n  "postId": {{testOfferJobId}}\n}', test: ok(() => {
        pm.test('Về trạng thái ban đầu', () => pm.expect(String(pm.response.json().isFavorite)).to.eql(pm.environment.get('favInitial')));
    }) }),
    req('Lưu tin không tồn tại -> errCode 2', {
        method: 'POST', path: '/api/toggle-favorite-post', token: 'pm', body: { postId: 999999999 }, test: legacyError(2, 'Không tìm thấy tin tuyển dụng')
    }),
    req('Lưu tin thiếu postId -> errCode 1', { method: 'POST', path: '/api/toggle-favorite-post', token: 'pm', body: {}, test: legacyError(1, 'Missing required parameters') }),
    req('Nhà tuyển dụng lưu tin -> 403', { method: 'POST', path: '/api/toggle-favorite-post', token: 'employer', body: '{\n  "postId": {{testOfferJobId}}\n}', test: legacyForbidden() }),
    req('Theo dõi công ty: trạng thái ban đầu', { path: '/api/check-follow-company?companyId={{employer2CompanyId}}&userId=', token: 'pm', test: ok(() => {
        const body = pm.response.json();
        pm.environment.set('followInitial', String(body.isFollow));
        pm.environment.set('followerCountInitial', body.countFollower);
    }) }),
    req('Theo dõi công ty', { method: 'POST', path: '/api/toggle-follow-company', token: 'pm', body: '{\n  "companyId": {{employer2CompanyId}}\n}', test: ok() }),
    req('Số người theo dõi thay đổi đúng 1', { path: '/api/check-follow-company?companyId={{employer2CompanyId}}&userId=', token: 'pm', test: ok(() => {
        const body = pm.response.json();
        const following = pm.environment.get('followInitial') !== 'true';
        pm.test('Trạng thái đảo ngược', () => pm.expect(body.isFollow).to.eql(following));
        pm.test('countFollower ' + (following ? '+1' : '-1'), () => {
            pm.expect(body.countFollower).to.eql(Number(pm.environment.get('followerCountInitial')) + (following ? 1 : -1));
        });
    }) }),
    req('Danh sách công ty đang theo dõi', { path: '/api/get-followed-company-by-user?userId=&limit=20&offset=0', token: 'pm', test: ok(() => {
        const ids = pm.response.json().data.map((f) => f.companyId || (f.companyData && f.companyData.id) || f.id);
        if (pm.environment.get('followInitial') !== 'true') {
            pm.test('Có công ty B', () => pm.expect(ids).to.include(Number(pm.environment.get('employer2CompanyId'))));
        }
    }) }),
    req('Bỏ theo dõi (về trạng thái ban đầu)', { method: 'POST', path: '/api/toggle-follow-company', token: 'pm', body: '{\n  "companyId": {{employer2CompanyId}}\n}', test: ok() }),
    req('Số người theo dõi trở lại như cũ', { path: '/api/check-follow-company?companyId={{employer2CompanyId}}&userId=', token: 'pm', test: ok(() => {
        const body = pm.response.json();
        pm.test('Như ban đầu', () => {
            pm.expect(String(body.isFollow)).to.eql(pm.environment.get('followInitial'));
            pm.expect(body.countFollower).to.eql(Number(pm.environment.get('followerCountInitial')));
        });
    }) }),
    req('Theo dõi công ty không tồn tại -> errCode 2', {
        method: 'POST', path: '/api/toggle-follow-company', token: 'pm', body: { companyId: 999999999 }, test: legacyError(2, 'Không tìm thấy công ty')
    }),
    req('Đánh giá sao ngoài 1-5 -> errCode 2', {
        method: 'POST', path: '/api/create-company-review', token: 'pm', body: '{\n  "companyId": {{employer2CompanyId}},\n  "star": 6\n}',
        test: legacyError(2, 'Số sao đánh giá phải từ 1 đến 5')
    }),
    req('Gửi đánh giá công ty', {
        method: 'POST', path: '/api/create-company-review', token: 'pm',
        body: '{\n  "companyId": {{employer2CompanyId}},\n  "star": 4,\n  "content": "[Postman] Đánh giá kiểm thử, sẽ bị xoá ngay."\n}',
        test: ok(() => pm.test('Gửi hoặc cập nhật thành công', () => pm.expect(pm.response.json().errMessage).to.match(/Gửi đánh giá thành công|Cập nhật đánh giá thành công/)))
    }),
    req('Đánh giá mới xuất hiện trong danh sách', { path: '/api/get-review-by-company?companyId={{employer2CompanyId}}&limit=100&offset=0', test: ok(() => {
        const review = pm.response.json().data.find((r) => r.userId === Number(pm.environment.get('pmUserId')));
        pm.test('Có đánh giá 4 sao của tài khoản Postman', () => {
            pm.expect(review).to.not.be.undefined;
            pm.expect(review.star).to.eql(4);
        });
        if (review) pm.environment.set('pmReviewId', review.id);
    }) }),
    req('Gửi lại = sửa đánh giá (mỗi người 1 đánh giá/công ty)', {
        method: 'POST', path: '/api/create-company-review', token: 'pm', body: '{\n  "companyId": {{employer2CompanyId}},\n  "star": 5\n}',
        test: legacyError(0, 'Cập nhật đánh giá thành công')
    }),
    req('Người khác xoá đánh giá -> errCode 3', {
        method: 'POST', path: '/api/delete-company-review', token: 'candidate', body: '{\n  "id": {{pmReviewId}}\n}',
        test: legacyError(3, 'Bạn không có quyền xóa đánh giá này')
    }),
    req('Xoá đánh giá của mình', { method: 'POST', path: '/api/delete-company-review', token: 'pm', body: '{\n  "id": {{pmReviewId}}\n}', test: ok() }),
    req('Xoá lại đánh giá đã xoá -> errCode 2', {
        method: 'POST', path: '/api/delete-company-review', token: 'pm', body: '{\n  "id": {{pmReviewId}}\n}', test: legacyError(2, 'Không tìm thấy đánh giá')
    }),
    req('Nhà tuyển dụng đánh giá công ty -> 403', {
        method: 'POST', path: '/api/create-company-review', token: 'employer', body: '{\n  "companyId": {{employer2CompanyId}},\n  "star": 5\n}', test: legacyForbidden()
    })
]);

const pushGuard = skipUnless('pushEnabled', 'Web Push chưa được cấu hình (VAPID) trên backend.');
const notifications = folder('Thông báo, nhắn tin và Web Push', lines(
    'Thông báo trong ứng dụng, việc làm từ công ty theo dõi/gợi ý, hội thoại chat và các trường hợp bị từ chối khi gửi',
    'tin nhắn (không tạo tin nhắn nào), đăng ký/huỷ thiết bị nhận Web Push (thiết bị giả, xoá ngay).'
), [
    req('Thông báo của tôi', { path: '/api/get-notification-by-user?userId=&limit=5&offset=0', token: 'testCandidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng số và số chưa đọc hợp lệ', () => {
            pm.expect(body.count).to.be.at.least(body.data.length);
            pm.expect(body.unreadCount).to.be.within(0, body.count);
        });
        pm.test('Chỉ thông báo của chính mình', () => body.data.forEach((n) => pm.expect(n.userId).to.eql(Number(pm.environment.get('testCandidateUserId')))));
    }) }),
    req('Việc làm từ công ty đang theo dõi', { path: '/api/get-notification-jobs?source=followed&limit=5&offset=0', token: 'candidate', test: ok(() => {
        pm.test('source = followed', () => pm.expect(pm.response.json().source).to.eql('followed'));
    }) }),
    req('Việc làm gợi ý', { path: '/api/get-notification-jobs?source=recommended&limit=5&offset=0', token: 'candidate', test: ok(() => {
        pm.test('source = recommended', () => pm.expect(pm.response.json().source).to.eql('recommended'));
    }) }),
    req('Nguồn việc làm không hợp lệ -> 400', {
        path: '/api/get-notification-jobs?source=hack&limit=5&offset=0', token: 'candidate', test: legacyError(1, 'Nguồn việc làm hoặc phân trang', 400)
    }),
    req('Danh sách hội thoại chat', { path: '/api/get-list-chat-conversation', token: 'candidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('Có tổng tin chưa đọc, mỗi hội thoại có đối tác', () => {
            pm.expect(body.totalUnread).to.be.at.least(0);
            body.data.forEach((c) => pm.expect(c).to.include.keys('partnerId', 'partnerData'));
        });
    }) }),
    req('Hội thoại với nhà tuyển dụng', { path: '/api/get-chat-conversation?partnerId={{employerUserId}}', token: 'candidate', test: ok(() => {
        const body = pm.response.json();
        pm.test('Đúng đối tác, có phân trang', () => {
            pm.expect(body.partnerData.id).to.eql(Number(pm.environment.get('employerUserId')));
            pm.expect(body.pageInfo).to.include.keys('hasMore');
        });
    }) }),
    req('Việc làm chia sẻ được trong chat', { path: '/api/chat-jobs?partnerId={{candidateUserId}}&search=&limit=5&offset=0', token: 'employer', test: ok(() => {
        pm.test('Mỗi tin có tên và công ty', () => pm.response.json().data.forEach((j) => pm.expect(j).to.include.keys('id', 'name', 'companyName')));
    }) }),
    req('Gửi tin nhắn sai định dạng -> 400', {
        method: 'POST', path: '/api/send-chat-message', token: 'candidate', body: '{\n  "v": 1,\n  "receiverId": {{employerUserId}},\n  "content": "thiếu clientMessageId"\n}',
        test: expectStatus(400, () => pm.test('code = PAYLOAD_INVALID', () => pm.expect(pm.response.json().code).to.eql('PAYLOAD_INVALID')))
    }),
    req('Nhắn tin giữa hai ứng viên -> 403 (không tạo tin nhắn)', {
        method: 'POST', path: '/api/send-chat-message', token: 'pm',
        body: '{\n  "v": 1,\n  "receiverId": {{candidateUserId}},\n  "content": "[Postman] không được gửi",\n  "clientMessageId": "postman-not-allowed-0001"\n}',
        test: expectStatus(403, () => pm.test('code = CHAT_NOT_ALLOWED', () => pm.expect(pm.response.json().code).to.eql('CHAT_NOT_ALLOWED')))
    }),
    req('Tự nhắn cho chính mình -> bị từ chối', {
        method: 'POST', path: '/api/send-chat-message', token: 'pm',
        body: '{\n  "receiverId": {{pmUserId}},\n  "content": "[Postman] tự nhắn"\n}',
        test: expectStatus(200, () => {
            const body = pm.response.json();
            pm.test('errCode = 2, CHAT_NOT_ALLOWED', () => {
                pm.expect(body.errCode).to.eql(2);
                pm.expect(body.code).to.eql('CHAT_NOT_ALLOWED');
            });
        })
    }),
    req('Cấu hình Web Push', { path: '/api/push/config', token: 'pm', test: ok(() => {
        const config = pm.response.json().data;
        pm.test('Có cờ bật và khoá công khai VAPID', () => {
            pm.expect(config.enabled).to.be.a('boolean');
            if (config.enabled) pm.expect(config.publicKey).to.be.a('string').and.not.empty;
        });
        if (config.enabled) pm.environment.set('pushEnabled', 'true'); else pm.environment.unset('pushEnabled');
    }) }),
    req('Đăng ký thiết bị nhận push', {
        method: 'POST', path: '/api/push/subscription', token: 'pm', pre: pushGuard, body: PUSH_SUBSCRIPTION,
        test: ok(() => {
            const sub = pm.response.json().data;
            pm.test('Có id thiết bị và hạn dùng', () => {
                pm.expect(sub.id).to.match(/^[a-f0-9]{64}$/);
                pm.expect(Date.parse(sub.expiresAt)).to.be.above(Date.now());
            });
            pm.environment.set('pushSubscriptionId', sub.id);
        })
    }),
    req('Thiết bị đã được đăng ký', { path: '/api/push/config?id={{pushSubscriptionId}}', token: 'pm', pre: pushGuard, test: ok(() => {
        pm.test('subscribed = true', () => pm.expect(pm.response.json().data.subscribed).to.be.true);
    }) }),
    req('Đăng ký endpoint không phải dịch vụ push -> 400', {
        method: 'POST', path: '/api/push/subscription', token: 'pm', pre: pushGuard,
        body: { ...PUSH_SUBSCRIPTION, endpoint: 'https://evil.example/push' },
        test: expectStatus(400, () => pm.test('code = PAYLOAD_INVALID', () => pm.expect(pm.response.json().code).to.eql('PAYLOAD_INVALID')))
    }),
    req('Huỷ đăng ký thiết bị', {
        method: 'DELETE', path: '/api/push/subscription', token: 'pm', pre: pushGuard, body: '{\n  "id": "{{pushSubscriptionId}}"\n}', test: ok()
    }),
    req('Thiết bị không còn đăng ký', { path: '/api/push/config?id={{pushSubscriptionId}}', token: 'pm', pre: pushGuard, test: ok(() => {
        pm.test('subscribed = false', () => pm.expect(pm.response.json().data.subscribed).to.be.false);
    }) })
]);

export { catalog, companies, posts, cvs, packages, social, notifications, applyBody };
