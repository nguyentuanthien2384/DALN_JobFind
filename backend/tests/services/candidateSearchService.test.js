const Sequelize = require('sequelize');
const sql = new Sequelize('test', 'test', 'test', { dialect: 'mysql', logging: false });
const model = table => ({ getTableName: () => table, findAll: jest.fn(), findAndCountAll: jest.fn() });
const mockDb = { sequelize: sql, Skill: model('Skills'), UserSkill: model('UserSkills'),
    UserSetting: model('UserSettings'), User: model('Users'), Account: model('Accounts'),
    Post: model('Posts'), DetailPost: model('DetailPosts'), Allcode: model('Allcodes'), Company: { findOne: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { searchCandidates, parseCandidateFilters, skillsFromDescription, listCandidateSearchJobs } = require('../../src/services/candidateSearchService');
const query = { limit: 5, offset: 0 };

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.Skill.findAll.mockResolvedValue([]);
    mockDb.UserSkill.findAll.mockResolvedValue([]);
    mockDb.UserSetting.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
});

test.each([{ limit: 0 }, { offset: -1 }, { offset: '1e3' }, { limit: 51 }, { minMatch: 101 },
    { keyword: {} }, { keyword: 'x'.repeat(121) }, { listSkills: 'abc' }, { otherSkills: Array(31).fill('Go') },
    { skillMode: 'hack' }, { sort: 'id;DROP TABLE Users' }, { minMatch: 50 }])('rejects invalid input without DB work: %j', async input => {
    expect(await searchCandidates({ ...query, ...input })).toMatchObject({ errCode: 1, httpStatus: 400 });
    expect(mockDb.UserSetting.findAndCountAll).not.toHaveBeenCalled();
});

test('accepts arrays and comma-separated skills, deduplicates and preserves punctuation', () => {
    expect(parseCandidateFilters({ ...query, listSkills: ['8', '8'], otherSkills: 'C++,C#,.NET,C++' }))
        .toMatchObject({ listSkills: [8], otherSkills: ['C++', 'C#', '.NET'] });
});

test('rejects stale skill ids explicitly', async () => {
    expect(await searchCandidates({ ...query, listSkills: '5' })).toMatchObject({ errCode: 1 });
    expect(mockDb.UserSetting.findAndCountAll).not.toHaveBeenCalled();
});

test('returns only view counters for the authenticated company, including employer access', async () => {
    mockDb.Company.findOne.mockResolvedValue({ allowCvFree: 2, allowCv: 7, taxNumber: 'private' });
    const result = await searchCandidates({ ...query, companyId: 999 }, 5);
    expect(mockDb.Company.findOne).toHaveBeenCalledWith({ where: { id: 5 }, attributes: ['allowCvFree', 'allowCv'], raw: true });
    expect(result.allowance).toEqual({ free: 2, paid: 7 });
    expect(JSON.stringify(result)).not.toContain('private');
});

test('whitelists search output even when the database adapter returns private fields', async () => {
    mockDb.UserSetting.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: 3, userId: 9, file: 'private PDF', email: 'private@example.com',
        isTakeMail: 1, userSettingData: { id: 9, firstName: 'Lan', lastName: 'Nguyễn', email: 'private@example.com',
            address: 'private address', dob: '2000', userAccountData: { password: 'secret' } } }] });
    const result = await searchCandidates(query);
    expect(result).toMatchObject({ errCode: 0, count: 1, isHiddenPercent: true, data: [{ matchScore: null, userId: 9 }] });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|isTakeMail|password/);
    const options = mockDb.UserSetting.findAndCountAll.mock.calls[0][0];
    expect(options.attributes).not.toContain('file');
    expect(options.where.isFindJob).toBe(1);
    expect(options.include[0].include[0]).toMatchObject({ required: true, where: { roleCode: 'CANDIDATE', statusCode: 'S1' } });
});

