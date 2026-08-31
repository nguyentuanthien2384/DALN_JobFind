import assert from 'assert';
import { Op } from 'sequelize';
import db from '../src/models/index';
import cvService from '../src/services/cvService';

const employerPhone = process.env.SMOKE_EMPLOYER_PHONE || '0795095042';

const run = async () => {
    let company;
    let candidateId;
    let originalAllowCv;
    let originalAllowCvFree;

    try {
        const employerAccount = await db.Account.findOne({
            where: { phonenumber: employerPhone, statusCode: 'S1' },
            attributes: ['userId'],
            raw: true
        });
        assert(employerAccount, 'Không tìm thấy tài khoản nhà tuyển dụng smoke test');

        const employer = await db.User.findOne({
            where: { id: employerAccount.userId },
            attributes: ['companyId'],
            raw: true
        });
        assert(employer?.companyId, 'Tài khoản smoke test chưa thuộc công ty');

        company = await db.Company.findByPk(employer.companyId, { raw: false });
        assert(company, 'Không tìm thấy công ty smoke test');
        originalAllowCv = Number(company.allowCv || 0);
        originalAllowCvFree = Number(company.allowCvFree || 0);

        const viewedRows = await db.CandidateView.findAll({
            where: { companyId: company.id },
            attributes: ['candidateId'],
            raw: true
        });
        const viewedIds = viewedRows.map((row) => row.candidateId);
        const candidate = await db.Account.findOne({
            where: {
                roleCode: 'CANDIDATE',
                statusCode: 'S1',
                ...(viewedIds.length ? { userId: { [Op.notIn]: viewedIds } } : {})
            },
            attributes: ['userId'],
            raw: true
        });
        assert(candidate, 'Không còn ứng viên chưa được mở khóa để chạy smoke test');
        candidateId = candidate.userId;

        if (originalAllowCvFree <= 0 && originalAllowCv <= 0) {
            company.allowCvFree = 1;
            await company.save({ fields: ['allowCvFree'], silent: true });
        }

        const before = await db.Company.findByPk(company.id, { raw: true });
        const first = await cvService.checkSeeCandiate({
            companyId: company.id,
            candidateId
        });
        assert.strictEqual(first.errCode, 0, first.errMessage);
        assert.strictEqual(first.alreadyGranted, false);

        const afterFirst = await db.Company.findByPk(company.id, { raw: true });
        const expectedFree = Number(before.allowCvFree) > 0
            ? Number(before.allowCvFree) - 1
            : Number(before.allowCvFree);
        const expectedPaid = Number(before.allowCvFree) > 0
            ? Number(before.allowCv)
            : Number(before.allowCv) - 1;
        assert.strictEqual(Number(afterFirst.allowCvFree), expectedFree);
        assert.strictEqual(Number(afterFirst.allowCv), expectedPaid);

        const second = await cvService.checkSeeCandiate({
            companyId: company.id,
            candidateId
        });
        assert.strictEqual(second.errCode, 0, second.errMessage);
        assert.strictEqual(second.alreadyGranted, true);

        const afterSecond = await db.Company.findByPk(company.id, { raw: true });
        assert.strictEqual(Number(afterSecond.allowCvFree), expectedFree);
        assert.strictEqual(Number(afterSecond.allowCv), expectedPaid);
        assert(await db.CandidateView.findOne({ where: { companyId: company.id, candidateId } }));

        console.log('PASS  Mở khóa ứng viên tạo đúng một entitlement');
        console.log('PASS  Xem lại cùng ứng viên không bị trừ thêm lượt');
    } finally {
        if (company && candidateId) {
            await db.CandidateView.destroy({ where: { companyId: company.id, candidateId } });
        }
        if (company && originalAllowCv !== undefined && originalAllowCvFree !== undefined) {
            company.allowCv = originalAllowCv;
            company.allowCvFree = originalAllowCvFree;
            await company.save({ fields: ['allowCv', 'allowCvFree'], silent: true });
        }
        await db.sequelize.close();
    }
};

run().catch((error) => {
    console.error(`FAIL  Smoke test entitlement: ${error.message}`);
    process.exitCode = 1;
});
