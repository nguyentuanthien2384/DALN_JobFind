const mockDb = {
  Allcode: { findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  Skill: { findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  UserSkill: { findOne: jest.fn() },
  Post: { findAll: jest.fn() },
  DetailPost: {},
  Sequelize: { where: jest.fn(() => 'where-expression') },
  sequelize: {
    fn: jest.fn(() => 'fn-expression'), col: jest.fn(() => 'col-expression'), literal: jest.fn(() => 'literal-expression')
  }
};
const mockUpload = jest.fn();

jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/cloudinary', () => ({ uploader: { upload: mockUpload } }));

const service = require('../../src/services/allcodeService');

const reset = () => {
  for (const item of Object.values(mockDb)) {
    if (!item || typeof item !== 'object') continue;
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  mockUpload.mockReset();
};

describe('allcodeService', () => {
  beforeEach(reset);

  test('every command/query validates required input', async () => {
    const invalid = [
      ['handleCreateNewAllCode', {}], ['getAllCodeService', null], ['handleUpdateAllCode', {}],
      ['getDetailAllcodeByCode', null], ['handleDeleteAllCode', null], ['getListAllCodeService', {}],
      ['handleCreateNewSkill', {}], ['handleDeleteSkill', null], ['getAllSkillByJobCode', null],
      ['getListSkill', {}], ['handleUpdateSkill', {}], ['getDetailSkillById', null]
    ];
    for (const [method, arg] of invalid) expect((await service[method](arg)).errCode).toBe(1);
  });

  test('creates an allcode, optionally uploading its image, and rejects duplicate codes', async () => {
    mockDb.Allcode.findOne.mockResolvedValueOnce({ code: 'A' });
    expect((await service.handleCreateNewAllCode({ type: 'T', value: 'V', code: 'A' })).errCode).toBe(2);

    mockDb.Allcode.findOne.mockResolvedValueOnce(null);
    mockUpload.mockResolvedValueOnce({ url: 'https://image' });
    expect((await service.handleCreateNewAllCode({ type: 'T', value: 'V', code: 'B', image: 'data' })).errCode).toBe(0);
    expect(mockDb.Allcode.create).toHaveBeenCalledWith({ type: 'T', value: 'V', code: 'B', image: 'https://image' });

    mockDb.Allcode.findOne.mockResolvedValueOnce(null);
    await service.handleCreateNewAllCode({ type: 'T', value: 'V', code: 'C' });
    expect(mockDb.Allcode.create).toHaveBeenLastCalledWith(expect.objectContaining({ image: '' }));
  });

  test('loads allcodes by type and details by code', async () => {
    mockDb.Allcode.findAll.mockResolvedValue(['a']);
    expect(await service.getAllCodeService('TYPE')).toEqual({ errCode: 0, data: ['a'] });
    mockDb.Allcode.findOne.mockResolvedValueOnce({ code: 'A' }).mockResolvedValueOnce(null);
    expect((await service.getDetailAllcodeByCode('A')).errCode).toBe(0);
    expect((await service.getDetailAllcodeByCode('B')).errCode).toBe(1);
  });

  test('updates existing allcodes and handles missing/failed saves', async () => {
    mockDb.Allcode.findOne.mockResolvedValueOnce(null);
    expect((await service.handleUpdateAllCode({ code: 'A', value: 'v' })).errCode).toBe(2);
    const row = { save: jest.fn().mockResolvedValue(true) };
    mockDb.Allcode.findOne.mockResolvedValueOnce(row);
    mockUpload.mockResolvedValueOnce({ url: 'new' });
    expect((await service.handleUpdateAllCode({ code: 'A', value: 'new value', image: 'data' })).errCode).toBe(0);
    expect(row).toEqual(expect.objectContaining({ code: 'A', value: 'new value', image: 'new' }));
    const failed = { save: jest.fn().mockResolvedValue(null) };
    mockDb.Allcode.findOne.mockResolvedValueOnce(failed);
    expect((await service.handleUpdateAllCode({ code: 'B', value: 'v' })).errCode).toBe(1);
  });

  test('deletes allcodes and translates foreign-key errors', async () => {
    mockDb.Allcode.findOne.mockResolvedValueOnce(null);
    expect((await service.handleDeleteAllCode('A')).errCode).toBe(2);
    mockDb.Allcode.findOne.mockResolvedValueOnce({ code: 'A' });
    expect((await service.handleDeleteAllCode('A')).errCode).toBe(0);
    expect(mockDb.Allcode.destroy).toHaveBeenCalledWith({ where: { code: 'A' } });
    mockDb.Allcode.findOne.mockRejectedValueOnce(new Error('a foreign key constraint fails'));
    expect((await service.handleDeleteAllCode('A')).errCode).toBe(3);
  });

  test('paginates and searches allcodes', async () => {
    mockDb.Allcode.findAndCountAll.mockResolvedValue({ rows: ['a'], count: 1 });
    expect(await service.getListAllCodeService({ type: 'T', limit: '10', offset: '0', search: 'abc' })).toEqual({
      errCode: 0, data: ['a'], count: 1
    });
    expect(mockDb.Allcode.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  test('returns grouped active job counts with safe default and explicit pagination', async () => {
    mockDb.Post.findAll.mockResolvedValue(['group']);
    expect(await service.getListJobTypeAndCountPost({})).toEqual({ errCode: 0, data: ['group'] });
    expect(mockDb.Post.findAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 4, offset: 0 }));
    await service.getListJobTypeAndCountPost({ limit: '8', offset: '2' });
    expect(mockDb.Post.findAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 8, offset: 2 }));
  });

  test('creates skills only when unique in their category', async () => {
    mockDb.Skill.findOne.mockResolvedValueOnce({ id: 1 });
    expect((await service.handleCreateNewSkill({ name: 'Node', categoryJobCode: 'IT' })).errCode).toBe(2);
    mockDb.Skill.findOne.mockResolvedValueOnce(null);
    expect((await service.handleCreateNewSkill({ name: 'Node', categoryJobCode: 'IT' })).errCode).toBe(0);
    expect(mockDb.Skill.create).toHaveBeenCalledWith({ name: 'Node', categoryJobCode: 'IT' });
  });

  test('deletes unused skills but protects referenced skills', async () => {
    mockDb.Skill.findOne.mockResolvedValueOnce(null);
    expect((await service.handleDeleteSkill(1)).errCode).toBe(2);
    mockDb.Skill.findOne.mockResolvedValueOnce({ id: 1 });
    mockDb.UserSkill.findOne.mockResolvedValueOnce({ id: 2 });
    expect((await service.handleDeleteSkill(1)).errCode).toBe(3);
    expect(mockDb.Skill.destroy).not.toHaveBeenCalled();
    mockDb.Skill.findOne.mockResolvedValueOnce({ id: 1 });
    mockDb.UserSkill.findOne.mockResolvedValueOnce(null);
    expect((await service.handleDeleteSkill(1)).errCode).toBe(0);
    expect(mockDb.Skill.destroy).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  test('lists skills for all categories or one category and supports admin filters', async () => {
    mockDb.Skill.findAll.mockResolvedValue(['skill']);
    expect((await service.getAllSkillByJobCode('getAll')).data).toEqual(['skill']);
    expect(mockDb.Skill.findAll.mock.calls[0][0].where).toBeUndefined();
    await service.getAllSkillByJobCode('IT');
    expect(mockDb.Skill.findAll.mock.calls[1][0].where).toBeDefined();

    mockDb.Skill.findAndCountAll.mockResolvedValue({ rows: ['s'], count: 1 });
    expect(await service.getListSkill({ limit: '5', offset: '0', search: 'node', categoryJobCode: 'IT' })).toEqual({
      errCode: 0, data: ['s'], count: 1
    });
    expect(mockDb.Skill.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, offset: 0, where: expect.any(Object) }));
  });

  test('updates and loads skill detail, including not-found and failed-save states', async () => {
    mockDb.Skill.findOne.mockResolvedValueOnce(null);
    expect((await service.handleUpdateSkill({ id: 1, name: 'N', categoryJobCode: 'IT' })).errCode).toBe(2);
    const row = { save: jest.fn().mockResolvedValue(true) };
    mockDb.Skill.findOne.mockResolvedValueOnce(row);
    expect((await service.handleUpdateSkill({ id: 1, name: 'N', categoryJobCode: 'IT' })).errCode).toBe(0);
    expect(row).toEqual(expect.objectContaining({ name: 'N', categoryJobCode: 'IT' }));
    const failed = { save: jest.fn().mockResolvedValue(null) };
    mockDb.Skill.findOne.mockResolvedValueOnce(failed);
    expect((await service.handleUpdateSkill({ id: 1, name: 'N', categoryJobCode: 'IT' })).errCode).toBe(1);

    mockDb.Skill.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
    expect((await service.getDetailSkillById(1)).errCode).toBe(0);
    expect((await service.getDetailSkillById(2)).errCode).toBe(1);
  });

  test('all public functions propagate unexpected database errors', async () => {
    const failures = [
      ['handleCreateNewAllCode', { type: 'T', value: 'V', code: 'C' }, mockDb.Allcode, 'findOne'],
      ['getAllCodeService', 'T', mockDb.Allcode, 'findAll'],
      ['handleUpdateAllCode', { value: 'V', code: 'C' }, mockDb.Allcode, 'findOne'],
      ['getDetailAllcodeByCode', 'C', mockDb.Allcode, 'findOne'],
      ['getListAllCodeService', { type: 'T', limit: 1, offset: 0 }, mockDb.Allcode, 'findAndCountAll'],
      ['getListJobTypeAndCountPost', {}, mockDb.Post, 'findAll'],
      ['handleCreateNewSkill', { name: 'N', categoryJobCode: 'IT' }, mockDb.Skill, 'findOne'],
      ['getAllSkillByJobCode', 'getAll', mockDb.Skill, 'findAll'],
      ['getListSkill', { limit: 1, offset: 0 }, mockDb.Skill, 'findAndCountAll'],
      ['handleUpdateSkill', { id: 1, name: 'N', categoryJobCode: 'IT' }, mockDb.Skill, 'findOne'],
      ['getDetailSkillById', 1, mockDb.Skill, 'findOne']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
  });
});
