const model = () => ({ findAll: jest.fn(), findOne: jest.fn(), findAndCountAll: jest.fn() });
const mockDb = {
    FollowCompany: model(), Post: model(), UserSkill: model(), Skill: model(), UserSetting: model(),
    User: model(), Company: model(), Account: model(), DetailPost: model(), Allcode: {},
    sequelize: {}
};
jest.mock('../../src/models/index', () => mockDb);
const { Op } = require('sequelize');
const { getNotificationJobs } = require('../../src/services/notificationJobService');

const expectPublicOpenScope = query => {
    expect(query.where.statusCode).toBe('PS1');
    const deadline = query.where[Op.and][0];
    expect(deadline.attribute).toMatchObject({ val: { col: 'Post.timeEnd' }, type: 'SIGNED' });
    expect(deadline.logic[Op.gt]).toBe(Date.now());
    const owner = query.include.find(item => item.as === 'userPostData');
    expect(owner.required).toBe(true);
    expect(owner.include.find(item => item.as === 'userAccountData')).toMatchObject({
        required: true, attributes: [], where: { statusCode: 'S1' }
    });
    const company = owner.include.find(item => item.as === 'userCompanyData');
    expect(company).toMatchObject({ required: true, where: { statusCode: 'S1', censorCode: 'CS1' } });
    expect(company.attributes).not.toContain('file');
    expect(query.include.find(item => item.as === 'postDetailData').required).toBe(true);
    return owner;
};

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(2000000000000);
    mockDb.UserSkill.findAll.mockResolvedValue([]);
    mockDb.UserSetting.findOne.mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

test('only queries the viewer’s currently followed companies and excludes non-public or expired posts', async () => {
    mockDb.FollowCompany.findAll.mockResolvedValue([{ companyId: 11 }, { companyId: 12 }, { companyId: 11 }]);
    const rows = [{ id: 8, postDetailData: { name: 'Việc làm' } }];
    mockDb.Post.findAndCountAll.mockResolvedValue({ rows, count: 4 });
    expect(await getNotificationJobs({ userId: 7, source: 'followed', limit: '2', offset: '2' }))
        .toEqual({ errCode: 0, data: rows, count: 4, source: 'followed' });
    expect(mockDb.FollowCompany.findAll).toHaveBeenCalledWith({
        where: { userId: 7 }, attributes: ['companyId'], raw: true
    });
    const query = mockDb.Post.findAndCountAll.mock.calls[0][0];
    const owner = expectPublicOpenScope(query);
    expect(owner.where.companyId[Op.in]).toEqual([11, 12]);
    expect(query).toMatchObject({ limit: 2, offset: 2, distinct: true, order: [['timePost', 'DESC'], ['id', 'DESC']] });
});

test('returns an empty collection without reading unrelated jobs when the viewer follows nobody', async () => {
    mockDb.FollowCompany.findAll.mockResolvedValue([]);
    expect(await getNotificationJobs({ userId: 7, source: 'followed' }))
        .toEqual({ errCode: 0, data: [], count: 0, source: 'followed' });
    expect(mockDb.Post.findAndCountAll).not.toHaveBeenCalled();
});

test('uses only the viewer’s skills and preferences, keeps matches, and paginates a deterministic ranking', async () => {
    mockDb.UserSkill.findAll.mockResolvedValue([{ SkillId: 1 }]);
    mockDb.Skill.findAll.mockResolvedValue([{ id: 1, name: 'Node', categoryJobCode: 'IT' }]);
    mockDb.UserSetting.findOne.mockResolvedValue({ categoryJobCode: 'IT', addressCode: 'HN' });
    mockDb.Post.findAll.mockResolvedValue([
        { id: 1, timePost: '100', postDetailData: { name: 'Node Developer', categoryJobCode: 'IT', addressCode: 'HN' } },
        { id: 2, timePost: '100', postDetailData: { name: 'Node Engineer', categoryJobCode: 'IT', addressCode: 'HN' } },
        { id: 3, timePost: '200', postDetailData: { name: 'Accountant', categoryJobCode: 'FIN', addressCode: 'HCM' } },
        { id: 4, timePost: '100', postDetailData: { name: 'Node Lead', categoryJobCode: 'IT', addressCode: 'HN' } }
    ]);
    const first = await getNotificationJobs({ userId: 7, source: 'recommended', limit: 2, offset: 0 });
    const second = await getNotificationJobs({ userId: 7, source: 'recommended', limit: 2, offset: 2 });
    expect(first.data.map(item => item.id)).toEqual([4, 2]);
    expect(second.data.map(item => item.id)).toEqual([1]);
    expect(first.count).toBe(3);
    expect(second.count).toBe(3);
    expect(first.data[0].matchScore).toBe(9);
    expect(mockDb.UserSkill.findAll).toHaveBeenCalledWith({ where: { userId: 7 }, raw: true });
    expect(mockDb.UserSetting.findOne).toHaveBeenCalledWith({ where: { userId: 7 }, raw: true });
    expectPublicOpenScope(mockDb.Post.findAll.mock.calls[0][0]);
});

test('does not fall back to unrelated vacancies when there are no actual recommendations', async () => {
    mockDb.Post.findAll.mockResolvedValue([{ id: 2, postDetailData: { name: 'Unrelated job', categoryJobCode: 'OTHER' } }]);
    expect(await getNotificationJobs({ userId: 7, source: 'recommended' }))
        .toEqual({ errCode: 0, data: [], count: 0, source: 'recommended' });
});

test.each([
    { source: 'all' }, { source: ['followed'] }, { source: undefined },
    { limit: '0' }, { limit: '51' }, { limit: '-1' }, { limit: '1.5' }, { limit: '' }, { limit: [] },
    { offset: '-1' }, { offset: '1000001' }, { offset: '2e2' }, { offset: {} }, { userId: null }
])('rejects malformed or unbounded query values before reading data: %j', async extra => {
    expect((await getNotificationJobs({ userId: 7, source: 'followed', ...extra })).errCode).toBe(1);
    expect(mockDb.Post.findAll).not.toHaveBeenCalled();
    expect(mockDb.Post.findAndCountAll).not.toHaveBeenCalled();
    expect(mockDb.FollowCompany.findAll).not.toHaveBeenCalled();
});

test('uses bounded default pagination and propagates read failures', async () => {
    mockDb.FollowCompany.findAll.mockResolvedValue([{ companyId: 11 }]);
    mockDb.Post.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    await getNotificationJobs({ userId: 7, source: 'followed' });
    expect(mockDb.Post.findAndCountAll.mock.calls[0][0]).toMatchObject({ limit: 10, offset: 0 });
    mockDb.FollowCompany.findAll.mockRejectedValue(new Error('database unavailable'));
    await expect(getNotificationJobs({ userId: 7, source: 'followed' })).rejects.toThrow('database unavailable');
});
