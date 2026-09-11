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
    await expect(connectDB()).rejects.toBe(failure);
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
  const originalExitCode = process.exitCode;

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exitCode = originalExitCode;
    jest.useRealTimers();
    jest.resetModules();
    jest.restoreAllMocks();
  });

  const mockBootstrap = ({ databaseReady = Promise.resolve(), listenError } = {}) => {
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
    const { EventEmitter } = require('events');
    const server = new EventEmitter();
    server.listen = jest.fn((port, callback) => {
      if (listenError) server.emit('error', listenError);
      else {
        server.listening = true;
        callback();
      }
    });
    server.close = jest.fn((callback) => callback());
    const createServer = jest.fn(() => server);
    const sendJobMail = jest.fn();
    const updateFreeViewCv = jest.fn();
    const configureViewEngine = jest.fn();
    const initWebRoutes = jest.fn();
    const connectDB = jest.fn(() => databaseReady);
    const socketServer = { close: jest.fn((callback) => callback()) };
    const initSocket = jest.fn(() => socketServer);
    const closeDatabase = jest.fn().mockResolvedValue(undefined);
    const gracefulShutdown = jest.fn().mockResolvedValue(undefined);

    jest.doMock('express', () => express);
    jest.doMock('http', () => ({ createServer }));
    jest.doMock('body-parser', () => bodyParser);
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    jest.doMock('../../src/utils/schedule', () => ({ sendJobMail, updateFreeViewCv }));
    jest.doMock('../../src/config/viewEngine', () => configureViewEngine);
    jest.doMock('../../src/routes/web', () => initWebRoutes);
    jest.doMock('../../src/config/connectDB', () => connectDB);
    jest.doMock('../../src/config/socket', () => ({ initSocket }));
    jest.doMock('../../src/models/index', () => ({ sequelize: { close: closeDatabase } }));
    jest.doMock('node-schedule', () => ({ gracefulShutdown }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const once = jest.spyOn(process, 'once').mockImplementation(() => process);
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    return {
      app, express, bodyParser, jsonMiddleware, urlencodedMiddleware, server,
      createServer, sendJobMail, updateFreeViewCv, configureViewEngine, initWebRoutes,
      connectDB, initSocket, socketServer, closeDatabase, gracefulShutdown, log, error,
      once, exit
    };
  };

  test('wires middleware, jobs, routes, database, Socket.IO and CORS safely', async () => {
    delete process.env.SCHEDULED_JOBS_ENABLED;
    const {
      app, express, bodyParser, jsonMiddleware, urlencodedMiddleware, server,
      createServer, sendJobMail, updateFreeViewCv, configureViewEngine, initWebRoutes,
      connectDB, initSocket, log
    } = mockBootstrap();

    await require('../../src/server').startup;

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
    expect(allowedResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', expect.stringContaining('Idempotency-Key'));
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

  test('waits for the real database before opening the API or scheduling jobs', async () => {
    let resolveDatabase;
    const databaseReady = new Promise((resolve) => { resolveDatabase = resolve; });
    const mocks = mockBootstrap({ databaseReady });
    const { startup } = require('../../src/server');

    expect(mocks.connectDB).toHaveBeenCalledTimes(1);
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.sendJobMail).not.toHaveBeenCalled();
    expect(mocks.updateFreeViewCv).not.toHaveBeenCalled();

    resolveDatabase();
    await expect(startup).resolves.toBe(mocks.server);
    expect(mocks.server.listen).toHaveBeenCalledTimes(1);
  });

  test('can disable both scheduled mail delivery and daily quota resets locally', async () => {
    process.env.SCHEDULED_JOBS_ENABLED = 'false';
    const mocks = mockBootstrap();
    await require('../../src/server').startup;

    expect(mocks.server.listen).toHaveBeenCalledTimes(1);
    expect(mocks.sendJobMail).not.toHaveBeenCalled();
    expect(mocks.updateFreeViewCv).not.toHaveBeenCalled();
  });

  test('fails startup and closes the DB pool without listening when authentication fails', async () => {
    const mocks = mockBootstrap({ databaseReady: Promise.reject(new Error('database unavailable')) });
    await require('../../src/server').startup;

    expect(process.exitCode).toBe(1);
    expect(mocks.error).toHaveBeenCalledWith('Backend startup failed:', 'database unavailable');
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.sendJobMail).not.toHaveBeenCalled();
    expect(mocks.updateFreeViewCv).not.toHaveBeenCalled();
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
  });

  test('cleans up Socket.IO and the DB pool when its port cannot be opened', async () => {
    const mocks = mockBootstrap({ listenError: new Error('address already in use') });
    await require('../../src/server').startup;

    expect(process.exitCode).toBe(1);
    expect(mocks.error).toHaveBeenCalledWith('Backend startup failed:', 'address already in use');
    expect(mocks.socketServer.close).toHaveBeenCalledTimes(1);
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.sendJobMail).not.toHaveBeenCalled();
    expect(mocks.updateFreeViewCv).not.toHaveBeenCalled();
  });

  test('shutdown closes scheduler, socket clients, HTTP server and DB pool only once', async () => {
    const mocks = mockBootstrap();
    const runtime = require('../../src/server');
    await runtime.startup;
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(mocks.gracefulShutdown).toHaveBeenCalledTimes(1);
    expect(mocks.socketServer.close).toHaveBeenCalledTimes(1);
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.gracefulShutdown.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.closeDatabase.mock.invocationCallOrder[0]);
  });

  test('stopping the service exits after cleanup finishes', async () => {
    jest.useFakeTimers();
    const mocks = mockBootstrap();
    const runtime = require('../../src/server');
    await runtime.startup;
    const stop = mocks.once.mock.calls.find(([signal]) => signal === 'SIGTERM')[1];

    stop();
    await runtime.shutdown();
    await Promise.resolve();
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.exit).toHaveBeenCalledWith(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('startup also reports cleanup failures while preserving a failing exit code', async () => {
    const mocks = mockBootstrap({ databaseReady: Promise.reject(new Error('database unavailable')) });
    mocks.closeDatabase.mockRejectedValueOnce(new Error('pool close failed'));
    await require('../../src/server').startup;

    expect(process.exitCode).toBe(1);
    expect(mocks.error).toHaveBeenCalledWith('Backend cleanup failed:', 'pool close failed');
  });
});
