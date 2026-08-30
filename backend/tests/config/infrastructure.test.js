describe('database and view-engine infrastructure', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('connectDB reports both successful and failed authentication attempts', async () => {
    const authenticate = jest.fn().mockResolvedValueOnce(undefined);
    jest.doMock('../../src/models/index', () => ({ sequelize: { authenticate } }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    let connectDB = require('../../src/config/connectDB');

    await connectDB();
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Connection has been established successfully.');

    jest.resetModules();
    const failure = new Error('database unavailable');
    const rejectedAuthenticate = jest.fn().mockRejectedValueOnce(failure);
    jest.doMock('../../src/models/index', () => ({
      sequelize: { authenticate: rejectedAuthenticate }
    }));
    connectDB = require('../../src/config/connectDB');
    await expect(connectDB()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Unable to connect to the database:', failure);
  });

  test('view engine registers static assets and EJS locations', () => {
    const staticMiddleware = jest.fn();
    const staticFactory = jest.fn(() => staticMiddleware);
    jest.doMock('express', () => ({ static: staticFactory }));
    const configureViewEngine = require('../../src/config/viewEngine');
    const app = { use: jest.fn(), set: jest.fn() };

    configureViewEngine(app);

    expect(staticFactory).toHaveBeenCalledWith('./src/public');
    expect(app.use).toHaveBeenCalledWith(staticMiddleware);
    expect(app.set).toHaveBeenCalledWith('view engine', 'ejs');
    expect(app.set).toHaveBeenCalledWith('views', './src/views');
  });
});

describe('legacy backend bootstrap', () => {
  const originalEnv = { ...process.env };

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('wires middleware, jobs, routes, database, Socket.IO and CORS safely', () => {
    process.env.URL_REACT = 'http://frontend-one.test, http://frontend-two.test';
    process.env.PORT = '5999';
    const app = { use: jest.fn(), set: jest.fn() };
    const express = jest.fn(() => app);
    express.static = jest.fn();
    const jsonMiddleware = jest.fn();
    const urlencodedMiddleware = jest.fn();
    const bodyParser = {
      json: jest.fn(() => jsonMiddleware),
      urlencoded: jest.fn(() => urlencodedMiddleware)
    };
    const server = {
      listen: jest.fn((port, callback) => callback())
    };
    const createServer = jest.fn(() => server);
    const sendJobMail = jest.fn();
    const updateFreeViewCv = jest.fn();
    const configureViewEngine = jest.fn();
    const initWebRoutes = jest.fn();
    const connectDB = jest.fn();
    const initSocket = jest.fn();

    jest.doMock('express', () => express);
    jest.doMock('http', () => ({ createServer }));
    jest.doMock('body-parser', () => bodyParser);
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    jest.doMock('../../src/utils/schedule', () => ({ sendJobMail, updateFreeViewCv }));
    jest.doMock('../../src/config/viewEngine', () => configureViewEngine);
    jest.doMock('../../src/routes/web', () => initWebRoutes);
    jest.doMock('../../src/config/connectDB', () => connectDB);
    jest.doMock('../../src/config/socket', () => ({ initSocket }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    require('../../src/server');

    expect(express).toHaveBeenCalledTimes(1);
    expect(bodyParser.json).toHaveBeenCalledWith({ limit: '50mb' });
    expect(bodyParser.urlencoded).toHaveBeenCalledWith({ limit: '50mb', extended: true });
    expect(app.use).toHaveBeenCalledWith(jsonMiddleware);
    expect(app.use).toHaveBeenCalledWith(urlencodedMiddleware);
    expect(sendJobMail).toHaveBeenCalledTimes(1);
    expect(updateFreeViewCv).toHaveBeenCalledTimes(1);
    expect(configureViewEngine).toHaveBeenCalledWith(app);
    expect(initWebRoutes).toHaveBeenCalledWith(app);
    expect(connectDB).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledWith(app);
    expect(initSocket).toHaveBeenCalledWith(server);
    expect(server.listen).toHaveBeenCalledWith('5999', expect.any(Function));
    expect(log).toHaveBeenCalledWith('Backend Nodejs is running on the port : 5999');

    const cors = app.use.mock.calls[0][0];
    const allowedResponse = { setHeader: jest.fn(), sendStatus: jest.fn() };
    const next = jest.fn();
    cors({ method: 'GET', headers: { origin: 'http://frontend-two.test' } }, allowedResponse, next);
    expect(allowedResponse.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://frontend-two.test'
    );
    expect(allowedResponse.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
    expect(allowedResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', true);
    expect(next).toHaveBeenCalledTimes(1);

    const blockedResponse = { setHeader: jest.fn(), sendStatus: jest.fn() };
    cors({ method: 'GET', headers: { origin: 'http://unknown.test' } }, blockedResponse, jest.fn());
    expect(blockedResponse.setHeader).not.toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      expect.anything()
    );

    const preflightResponse = { setHeader: jest.fn(), sendStatus: jest.fn(() => 'sent') };
    const preflightNext = jest.fn();
    expect(cors(
      { method: 'OPTIONS', headers: { origin: 'http://frontend-one.test' } },
      preflightResponse,
      preflightNext
    )).toBe('sent');
    expect(preflightResponse.sendStatus).toHaveBeenCalledWith(204);
    expect(preflightNext).not.toHaveBeenCalled();
  });
});
