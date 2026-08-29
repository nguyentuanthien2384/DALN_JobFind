const mockCallbacks = [];
const mockScheduleJob = jest.fn((rule, callback) => { mockCallbacks.push(callback); return {}; });
const mockDb = {
  UserSetting: { findAll: jest.fn() }, UserSkill: { findAll: jest.fn() }, Post: { findAll: jest.fn() },
  User: { findOne: jest.fn() }, Company: { findOne: jest.fn(), update: jest.fn() }, Skill: {},
  DetailPost: {}, Allcode: {},
  Sequelize: { where: jest.fn(() => 'where') },
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
    mockDb.Sequelize.where.mockReturnValue('where');
    mockDb.sequelize.col.mockReturnValue('col');
    mockDb.sequelize.literal.mockReturnValue('literal');
  });

  test('daily job builds recommendations from skills and emails opted-in users', async () => {
    scheduler.sendJobMail();
    expect(mockScheduleJob).toHaveBeenCalledTimes(1);
    mockDb.UserSetting.findAll.mockResolvedValue([{ userId: 7, categoryJobCode: 'IT', userSettingData: { email: 'a@b.com' } }]);
    mockDb.UserSkill.findAll.mockResolvedValue([{ Skill: { name: 'Node' } }]);
    mockDb.Post.findAll.mockResolvedValue([{ id: 1, userId: 8, postDetailData: {} }]);
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
    mockDb.UserSkill.findAll.mockResolvedValueOnce([]);
    mockDb.Post.findAll.mockResolvedValueOnce([]);
    await mockCallbacks[0]();
    expect(mockSendMail).not.toHaveBeenCalled();
    mockDb.UserSetting.findAll.mockRejectedValueOnce(new Error('db'));
    await expect(mockCallbacks[0]()).resolves.toBeUndefined();
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
