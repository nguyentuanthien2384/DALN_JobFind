// End-to-end recruitment mail flow on the email-test candidate's two existing applications
// at company B: interview invitation, offer, hire, rejection. Part (a) only exercises
// rejected requests (nothing is queued); part (b) sends real mail and is opt-in.
import { script, req, folder, lines, expectError, contractError, ok, skipUnless } from '../lib.mjs';

// Fresh Vietnam-local dates for every request in the folder.
const datesPre = script(() => {
    const vnDate = (days) => new Date(Date.now() + days * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    pm.environment.set('e2eInterviewDate', vnDate(7));
    pm.environment.set('e2eConfirmBy', vnDate(5) + 'T17:00');
    pm.environment.set('e2eLateConfirmBy', vnDate(8) + 'T17:00');
    pm.environment.set('e2ePastDate', vnDate(-1));
    pm.environment.set('e2eStartDate', vnDate(21));
    pm.environment.set('e2eDeadline', vnDate(14) + 'T17:00');
    pm.environment.set('e2eLateDeadline', vnDate(25) + 'T17:00');
});

const interview = (overrides = {}) => JSON.stringify({
    message: '[KIỂM THỬ Postman] Thư mời phỏng vấn tự động, không phải lịch hẹn thật.',
    interview: {
        companyName: '[KIỂM THỬ] Sao Khuê Digital', interviewDate: '{{e2eInterviewDate}}', interviewTime: '09:30', durationMinutes: '45',
        timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'onsite', location: '[KIỂM THỬ] Tầng 2, Tòa nhà Demo 1, Đà Nẵng',
        round: 'Vòng 1 - Chuyên môn', interviewers: 'Nhân sự kiểm thử', preparation: 'Mang theo CV bản in.',
        contactName: '[KIỂM THỬ] HR Postman', contactEmail: '{{hrContactEmail}}', contactPhone: '0900000000', confirmBy: '{{e2eConfirmBy}}',
        ...overrides
    }
}, null, 2);
const offer = (overrides = {}) => JSON.stringify({
    decision: 'accepted',
    message: '[KIỂM THỬ Postman] Thư mời nhận việc tự động, không phải lời mời thật.',
    offer: {
        companyName: '[KIỂM THỬ] Sao Khuê Digital', startDate: '{{e2eStartDate}}', startTime: '08:30', timeZone: 'Asia/Ho_Chi_Minh',
        responseDeadline: '{{e2eDeadline}}', workMode: 'hybrid', location: '[KIỂM THỬ] Tầng 2, Tòa nhà Demo 1, Đà Nẵng',
        contactName: '[KIỂM THỬ] HR Postman', contactEmail: '{{hrContactEmail}}', contactPhone: '0900000000',
        workSchedule: 'Thứ Hai - Thứ Sáu, 08:30 - 17:30', salary: '[KIỂM THỬ] 20.000.000 VNĐ gross/tháng',
        probation: '[KIỂM THỬ] 2 tháng', benefits: 'BHXH theo quy định; 12 ngày phép/năm',
        requiredDocuments: 'Bản sao giấy tờ định danh', onboardingInstructions: 'Đây chỉ là kiểm thử, không phải lời mời thật.',
        ...overrides
    }
}, null, 2);
const appPath = (appVar, action) => `/api/applications/{{${appVar}}}/${action}`;

// Wait until the Notification Service has stored a NEW in-app notification of this type
// for the email-test candidate (Outbox -> RabbitMQ -> Notification -> MySQL).
const pollNotification = (typeCode) => script(() => {
    const deadline = Date.now() + 30000;
    const poll = () => pm.sendRequest({
        url: pm.environment.get('baseUrl') + '/api/get-notification-by-user?userId=&limit=10&offset=0',
        header: { Authorization: 'Bearer ' + pm.environment.get('testCandidateAccessToken') }
    }, (err, res) => {
        const rows = (!err && res.code === 200 && res.json().data) || [];
        const found = rows.some((n) => n.typeCode === '__TYPE__' && n.id > Number(pm.environment.get('e2eNotifMaxId') || 0));
        if (!found && Date.now() < deadline) setTimeout(poll, 1500);
    });
    poll();
}, { TYPE: typeCode });
const notificationArrived = (name, typeCode, contentPart) => req(name, {
    path: '/api/get-notification-by-user?userId=&limit=10&offset=0', token: 'testCandidate', pre: pollNotification(typeCode),
    test: ok(() => {
        const rows = pm.response.json().data;
        const fresh = rows.find((n) => n.typeCode === '__TYPE__' && n.id > Number(pm.environment.get('e2eNotifMaxId') || 0));
        pm.test('Có thông báo mới loại __TYPE__', () => pm.expect(fresh, 'chưa thấy thông báo mới').to.not.be.undefined);
        if (fresh) {
            pm.test('Nội dung đúng: "__PART__"', () => pm.expect(fresh.content).to.include('__PART__'));
            pm.test('Liên kết tới trang hồ sơ của ứng viên', () => pm.expect(fresh.link).to.match(/^\/candidate\//));
            pm.environment.set('e2eNotifMaxId', fresh.id);
        }
    }).map((l) => l.split('__TYPE__').join(typeCode).split('__PART__').join(contentPart))
});
const queued = (stage) => ok(() => {
    const body = pm.response.json();
    pm.test('Đã lưu yêu cầu gửi email (emailQueued)', () => pm.expect(body.emailQueued).to.be.true);
    pm.test('Giai đoạn hồ sơ = __STAGE__', () => pm.expect(body.data.stage).to.eql('__STAGE__'));
}).map((l) => l.split('__STAGE__').join(stage));

// ?dryRun=true: same checks as the real request plus the exact email, nothing saved or queued.
const dryPreview = (eventType, typeCode, subjectPart, toStage) => ok(() => {
    const body = pm.response.json();
    const preview = body.preview;
    pm.test('Chỉ kiểm tra: dryRun, chưa xếp email vào hàng đợi', () => {
        pm.expect(body.dryRun).to.be.true;
        pm.expect(body.emailQueued).to.be.false;
    });
    pm.test('Giai đoạn sau khi gửi thật: __STAGE__', () => pm.expect(preview.toStage).to.eql('__STAGE__'));
    pm.test('Sự kiện sẽ phát: __EVENT__', () => pm.expect(preview.eventType).to.eql('__EVENT__'));
    pm.test('Thông báo trong ứng dụng: __TYPE__', () => pm.expect(preview.inApp && preview.inApp.typeCode).to.eql('__TYPE__'));
    pm.test('Có bản xem trước email: tiêu đề, người nhận, nội dung', () => {
        pm.expect(preview.previewError, preview.previewError).to.be.undefined;
        pm.expect(preview.email.subject).to.include('__SUBJECT__');
        pm.expect(preview.email.willSend).to.be.a('boolean');
        if (!preview.email.demo && preview.email.to) pm.expect(preview.email.to).to.eql(String(preview.event.candidateEmail).toLowerCase());
        pm.expect(preview.email.html).to.match(/^<!doctype html>/i);
        pm.expect(preview.email.text).to.be.a('string').and.not.empty;
    });
}).map((l) => l.split('__EVENT__').join(eventType).split('__TYPE__').join(typeCode).split('__SUBJECT__').join(subjectPart).split('__STAGE__').join(toStage));

const dryRunChecks = [
    req('Kiểm tra trước thư mời phỏng vấn (dryRun): xem trước email, không ghi gì', {
        method: 'POST', path: appPath('e2eRejectAppId', 'interview-invitation') + '?dryRun=true', token: 'employer2', body: interview(),
        test: [...dryPreview('application.interview_invitation_requested', 'APPLICATION_INTERVIEW', 'Thư mời phỏng vấn', 'phong_van'), ...script(() => {
            const email = pm.response.json().preview.email;
            pm.test('Email có địa điểm và Reply-To tới HR', () => {
                pm.expect(email.text).to.include('Tòa nhà Demo 1');
                pm.expect(email.replyTo).to.eql(String(pm.environment.get('hrContactEmail')).toLowerCase());
            });
        })]
    }),
    req('Kiểm tra trước thư mời nhận việc (dryRun)', {
        method: 'POST', path: appPath('e2eRejectAppId', 'decision-notification') + '?dryRun=true', token: 'employer2', body: offer(),
        test: dryPreview('application.decision_email_requested', 'APPLICATION_ACCEPTED', 'Thư mời nhận việc', 'de_nghi')
    }),
    req('Kiểm tra trước email từ chối (dryRun)', {
        method: 'POST', path: appPath('e2eRejectAppId', 'decision-notification') + '?dryRun=true', token: 'employer2',
        body: { decision: 'rejected', message: '[KIỂM THỬ Postman] Chỉ kiểm tra, không gửi.' },
        test: [...dryPreview('application.decision_email_requested', 'APPLICATION_REJECTED', '', 'tu_choi'), ...script(() => {
            pm.test('Biết ứng viên đã phỏng vấn hay chưa (để chọn lời cảm ơn)', () => pm.expect(pm.response.json().preview.event.interviewed).to.be.a('boolean'));
        })]
    }),
    req('Kiểm tra trước chuyển về Mới ứng tuyển (dryRun): bước này không gửi gì', {
        method: 'PATCH', path: appPath('e2eRejectAppId', 'stage') + '?dryRun=true', token: 'employer2', body: { stage: 'moi_ung_tuyen' },
        test: ok(() => {
            const preview = pm.response.json().preview;
            pm.test('Không có thông báo và email cho bước này', () => {
                pm.expect(preview.eventType).to.eql('application.stage_changed');
                pm.expect(preview.inApp).to.eql(null);
                pm.expect(preview.email).to.eql(null);
            });
        })
    }),
    req('Sau các lần kiểm tra: hồ sơ không thay đổi', { path: '/api/applications/{{e2eRejectAppId}}', token: 'employer2', test: ok(() => {
        const app = pm.response.json().data;
        pm.test('Giai đoạn và lịch sử giữ nguyên', () => {
            pm.expect(app.stage).to.eql(pm.environment.get('e2eRejectStage'));
            pm.expect(app.timeline.length).to.eql(Number(pm.environment.get('e2eRejectTimeline')));
        });
    }) }),
    req('Kiểm tra trước khi ứng viên đã nhận việc -> 409 như làm thật', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation') + '?dryRun=true', token: 'employer2', body: interview(),
        pre: script(() => {
            if (pm.environment.get('e2eOfferStage') !== 'nhan_viec') {
                console.log('Bỏ qua "' + pm.info.requestName + '": hồ sơ 1 hiện không ở bước nhận việc.');
                pm.execution.skipRequest();
            }
        }),
        test: expectError(409, 'Ứng viên đã nhận việc', 4)
    })
];

const safeChecks = folder('a - Kiểm tra trước khi gửi (không gửi email)', lines(
    'Xác nhận hồ sơ thuộc ứng viên kiểm thử có email là hộp thư kiểm thử (testInboxEmail), rồi thử các thư mời/kết quả',
    'sai: lịch trong quá khứ, thiếu link/địa điểm, hạn xác nhận sai, sai công ty, ứng viên tự gửi, hồ sơ không tồn tại.',
    'Tất cả bị từ chối TRƯỚC khi ghi outbox nên không có email nào được gửi. Cuối thư mục: chế độ ?dryRun=true',
    'xem trước đúng email sẽ gửi (người nhận, tiêu đề, nội dung) và xác nhận hồ sơ không thay đổi.'
), [
    req('NTD công ty B: hồ sơ dùng cho thư mời/trúng tuyển', { path: '/api/applications/{{e2eOfferAppId}}', token: 'employer2', pre: skipUnless('e2eOfferAppId', 'chưa chạy thư mục "Ứng tuyển và tìm ứng viên".'), test: ok(() => {
        const app = pm.response.json().data;
        const inbox = String(pm.environment.get('testInboxEmail') || '').toLowerCase();
        const safe = Boolean(inbox) && String(app.candidate_email).toLowerCase() === inbox;
        pm.test('Hồ sơ thuộc công ty B và ứng viên kiểm thử', () => {
            pm.expect(app.company_id).to.eql(Number(pm.environment.get('employer2CompanyId')));
            pm.expect(app.candidate_id).to.eql(Number(pm.environment.get('testCandidateUserId')));
        });
        if (inbox) pm.test('Email nhận thư là hộp thư kiểm thử (an toàn để gửi)', () => pm.expect(safe).to.be.true);
        if (safe) pm.environment.set('e2eOfferSafe', 'true'); else pm.environment.unset('e2eOfferSafe');
        pm.environment.set('e2eOfferStage', app.stage);
    }) }),
    req('NTD công ty B: hồ sơ dùng cho thư từ chối', { path: '/api/applications/{{e2eRejectAppId}}', token: 'employer2', pre: skipUnless('e2eRejectAppId', 'chưa chạy thư mục "Ứng tuyển và tìm ứng viên".'), test: ok(() => {
        const app = pm.response.json().data;
        const inbox = String(pm.environment.get('testInboxEmail') || '').toLowerCase();
        const safe = Boolean(inbox) && String(app.candidate_email).toLowerCase() === inbox;
        pm.test('Hồ sơ thuộc công ty B và ứng viên kiểm thử', () => pm.expect(app.candidate_id).to.eql(Number(pm.environment.get('testCandidateUserId'))));
        if (inbox) pm.test('Email nhận thư là hộp thư kiểm thử (an toàn để gửi)', () => pm.expect(safe).to.be.true);
        if (safe) pm.environment.set('e2eRejectSafe', 'true'); else pm.environment.unset('e2eRejectSafe');
        pm.environment.set('e2eRejectStage', app.stage);
        pm.environment.set('e2eRejectTimeline', app.timeline.length);
    }) }),
    req('Mốc thông báo hiện có của ứng viên kiểm thử', { path: '/api/get-notification-by-user?userId=&limit=1&offset=0', token: 'testCandidate', test: ok(() => {
        const rows = pm.response.json().data;
        pm.environment.set('e2eNotifMaxId', rows.length ? rows[0].id : 0);
    }) }),
    req('Lịch phỏng vấn trong quá khứ -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2',
        body: interview({ interviewDate: '{{e2ePastDate}}', confirmBy: undefined }), test: expectError(400, 'Thời gian phỏng vấn phải ở tương lai', 1)
    }),
    req('Phỏng vấn trực tuyến thiếu link -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2',
        body: interview({ interviewMode: 'online', location: undefined }), test: contractError()
    }),
    req('Phỏng vấn tại văn phòng thiếu địa điểm -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2',
        body: interview({ location: undefined }), test: contractError()
    }),
    req('Hạn xác nhận sau giờ phỏng vấn -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2',
        body: interview({ confirmBy: '{{e2eLateConfirmBy}}' }), test: expectError(400, 'Hạn xác nhận phải ở tương lai và không sau giờ phỏng vấn', 1)
    }),
    req('Thời lượng phỏng vấn 5 phút -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2',
        body: interview({ durationMinutes: '5' }), test: contractError()
    }),
    req('Thư trúng tuyển: hạn phản hồi sau ngày nhận việc -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'decision-notification'), token: 'employer2',
        body: offer({ responseDeadline: '{{e2eLateDeadline}}' }), test: expectError(400, 'Hạn phản hồi phải ở tương lai và không sau thời gian nhận việc', 1)
    }),
    req('Thư trúng tuyển làm từ xa thiếu link -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'decision-notification'), token: 'employer2',
        body: offer({ workMode: 'remote', location: undefined }), test: contractError()
    }),
    req('Kết quả không hợp lệ (maybe) -> 400', {
        method: 'POST', path: appPath('e2eOfferAppId', 'decision-notification'), token: 'employer2', body: { decision: 'maybe' }, test: contractError()
    }),
    req('Công ty A gửi thư mời cho hồ sơ công ty B -> 403', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer', body: interview(),
        test: expectError(403, 'Bạn không có quyền gửi thư mời cho hồ sơ này', 3)
    }),
    req('Công ty A gửi kết quả cho hồ sơ công ty B -> 403', {
        method: 'POST', path: appPath('e2eOfferAppId', 'decision-notification'), token: 'employer', body: offer(),
        test: expectError(403, 'Bạn không có quyền gửi kết quả cho hồ sơ này', 3)
    }),
    req('Ứng viên tự gửi kết quả cho mình -> 403', {
        method: 'POST', path: appPath('e2eOfferAppId', 'decision-notification'), token: 'testCandidate', body: offer(),
        test: expectError(403, 'không có quyền')
    }),
    req('Gửi thư mời cho hồ sơ không tồn tại -> 404', {
        method: 'POST', path: '/api/applications/999999999/interview-invitation', token: 'employer2', body: interview(),
        test: expectError(404, 'Không tìm thấy hồ sơ ứng tuyển', 2)
    }),
    ...dryRunChecks
]);

