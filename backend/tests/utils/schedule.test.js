const mockCallbacks = [];
const mockScheduleJob = jest.fn((rule, callback) => { mockCallbacks.push(callback); return {}; });
const mockDb = {
  UserSetting: { findAll: jest.fn() }, UserSkill: { findAll: jest.fn() }, Post: { findAll: jest.fn() },
  User: { findOne: jest.fn() }, Company: { findOne: jest.fn(), update: jest.fn() }, Skill: {},
  DetailPost: {}, Allcode: {},
  Sequelize: { where: jest.fn(() => 'where'), cast: jest.fn((column, type) => ({ cast: column, type })) },
  sequelize: { col: jest.fn(() => 'col'), literal: jest.fn(() => 'literal') }
};
const mockMailTemplate = jest.fn();
const mockSendMail = jest.fn();

jest.mock('node-schedule', () => ({
  RecurrenceRule: jest.fn(function RecurrenceRule() {}),
  scheduleJob: mockScheduleJob
}));
jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/mailTemplate', () => mockMailTemplate);
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const scheduler = require('../../src/utils/schedule');

describe('scheduled jobs', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());
  beforeEach(() => {
    mockCallbacks.length = 0;
    jest.clearAllMocks();
    mockDb.Sequelize.where.mockImplementation((left, right) => ({ left, right }));
    mockDb.Sequelize.cast.mockImplementation((column, type) => ({ cast: column, type }));
    mockDb.sequelize.col.mockImplementation((name) => ({ col: name }));
    mockDb.sequelize.literal.mockReturnValue('literal');
  });

  test('daily job builds recommendations from skills and emails opted-in users', async () => {
    scheduler.sendJobMail();
    expect(mockScheduleJob).toHaveBeenCalledTimes(1);
    mockDb.UserSetting.findAll.mockResolvedValue([{ userId: 7, categoryJobCode: 'IT', userSettingData: { email: 'a@b.com' } }]);
    mockDb.UserSkill.findAll.mockResolvedValue([{ Skill: { name: 'Node' } }]);
    mockDb.Post.findAll.mockResolvedValue([{ id: 1, userId: 8, postDetailData: { descriptionHTML: '<p>Node.js backend</p>' } }]);
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValue({ id: 4, name: 'Acme' });
    mockMailTemplate.mockReturnValue('<html>jobs</html>');
    await mockCallbacks[0]();
    expect(mockMailTemplate).toHaveBeenCalledWith([expect.objectContaining({ companyData: expect.objectContaining({ id: 4 }) })], expect.objectContaining({ userId: 7 }));
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.com', html: '<html>jobs</html>' }), expect.any(Function));
  });

  test('daily job skips email when no matching post and absorbs query errors', async () => {
    scheduler.sendJobMail();
    mockDb.UserSetting.findAll.mockResolvedValueOnce([{ userId: 7, categoryJobCode: 'IT', userSettingData: { email: 'a@b.com' } }]);
    mockDb.UserSkill.findAll.mockResolvedValueOnce([{ Skill: { name: 'Node' } }]);
    mockDb.Post.findAll.mockResolvedValueOnce([]);
    await mockCallbacks[0]();
    expect(mockDb.Post.findAll).toHaveBeenCalledTimes(1);
    expect(mockSendMail).not.toHaveBeenCalled();
    mockDb.UserSetting.findAll.mockRejectedValueOnce(new Error('db'));
    await expect(mockCallbacks[0]()).resolves.toBeUndefined();
  });

  const runDailyMail = async ({ posts, users = {}, companies = {}, skills = ['Node'] }) => {
    scheduler.sendJobMail();
    mockDb.UserSetting.findAll.mockResolvedValue([{ userId: 7, categoryJobCode: 'IT', userSettingData: { email: 'a@b.com' } }]);
    mockDb.UserSkill.findAll.mockResolvedValue(skills.map((name) => ({ Skill: { name } })));
    mockDb.Post.findAll.mockResolvedValue(posts.map((post) => ({ postDetailData: { descriptionHTML: 'Node.js backend' }, ...post })));
    mockDb.User.findOne.mockImplementation(async ({ where }) => users[where.id] ?? null);
    mockDb.Company.findOne.mockImplementation(async ({ where }) => companies[where.id] ?? null);
    mockMailTemplate.mockImplementation((list) => list.map((post) => post.id).join(','));
    await mockCallbacks[mockCallbacks.length - 1]();
  };

  test('daily job only recommends jobs whose application deadline has not passed', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await runDailyMail({ posts: [] });
    now.mockRestore();
    const conditions = mockDb.Post.findAll.mock.calls[0][0].where[require('sequelize').Op.and];
    expect(conditions).toContainEqual({ left: { cast: { col: 'Post.timeEnd' }, type: 'SIGNED' }, right: { [require('sequelize').Op.gt]: 1_800_000_000_000 } });
    expect(mockDb.Post.findAll.mock.calls[0][0].where.statusCode).toBe('PS1');
  });

  test('daily job filters by the candidate category and every saved skill', async () => {
    const { Op } = require('sequelize');
    await runDailyMail({ posts: [] });
    const conditions = mockDb.Post.findAll.mock.calls[0][0].where[Op.and];
    expect(conditions).toContainEqual({ left: { col: 'postDetailData.jobTypePostData.code' }, right: { [Op.like]: '%IT%' } });
    expect(conditions).toContainEqual({ left: { col: 'postDetailData.descriptionHTML' }, right: { [Op.or]: [{ [Op.like]: '%Node%' }] } });
  });

  test('a post whose author or company is gone is skipped without dropping the whole email', async () => {
    await runDailyMail({
      posts: [{ id: 1, userId: 8 }, { id: 2, userId: 9 }, { id: 3, userId: 10 }, { id: 4, userId: 11 }],
      users: { 8: { companyId: 4 }, 10: { companyId: null }, 11: { companyId: 5 } },
      companies: { 4: { id: 4, name: 'Acme' } }
    });
    expect(mockMailTemplate).toHaveBeenCalledWith([expect.objectContaining({ id: 1, companyData: { id: 4, name: 'Acme' } })], expect.anything());
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.com', html: '1' }), expect.any(Function));
  });

  test('no email is sent when none of the matching posts still has a company', async () => {
    await runDailyMail({ posts: [{ id: 1, userId: 8 }], users: { 8: { companyId: 4 } } });
    expect(mockMailTemplate).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('a failed SMTP send is logged and does not throw from the scheduled job', async () => {
    mockSendMail.mockImplementationOnce((options, callback) => callback(new Error('smtp down')));
    await runDailyMail({ posts: [{ id: 1, userId: 8 }], users: { 8: { companyId: 4 } }, companies: { 4: { id: 4 } } });
    expect(console.log).toHaveBeenCalledWith(expect.objectContaining({ message: 'smtp down' }));
  });

  test('candidates without any usable skill get no suggestion instead of random jobs of their category', async () => {
    scheduler.sendJobMail();
    mockDb.UserSetting.findAll.mockResolvedValue([
      { userId: 7, categoryJobCode: 'IT', userSettingData: { email: 'none@b.com' } },
      { userId: 8, categoryJobCode: 'IT', userSettingData: { email: 'deleted@b.com' } },
      { userId: 9, categoryJobCode: 'IT', userSettingData: { email: 'ok@b.com' } }
    ]);
    mockDb.UserSkill.findAll.mockImplementation(async ({ where }) => ({
      7: [], 8: [{ Skill: { name: null } }, { Skill: {} }], 9: [{ Skill: { name: 'Node' } }]
    })[where.userId]);
    mockDb.Post.findAll.mockResolvedValue([{ id: 1, userId: 5, postDetailData: { descriptionHTML: 'Node.js' } }]);
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValue({ id: 4 });
    mockMailTemplate.mockReturnValue('<html>jobs</html>');
    await mockCallbacks[mockCallbacks.length - 1]();
    expect(mockDb.Post.findAll).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ok@b.com' }), expect.any(Function));
  });

  test('a short skill such as "C" only suggests jobs that name it, not every job containing the letter', async () => {
    await runDailyMail({
      skills: ['C'],
      posts: [
        { id: 1, userId: 8, postDetailData: { descriptionHTML: '<p>React và Docker</p>' } },
        { id: 2, userId: 8, postDetailData: { descriptionHTML: '<p>Lập trình C++ và C#</p>' } },
        { id: 3, userId: 8, postDetailData: { descriptionHTML: '<p>Ngôn ngữ C cho hệ nhúng</p>' } },
        { id: 4, userId: 8, postDetailData: {} }
      ],
      users: { 8: { companyId: 4 } }, companies: { 4: { id: 4 } }
    });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ html: '3' }), expect.any(Function));
    expect(mockDb.Post.findAll.mock.calls[0][0].where[require('sequelize').Op.and])
      .toContainEqual({ left: { col: 'postDetailData.descriptionHTML' }, right: { [require('sequelize').Op.or]: [{ [require('sequelize').Op.like]: '%C%' }] } });
  });

  test('draws from a larger random pool but sends at most five matching jobs', async () => {
    await runDailyMail({
      posts: Array.from({ length: 8 }, (_, index) => ({ id: index + 1, userId: 8 })),
      users: { 8: { companyId: 4 } }, companies: { 4: { id: 4 } }
    });
    expect(mockDb.Post.findAll.mock.calls[0][0].limit).toBe(50);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ html: '1,2,3,4,5' }), expect.any(Function));
    expect(mockDb.User.findOne).toHaveBeenCalledTimes(5);
  });

  test('monthly/free quota job resets all companies and handles failures', async () => {
    scheduler.updateFreeViewCv();
    expect(mockScheduleJob).toHaveBeenCalledTimes(1);
    mockDb.Company.update.mockResolvedValueOnce([3]);
    await mockCallbacks[0]();
    expect(mockDb.Company.update).toHaveBeenCalledWith(
      { allowCvFree: 5 },
      expect.objectContaining({ where: expect.any(Object), silent: true })
    );
    mockDb.Company.update.mockRejectedValueOnce(new Error('db'));
    await expect(mockCallbacks[0]()).resolves.toBeUndefined();
  });
});