test('deduplicates criteria and exposes explanations without re-reading PDF blobs', async () => {
    mockDb.Skill.findAll.mockResolvedValue([{ id: 8, name: 'React' }]);
    mockDb.UserSetting.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ userId: 9, matchScore: '75', matchedSkill0: 1, matchedSkill1: 0 }] });
    mockDb.UserSkill.findAll.mockResolvedValue([{ UserId: 9, Skill: { id: 8, name: 'React' } }, { UserId: 9, Skill: { id: 8, name: 'React' } }]);
    const result = await searchCandidates({ ...query, categoryJobCode: 'IT', provinceCode: 'HN', listSkills: '8', otherSkills: 'react,Node.js', minMatch: 70 });
    expect(result.data[0]).toMatchObject({ matchScore: 75, matchedSkills: ['react'], missingSkills: ['Node.js'],
        criterionCount: 4, matchedCriteria: ['categoryJobCode', 'provinceCode'], skills: [{ id: 8, name: 'React' }] });
    const options = mockDb.UserSetting.findAndCountAll.mock.calls[0][0];
    expect(options.where).toMatchObject({ categoryJobCode: 'IT', addressCode: 'HN' });
    expect(options.order[0][0].val).toBe('`matchScore`');
    expect(options.where[Sequelize.Op.and].some(condition => condition.val.includes('>= 70'))).toBe(true);
});

test.each(['any', 'all', 'rank'])('implements the %s skill mode in SQL before pagination', async skillMode => {
    await searchCandidates({ ...query, otherSkills: 'C++,C#', skillMode, offset: 10 });
    const options = mockDb.UserSetting.findAndCountAll.mock.calls[0][0];
    const conditions = options.where[Sequelize.Op.and].map(item => item.val);
    expect(options).toMatchObject({ limit: 5, offset: 10, distinct: true });
    expect(conditions.length).toBe(skillMode === 'rank' ? 1 : 2);
    if (skillMode !== 'rank') expect(conditions[1]).toContain(skillMode === 'all' ? ') AND EXISTS' : ') OR EXISTS');
});

test('escapes SQL metacharacters and treats keyword wildcards as literal text', async () => {
    await searchCandidates({ ...query, keyword: "O'Reilly 100%_", otherSkills: "C++,C#" });
    const options = mockDb.UserSetting.findAndCountAll.mock.calls[0][0];
    const clause = options.where[Sequelize.Op.and][1].val;
    expect(clause).toContain(sql.escape("o'reilly 100%_"));
    expect(clause).toContain('LOCATE(');
    expect(clause).not.toContain(' LIKE ');
});

test('job suggestions use only the authenticated company and return editable public criteria', async () => {
    mockDb.Post.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: 7, postDetailData: {
        name: 'Developer', categoryJobCode: 'IT', addressCode: 'HN', descriptionHTML: '<p>C++ and React</p>',
    } }] });
    mockDb.Skill.findAll.mockResolvedValue([{ id: 1, name: 'C', categoryJobCode: 'IT' },
        { id: 2, name: 'C++', categoryJobCode: 'IT' }, { id: 3, name: 'React', categoryJobCode: 'IT' }]);
    const result = await listCandidateSearchJobs({ companyId: 999, search: 'Developer' }, 5);
    expect(mockDb.Post.findAndCountAll.mock.calls[0][0].include[0].where).toEqual({ companyId: 5 });
    expect(result.data[0].criteria.listSkills).toEqual([{ id: 2, name: 'C++' }, { id: 3, name: 'React' }]);
    expect(JSON.stringify(result)).not.toContain('descriptionHTML');
    expect(await listCandidateSearchJobs({}, null)).toMatchObject({ httpStatus: 403 });
});

test('detects complete skill names and preserves distinctions between C, C++, C# and Java/JavaScript', () => {
    const names = ['C', 'C++', 'C#', '.NET', 'Java', 'JavaScript', 'Go'];
    expect(skillsFromDescription('C++, C# / .NET; JavaScript; Google', names.map(name => ({ name }))).map(skill => skill.name))
        .toEqual(['C++', 'C#', '.NET', 'JavaScript']);
});