const emailGuard = script(() => {
    if (pm.environment.get('allowEmails') !== 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": đặt allowEmails = true để gửi email thật tới testInboxEmail.');
        pm.execution.skipRequest();
    } else if (pm.environment.get('e2eOfferSafe') !== 'true' || pm.environment.get('e2eRejectSafe') !== 'true') {
        console.log('Bỏ qua "' + pm.info.requestName + '": testInboxEmail chưa điền hoặc hồ sơ không thuộc hộp thư đó, không gửi email.');
        pm.execution.skipRequest();
    }
});

const realMail = folder('b - Gửi email thật tới hộp thư kiểm thử (cần allowEmails = true)', lines(
    'Mỗi lần chạy gửi 5 email tới testInboxEmail: mời phỏng vấn, mời nhận việc, chúc mừng nhận việc (hồ sơ 1);',
    'đang xem xét, cảm ơn và từ chối (hồ sơ 2). Mỗi bước kiểm tra API, lịch phỏng vấn, lịch sử hồ sơ và',
    'thông báo trong ứng dụng do Notification Service tạo (Outbox -> RabbitMQ -> Notification).',
    'Mở hộp thư kiểm thử để xem nội dung email thật. Không dùng với hồ sơ của người thật.'
), [
    req('Đặt lại hồ sơ 1 về Mới ứng tuyển (không gửi email)', {
        method: 'PATCH', path: appPath('e2eOfferAppId', 'stage'), token: 'employer2',
        body: { stage: 'moi_ung_tuyen', reason: '[KIỂM THỬ Postman] Đặt lại để chạy lại luồng tuyển dụng' },
        description: 'Lần chạy trước kết thúc ở "nhận việc", khi đó không được mời phỏng vấn nữa (409). Bước "mới ứng tuyển" không có email cho ứng viên.',
        test: ok(() => pm.test('stage = moi_ung_tuyen', () => pm.expect(pm.response.json().data.stage).to.eql('moi_ung_tuyen')))
    }),
    req('Mời phỏng vấn (gửi email)', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2', body: interview(), test: queued('phong_van')
    }),
    req('Ứng viên thấy lịch phỏng vấn của mình', { path: '/api/my-interviews', token: 'testCandidate', test: ok(() => {
        const entry = pm.response.json().data.find((i) => String(i.applicationId) === String(pm.environment.get('e2eOfferAppId')));
        pm.test('Có lịch đúng ngày, giờ, hình thức', () => {
            pm.expect(entry, 'chưa thấy lịch phỏng vấn').to.not.be.undefined;
            pm.expect(entry.interview.interviewDate).to.eql(pm.environment.get('e2eInterviewDate'));
            pm.expect(entry.interview.interviewTime).to.eql('09:30');
            pm.expect(entry.interview.interviewMode).to.eql('onsite');
        });
        pm.test('Trạng thái lịch: scheduled', () => pm.expect(entry && entry.status).to.eql('scheduled'));
    }) }),
    req('Nhà tuyển dụng thấy lịch trên lịch phỏng vấn công ty', { path: '/api/applications/interviews', token: 'employer2', test: ok(() => {
        const entry = pm.response.json().data.find((i) => String(i.applicationId) === String(pm.environment.get('e2eOfferAppId')));
        pm.test('Có lịch của ứng viên kiểm thử', () => {
            pm.expect(entry).to.not.be.undefined;
            pm.expect(entry.candidateId).to.eql(Number(pm.environment.get('testCandidateUserId')));
        });
    }) }),
    req('Lịch sử hồ sơ ghi lại thư mời', { path: '/api/applications/{{e2eOfferAppId}}', token: 'employer2', test: ok(() => {
        const app = pm.response.json().data;
        pm.test('Thư mời mới nhất là phỏng vấn', () => pm.expect(app.latestDecision.decision).to.eql('interview'));
        pm.test('Timeline mới nhất chuyển tới phong_van', () => pm.expect(app.timeline[0].to_stage).to.eql('phong_van'));
    }) }),
    notificationArrived('Ứng viên nhận thông báo mời phỏng vấn', 'APPLICATION_INTERVIEW', 'Bạn được mời phỏng vấn'),
    req('Gửi thư mời nhận việc - trúng tuyển (gửi email)', {
        method: 'POST', path: appPath('e2eOfferAppId', 'decision-notification'), token: 'employer2', body: offer(), test: queued('de_nghi')
    }),
    req('Ứng viên thấy hồ sơ ở bước Đề nghị', { path: '/api/my-applications', token: 'testCandidate', test: ok(() => {
        const app = pm.response.json().data.find((a) => String(a.id) === String(pm.environment.get('e2eOfferAppId')));
        pm.test('stage = de_nghi', () => pm.expect(app.stage).to.eql('de_nghi'));
    }) }),
    notificationArrived('Ứng viên nhận thông báo trúng tuyển', 'APPLICATION_ACCEPTED', ''),
    req('Xác nhận ứng viên nhận việc (gửi email)', {
        method: 'PATCH', path: appPath('e2eOfferAppId', 'stage'), token: 'employer2',
        body: { stage: 'nhan_viec', reason: '[KIỂM THỬ Postman] Ứng viên đã xác nhận qua email HR' },
        test: ok(() => pm.test('stage = nhan_viec', () => pm.expect(pm.response.json().data.stage).to.eql('nhan_viec')))
    }),
    req('Đã nhận việc thì không mời phỏng vấn nữa -> 409', {
        method: 'POST', path: appPath('e2eOfferAppId', 'interview-invitation'), token: 'employer2', body: interview(),
        test: expectError(409, 'Ứng viên đã nhận việc', 4)
    }),
    notificationArrived('Ứng viên nhận thông báo nhận việc', 'APPLICATION_STAGE', ''),
    req('Hồ sơ 2: chuyển sang Đang xem xét (gửi email)', {
        method: 'PATCH', path: appPath('e2eRejectAppId', 'stage'), token: 'employer2', body: { stage: 'dang_xem_xet' },
        test: ok(() => pm.test('stage = dang_xem_xet', () => pm.expect(pm.response.json().data.stage).to.eql('dang_xem_xet')))
    }),
    notificationArrived('Ứng viên nhận thông báo đang xem xét', 'APPLICATION_STAGE', ''),
    req('Hồ sơ 2: gửi email cảm ơn và từ chối', {
        method: 'POST', path: appPath('e2eRejectAppId', 'decision-notification'), token: 'employer2',
        body: { decision: 'rejected', message: '[KIỂM THỬ Postman] Email từ chối tự động, không phải kết quả thật.', interviewed: true },
        test: queued('tu_choi')
    }),
    notificationArrived('Ứng viên nhận thông báo từ chối', 'APPLICATION_REJECTED', 'Cảm ơn bạn đã tham gia phỏng vấn'),
    req('Ứng viên thấy kết quả cuối của 2 hồ sơ', { path: '/api/my-applications', token: 'testCandidate', test: ok(() => {
        const rows = pm.response.json().data;
        const stageOf = (id) => (rows.find((a) => String(a.id) === String(id)) || {}).stage;
        pm.test('Hồ sơ 1: nhan_viec, hồ sơ 2: tu_choi', () => {
            pm.expect(stageOf(pm.environment.get('e2eOfferAppId'))).to.eql('nhan_viec');
            pm.expect(stageOf(pm.environment.get('e2eRejectAppId'))).to.eql('tu_choi');
        });
    }) }),
    req('Đánh dấu đã đọc mọi thông báo', { method: 'POST', path: '/api/mark-read-notification', token: 'testCandidate', body: {}, test: ok() }),
    req('Không còn thông báo chưa đọc', { path: '/api/get-notification-by-user?userId=&limit=5&offset=0', token: 'testCandidate', test: ok(() => {
        pm.test('unreadCount = 0', () => pm.expect(pm.response.json().unreadCount).to.eql(0));
    }) })
], { pre: emailGuard });

const recruitment = folder('Tuyển dụng: mời phỏng vấn, thư trúng tuyển, từ chối (email)', lines(
    'Luồng nghiệp vụ của nhà tuyển dụng công ty B trên 2 hồ sơ có sẵn của ứng viên kiểm thử (testCandidate*),',
    'người có email là hộp thư kiểm thử testInboxEmail. Phần a luôn chạy và không gửi email; phần b gửi email thật.'
), [safeChecks, realMail], { pre: datesPre });

export { recruitment };
