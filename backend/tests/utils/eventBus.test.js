const mockConnect = jest.fn();
const mockQuery = jest.fn();

jest.mock('amqplib', () => ({ connect: mockConnect }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../src/models/index', () => ({
  sequelize: { query: mockQuery, QueryTypes: { SELECT: 'SELECT' } }
}));

describe('eventBus', () => {
  let oldUrl;

  beforeAll(() => {
    oldUrl = process.env.RABBITMQ_URL;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    if (oldUrl === undefined) delete process.env.RABBITMQ_URL;
    else process.env.RABBITMQ_URL = oldUrl;
    console.log.mockRestore();
  });

  beforeEach(() => {
    jest.resetModules();
    mockConnect.mockReset();
    mockQuery.mockReset();
    // Keep the key present but empty so dotenv does not refill it from .env.
    process.env.RABBITMQ_URL = '';
  });

  const load = () => require('../../src/utils/eventBus');
  const job = { id: 10, name: 'Node', statusCode: 'PS1', companyId: 4 };

  const rabbit = () => {
    const handlers = {};
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn(() => true)
    };
    const connection = {
      on: jest.fn((event, callback) => { handlers[event] = callback; }),
      createChannel: jest.fn().mockResolvedValue(channel)
    };
    mockConnect.mockResolvedValue(connection);
    return { handlers, channel, connection };
  };

  test('fails closed when RabbitMQ URL is not configured and disables retries', async () => {
    const events = load();
    mockQuery.mockResolvedValue([[job]]);
    await events.emitJobCreated(10);
    await events.emitJobUpdated(10);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('[eventBus] chua dat RABBITMQ_URL, bo qua viec phat su kien', '');
  });

  test('connects once, declares a durable topic exchange and publishes created/updated jobs', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    const { channel, connection } = rabbit();
    mockQuery.mockResolvedValue([[job]]);
    const events = load();
    await events.emitJobCreated(10);
    await events.emitJobUpdated(10);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(connection.createChannel).toHaveBeenCalledTimes(1);
    expect(channel.assertExchange).toHaveBeenCalledWith('jobportal.events', 'topic', { durable: true });
    expect(channel.publish).toHaveBeenNthCalledWith(
      1, 'jobportal.events', 'job.created', expect.any(Buffer),
      { persistent: true, contentType: 'application/json' }
    );
    expect(JSON.parse(channel.publish.mock.calls[0][2].toString())).toEqual({ job });
    expect(channel.publish.mock.calls[1][1]).toBe('job.updated');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM posts p'), expect.objectContaining({
      replacements: { postId: 10 }, type: 'SELECT'
    }));
  });

  test('skips missing jobs and tolerates database query failures', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    rabbit();
    const events = load();
    mockQuery.mockResolvedValueOnce([[]]);
    await expect(events.emitJobCreated(10)).resolves.toBeUndefined();
    expect(mockConnect).not.toHaveBeenCalled();
    mockQuery.mockRejectedValueOnce(new Error('db'));
    await expect(events.emitJobUpdated(10)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('[eventBus] khong tai duoc tin de phat job.updated', 'db');
  });

  test('connection failures and publish failures never reject the caller', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    mockQuery.mockResolvedValue([[job]]);
    mockConnect.mockRejectedValueOnce(new Error('offline'));
    let events = load();
    await expect(events.emitJobCreated(10)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('[eventBus] khong ket noi duoc RabbitMQ', 'offline');

    jest.resetModules();
    const { channel } = rabbit();
    channel.publish.mockImplementationOnce(() => { throw new Error('closed'); });
    events = load();
    await expect(events.emitJobCreated(10)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('[eventBus] phat job.created that bai', 'closed');
  });

  test('connection events are wired and close permits a clean reconnect', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    const first = rabbit();
    mockQuery.mockResolvedValue([[job]]);
    const events = load();
    await events.emitJobCreated(10);
    first.handlers.error(new Error('socket'));
    expect(console.log).toHaveBeenCalledWith('[eventBus] loi ket noi', 'socket');
    first.handlers.close();
    const second = rabbit();
    await events.emitJobUpdated(10);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(second.channel.publish).toHaveBeenCalled();
  });

  test('maps a submitted application into the cross-service event schema', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    const { channel } = rabbit();
    const row = {
      cvId: 5, jobId: 10, jobTitle: 'Node Engineer', candidateId: 7,
      firstName: 'An', lastName: 'Nguyen', email: 'an@example.com', phonenumber: '0901',
      companyId: 4, posterId: 8, description: 'cover', createdAt: '2026-01-01'
    };
    mockQuery.mockResolvedValue([[row]]);
    const events = load();
    await events.emitApplicationSubmitted(5);
    expect(channel.publish.mock.calls[0][1]).toBe('application.submitted');
    expect(JSON.parse(channel.publish.mock.calls[0][2].toString())).toEqual({
      cvId: 5, jobId: 10, jobTitle: 'Node Engineer', candidateId: 7,
      candidateName: 'An Nguyen', candidateEmail: 'an@example.com', candidatePhone: '0901',
      companyId: 4, posterId: 8, coverLetter: 'cover', appliedAt: '2026-01-01'
    });
  });

  test('publishes company approval/activity changes for public search filtering', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    const { channel } = rabbit();
    const company = {
      companyId: 4, companyStatusCode: 'S2', companyCensorCode: 'CS1'
    };
    mockQuery.mockResolvedValue([[company]]);
    const events = load();
    await events.emitCompanyUpdated(4);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM companies'), expect.objectContaining({
      replacements: { companyId: 4 }, type: 'SELECT'
    }));
    expect(channel.publish.mock.calls[0][1]).toBe('company.updated');
    expect(JSON.parse(channel.publish.mock.calls[0][2].toString())).toEqual(company);
  });

  test('application event skips orphan rows, supports absent names, and swallows DB errors', async () => {
    process.env.RABBITMQ_URL = 'amqp://rabbit';
    const { channel } = rabbit();
    const events = load();
    mockQuery.mockResolvedValueOnce([[{ cvId: 1, companyId: null }]]);
    await events.emitApplicationSubmitted(1);
    expect(channel.publish).not.toHaveBeenCalled();

    mockQuery.mockResolvedValueOnce([[{
      cvId: 2, companyId: 4, firstName: null, lastName: null
    }]]);
    await events.emitApplicationSubmitted(2);
    expect(JSON.parse(channel.publish.mock.calls[0][2].toString()).candidateName).toBeNull();

    mockQuery.mockRejectedValueOnce(new Error('db'));
    await expect(events.emitApplicationSubmitted(3)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('[eventBus] khong tai duoc CV de phat application.submitted', 'db');
  });
});
