const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn()
});
const mockDb = {
  Cv: model(), User: model(), Account: model(), Post: model(), DetailPost: model(), Skill: model(),
  UserSkill: model(), Company: model(), UserSetting: model(), Allcode: {},
  sequelize: { fn: jest.fn(() => 'fn'), col: jest.fn(() => 'col') }
};
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
    mockDb.Cv.create.mockResolvedValueOnce({ id: 9 }).mockResolvedValueOnce(null);
    const payload = { userId: 1, postId: 2, file: 'base64', description: 'hello' };
    expect(await service.handleCreateCv(payload)).toEqual(expect.objectContaining({ errCode: 0, cvId: 9 }));
    expect(mockDb.Cv.create).toHaveBeenCalledWith({ userId: 1, postId: 2, file: 'base64', isChecked: 0, description: 'hello' });
    expect((await service.handleCreateCv(payload)).errCode).toBe(2);
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

  test('candidate view quota uses free allowance first, then paid allowance', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.checkSeeCandiate({ userId: 'null', companyId: 4 })).errCode).toBe(2);
    const free = { allowCvFree: 1, allowCv: 3, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(free);
    expect((await service.checkSeeCandiate({ userId: 'null', companyId: 4 })).errCode).toBe(0);
    expect(free).toEqual(expect.objectContaining({ allowCvFree: 0, allowCv: 3 }));
    const paid = { allowCvFree: 0, allowCv: 2, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(paid);
    expect((await service.checkSeeCandiate({ userId: 'null', companyId: 4 })).errCode).toBe(0);
    expect(paid.allowCv).toBe(1);
    mockDb.Company.findOne.mockResolvedValueOnce({ allowCvFree: 0, allowCv: 0 });
    expect((await service.checkSeeCandiate({ userId: 'null', companyId: 4 })).errCode).toBe(1);
  });

  test('candidate view lookup also accepts a user id and resolves its company', async () => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValue({ allowCvFree: 1, allowCv: 0, save: jest.fn() });
    expect((await service.checkSeeCandiate({ userId: 7 })).errCode).toBe(0);
    expect(mockDb.Company.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4 } }));
  });

  test('all workflows propagate unexpected database/PDF failures', async () => {
    const failures = [
      ['handleCreateCv', { userId: 1, postId: 2, file: 'x', description: 'x' }, mockDb.Cv, 'create'],
      ['getAllListCvByPost', { postId: 2, limit: 1, offset: 0 }, mockDb.Cv, 'findAndCountAll'],
      ['getDetailCvById', { cvId: 1, roleCode: 'CANDIDATE' }, mockDb.Cv, 'findOne'],
      ['getAllCvByUserId', { userId: 1, limit: 1, offset: 0 }, mockDb.Cv, 'findAndCountAll'],
      ['getStatisticalCv', { companyId: 1, fromDate: 'a', toDate: 'b' }, mockDb.Company, 'findOne'],
      ['fillterCVBySelection', { limit: 1, offset: 0 }, mockDb.UserSetting, 'findAndCountAll'],
      ['checkSeeCandiate', { userId: 'null', companyId: 1 }, mockDb.Company, 'findOne']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
  });
});
