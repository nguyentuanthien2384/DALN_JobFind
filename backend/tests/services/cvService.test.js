const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn()
});
const mockDb = {
  Cv: model(), User: model(), Account: model(), Post: model(), DetailPost: model(), Skill: model(),
  UserSkill: model(), Company: model(), CandidateView: model(), UserSetting: model(), Allcode: {},
  sequelize: { fn: jest.fn(() => 'fn'), col: jest.fn(() => 'col'), transaction: jest.fn() }
};
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockPdfToString = jest.fn();
const mockFlat = jest.fn((value) => String(value || '').toLowerCase().replace(/[^a-z]/g, ''));

jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/CommonUtils', () => ({ pdfToString: mockPdfToString, flatAllString: mockFlat }));

const service = require('../../src/services/cvService');

const reset = () => {
  for (const item of Object.values(mockDb)) {
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  mockDb.sequelize.fn.mockReturnValue('fn');
  mockDb.sequelize.col.mockReturnValue('col');
  mockDb.sequelize.transaction.mockImplementation(async (callback) => callback(mockTransaction));
  mockPdfToString.mockReset();
  mockFlat.mockClear();
};

describe('cvService', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());
  beforeEach(reset);

  test('all public functions validate required input and do not continue querying', async () => {
    const invalid = [
      ['handleCreateCv', {}], ['getAllListCvByPost', {}], ['getDetailCvById', {}],
      ['getAllCvByUserId', {}], ['getStatisticalCv', {}], ['fillterCVBySelection', {}],
      ['checkSeeCandiate', {}]
    ];
    for (const [method, arg] of invalid) expect((await service[method](arg)).errCode).toBe(1);
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  });

  test('creates a CV and returns its id, including a failed create response', async () => {
    mockDb.Post.findOne.mockResolvedValue({ id: 2, timeEnd: String(Date.now() + 60_000) });
    mockDb.Cv.findOne.mockResolvedValue(null);
    mockDb.Cv.create.mockResolvedValueOnce({ id: 9 }).mockResolvedValueOnce(null);
    const payload = { userId: 1, postId: 2, file: 'base64', description: 'hello' };
    expect(await service.handleCreateCv(payload)).toEqual(expect.objectContaining({ errCode: 0, cvId: 9 }));
    expect(mockDb.Cv.create).toHaveBeenCalledWith({ userId: 1, postId: 2, file: 'base64', isChecked: 0, description: 'hello' });
    expect((await service.handleCreateCv(payload)).errCode).toBe(2);
  });

  test('rejects hidden, expired and duplicate applications', async () => {
    const payload = { userId: 1, postId: 2, file: 'base64', description: 'hello' };
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.handleCreateCv(payload)).errCode).toBe(3);

    mockDb.Post.findOne.mockResolvedValueOnce({ id: 2, timeEnd: String(Date.now() - 1) });
    expect((await service.handleCreateCv(payload)).errCode).toBe(4);

    mockDb.Post.findOne.mockResolvedValueOnce({ id: 2, timeEnd: String(Date.now() + 60_000) });
    mockDb.Cv.findOne.mockResolvedValueOnce({ id: 8 });
    expect((await service.handleCreateCv(payload)).errCode).toBe(5);
    expect(mockDb.Cv.create).not.toHaveBeenCalled();
  });

  test('maps a concurrent duplicate insert to the stable duplicate response', async () => {
    mockDb.Post.findOne.mockResolvedValue({ id: 2, timeEnd: String(Date.now() + 60_000) });
    mockDb.Cv.findOne.mockResolvedValue(null);
    const conflict = new Error('duplicate');
    conflict.name = 'SequelizeUniqueConstraintError';
    mockDb.Cv.create.mockRejectedValue(conflict);
    expect((await service.handleCreateCv({
      userId: 1, postId: 2, file: 'base64', description: 'hello'
    })).errCode).toBe(5);
  });

  test('lists applicants and calculates a CV skill match percentage', async () => {
    mockDb.Cv.findAndCountAll.mockResolvedValue({ rows: [{ id: 1, file: 'pdf' }], count: 1 });
    mockDb.Post.findOne.mockResolvedValue({
      postDetailData: { descriptionHTML: 'We need node and databases', jobTypePostData: { code: 'IT' } }
    });
    mockDb.Skill.findAll.mockResolvedValue([{ id: 1, name: 'Node' }, { id: 2, name: 'React' }]);
    mockPdfToString.mockResolvedValue({ pages: [{ content: [{ str: 'Strong NODE experience' }] }] });
    const result = await service.getAllListCvByPost({ postId: 2, limit: '10', offset: '0' });
    expect(result).toEqual({ errCode: 0, data: [{ id: 1, file: '100%' }], count: 1 });
    expect(mockDb.Cv.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  test('CV detail handles missing CV, candidate read and recruiter read/decoded file', async () => {
    mockDb.Cv.findOne.mockResolvedValueOnce(null);
    expect((await service.getDetailCvById({ cvId: 1, roleCode: 'CANDIDATE' })).errCode).toBe(2);
    const candidateCv = { id: 1, file: null, isChecked: 0, save: jest.fn() };
    mockDb.Cv.findOne.mockResolvedValueOnce(candidateCv);
    expect((await service.getDetailCvById({ cvId: 1, roleCode: 'CANDIDATE' })).data.isChecked).toBe(0);
    expect(candidateCv.save).not.toHaveBeenCalled();
    const recruiterCv = { id: 1, file: Buffer.from('cv').toString('base64'), isChecked: 0, save: jest.fn() };
    mockDb.Cv.findOne.mockResolvedValueOnce(recruiterCv);
    const result = await service.getDetailCvById({ cvId: 1, roleCode: 'EMPLOYER' });
    expect(result.data.file).toBe('cv');
    expect(result.data.isChecked).toBe(1);
    expect(recruiterCv.save).toHaveBeenCalled();
  });

  test('returns paginated application history without CV file blobs', async () => {
    mockDb.Cv.findAndCountAll.mockResolvedValue({ rows: ['cv'], count: 1 });
    expect(await service.getAllCvByUserId({ userId: 1, limit: '5', offset: '0' })).toEqual({
      errCode: 0, data: ['cv'], count: 1
    });
    expect(mockDb.Cv.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, offset: 0 }));
  });

  test('statistics handle missing company, zero CVs and per-post totals', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    const args = { companyId: 4, fromDate: '2026-01-01', toDate: '2026-01-31', limit: 10, offset: 0 };
    expect((await service.getStatisticalCv(args)).errCode).toBe(1);
    mockDb.Company.findOne.mockResolvedValue({ id: 4 });
    mockDb.User.findAll.mockResolvedValue([{ id: 7 }]);
    mockDb.Post.findAndCountAll.mockResolvedValueOnce({ rows: [{ id: 1 }], count: 1 });
    mockDb.Cv.findAll.mockResolvedValueOnce([]);
    expect((await service.getStatisticalCv(args)).data).toEqual([{ id: 1, total: 0 }]);
    mockDb.Post.findAndCountAll.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], count: 2 });
    mockDb.Cv.findAll.mockResolvedValueOnce([{ postId: 1, total: 3 }]);
    expect((await service.getStatisticalCv(args)).data).toEqual([{ id: 1, total: 3 }, { id: 2, total: 0 }]);
  });

  test('candidate filtering hides percentage without criteria', async () => {
    mockDb.UserSetting.findAndCountAll.mockResolvedValue({ rows: [{ userId: 1, file: 'pdf' }], count: 1 });
    const result = await service.fillterCVBySelection({ limit: 5, offset: 0 });
    expect(result).toEqual({ errCode: 0, data: [{ userId: 1 }], count: 1, isHiddenPercent: true });
  });

  test('candidate filtering selects and returns only public identity fields before unlock', async () => {
    mockDb.UserSetting.findAndCountAll.mockResolvedValue({
      rows: [{
        userId: 9,
        file: 'pdf',
        userSettingData: {
          id: 9,
          firstName: 'An',
          lastName: 'Nguyen',
          image: '/avatar.png',
          email: 'private@example.com',
          address: 'Private address',
          dob: '2000-01-01',
          companyId: 44
        }
      }],
      count: 1
    });

    const result = await service.fillterCVBySelection({ limit: 5, offset: 0 });
    expect(result.data[0].userSettingData).toEqual({
      id: 9,
      firstName: 'An',
      lastName: 'Nguyen',
      image: '/avatar.png'
    });
    expect(result.data[0].userSettingData).not.toHaveProperty('email');
    expect(result.data[0].userSettingData).not.toHaveProperty('address');
    const query = mockDb.UserSetting.findAndCountAll.mock.calls[0][0];
    expect(query.include[0]).toEqual(expect.objectContaining({
      as: 'userSettingData',
      attributes: ['id', 'firstName', 'lastName', 'image']
    }));
  });

  test('candidate filtering scores DB skills, free-text CV skills and preference bonuses', async () => {
    mockDb.UserSetting.findAndCountAll.mockResolvedValue({
      rows: [{
        userId: 1, file: 'pdf', expTypeSettingData: { code: 'E1' },
        salaryTypeSettingData: { code: 'S1' }, provinceSettingData: { code: 'HN' }
      }], count: 1
    });
    mockDb.Skill.findAll.mockResolvedValue([{ id: 1, name: 'Node' }]);
    mockDb.UserSkill.findAll.mockResolvedValue([{ SkillId: 1 }]);
    mockPdfToString.mockResolvedValue({ pages: [{ content: [{ str: 'Docker' }] }] });
    const result = await service.fillterCVBySelection({
      limit: 5, offset: 0, categoryJobCode: 'IT', listSkills: '1', otherSkills: 'Docker',
      experienceJobCode: 'E1', salaryCode: 'S1', provinceCode: 'HN'
    });
    expect(result.isHiddenPercent).toBe(false);
    // 1 DB skill + 1 free-text CV skill + 3 preference bonuses over a
    // weighted denominator of 6 gives 5/6, rounded to 83%.
    expect(result.data[0].file).toBe('83%');
  });

  test('candidate view grant validates company and active candidate inside a locked transaction', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.checkSeeCandiate({ companyId: 4, candidateId: 9 })).errCode).toBe(2);

    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4 });
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.checkSeeCandiate({ companyId: 4, candidateId: 9 })).errCode).toBe(3);
    expect(mockDb.Company.findOne).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 4 }, transaction: mockTransaction, lock: 'UPDATE'
    }));
    expect(mockDb.Account.findOne).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: 9, roleCode: 'CANDIDATE', statusCode: 'S1' },
      transaction: mockTransaction
    }));
  });

  test('candidate view grant is idempotent and never charges an existing company-candidate pair', async () => {
    const company = { id: 4, allowCvFree: 2, allowCv: 3, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    mockDb.Account.findOne.mockResolvedValue({ userId: 9 });
    mockDb.CandidateView.findOne.mockResolvedValue({ id: 7, allowanceType: 'FREE' });

    expect(await service.checkSeeCandiate({ companyId: 4, candidateId: 9 })).toEqual({
      errCode: 0,
      errMessage: 'Ok',
      alreadyGranted: true,
      chargedAllowance: null
    });
    expect(company.save).not.toHaveBeenCalled();
    expect(mockDb.CandidateView.create).not.toHaveBeenCalled();
  });

  test('candidate view quota uses free allowance first and records the entitlement atomically', async () => {
    const free = { allowCvFree: 1, allowCv: 3, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(free);
    mockDb.Account.findOne.mockResolvedValue({ userId: 9 });
    mockDb.CandidateView.findOne.mockResolvedValue(null);

    expect(await service.checkSeeCandiate({ companyId: 4, candidateId: 9 })).toEqual(expect.objectContaining({
      errCode: 0, alreadyGranted: false, chargedAllowance: 'FREE'
    }));
    expect(free).toEqual(expect.objectContaining({ allowCvFree: 0, allowCv: 3 }));
    expect(free.save).toHaveBeenCalledWith({ fields: ['allowCvFree'], transaction: mockTransaction });
    expect(mockDb.CandidateView.create).toHaveBeenCalledWith({
      companyId: 4, candidateId: 9, allowanceType: 'FREE'
    }, { transaction: mockTransaction });
  });

  test('candidate view quota falls back to paid allowance and rejects an empty balance', async () => {
    const paid = { allowCvFree: 0, allowCv: 2, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(paid);
    mockDb.Account.findOne.mockResolvedValue({ userId: 9 });
    mockDb.CandidateView.findOne.mockResolvedValue(null);
    expect((await service.checkSeeCandiate({ companyId: 4, candidateId: 9 })).chargedAllowance).toBe('PAID');
    expect(paid.allowCv).toBe(1);
    mockDb.Company.findOne.mockResolvedValueOnce({ allowCvFree: 0, allowCv: 0 });
    expect((await service.checkSeeCandiate({ companyId: 4, candidateId: 9 })).errCode).toBe(1);
    expect(mockDb.CandidateView.create).toHaveBeenCalledTimes(1);
  });

  test('all workflows propagate unexpected database/PDF failures', async () => {
    const failures = [
      ['handleCreateCv', { userId: 1, postId: 2, file: 'x', description: 'x' }, mockDb.Cv, 'create'],
      ['getAllListCvByPost', { postId: 2, limit: 1, offset: 0 }, mockDb.Cv, 'findAndCountAll'],
      ['getDetailCvById', { cvId: 1, roleCode: 'CANDIDATE' }, mockDb.Cv, 'findOne'],
      ['getAllCvByUserId', { userId: 1, limit: 1, offset: 0 }, mockDb.Cv, 'findAndCountAll'],
      ['getStatisticalCv', { companyId: 1, fromDate: 'a', toDate: 'b' }, mockDb.Company, 'findOne'],
      ['fillterCVBySelection', { limit: 1, offset: 0 }, mockDb.UserSetting, 'findAndCountAll'],
      ['checkSeeCandiate', { companyId: 1, candidateId: 2 }, mockDb.Company, 'findOne']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      if (method === 'handleCreateCv') {
        mockDb.Post.findOne.mockResolvedValueOnce({ id: 2, timeEnd: String(Date.now() + 60_000) });
        mockDb.Cv.findOne.mockResolvedValueOnce(null);
      }
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
  });
});
