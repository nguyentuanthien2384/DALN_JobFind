const mockRoutes = [];
const mockRouter = {};
for (const method of ['get', 'post', 'put', 'delete']) {
  mockRouter[method] = jest.fn((path, ...handlers) => mockRoutes.push({ method, path, handlers }));
}
const mockEmitNotification = jest.fn();
const mockVerifyUser = jest.fn();
const mockVerifyAdmin = jest.fn();
const mockVerifyOptional = jest.fn();
const mockLoginLimiter = jest.fn();
const mockOtpLimiter = jest.fn();
const mockRegisterLimiter = jest.fn();
const mockPhoneLimiter = jest.fn();

jest.mock('express', () => ({ Router: jest.fn(() => mockRouter) }));
for (const path of [
  '../../src/controllers/userController', '../../src/controllers/allcodeController',
  '../../src/controllers/companyController', '../../src/controllers/postController',
  '../../src/controllers/cvController', '../../src/controllers/packagePostController',
  '../../src/controllers/packageCvController', '../../src/controllers/favoritePostController',
  '../../src/controllers/companyReviewController', '../../src/controllers/followCompanyController',
  '../../src/controllers/notificationController', '../../src/controllers/chatController'
]) {
  jest.mock(path, () => new Proxy({}, { get(target, key) {
    if (!target[key]) target[key] = jest.fn();
    return target[key];
  } }));
}
jest.mock('../../src/middlewares/jwtVerify', () => ({
  verifyTokenUser: mockVerifyUser, verifyTokenAdmin: mockVerifyAdmin, verifyTokenOptional: mockVerifyOptional
}));
jest.mock('../../src/middlewares/rateLimit', () => ({
  loginLimiter: mockLoginLimiter, otpLimiter: mockOtpLimiter,
  registerLimiter: mockRegisterLimiter, phoneCheckLimiter: mockPhoneLimiter
}));
jest.mock('../../src/config/socket', () => ({ emitNotification: mockEmitNotification }));

const initWebRoutes = require('../../src/routes/web');
const { createResponse } = require('../helpers/http');

describe('web routes', () => {
  beforeAll(() => {
    mockRoutes.length = 0;
    initWebRoutes({ use: jest.fn() });
  });

  test('registers the complete API surface and mounts the router', () => {
    const app = { use: jest.fn() };
    expect(initWebRoutes(app)).toBeUndefined();
    expect(app.use).toHaveBeenCalledWith('/', mockRouter);
    const uniquePaths = new Set(mockRoutes.map((route) => `${route.method}:${route.path}`));
    expect(uniquePaths.size).toBeGreaterThanOrEqual(80);
    for (const endpoint of [
      'post:/api/create-new-user', 'post:/api/login', 'put:/api/ban-company',
      'post:/api/create-new-cv', 'put:/api/accept-post', 'post:/api/payment-success',
      'post:/api/toggle-favorite-post', 'post:/api/send-chat-message',
      'post:/internal/emit-notification'
    ]) expect(uniquePaths).toContain(endpoint);
  });

  test('security-sensitive endpoints have their expected middleware', () => {
    const latest = (path) => [...mockRoutes].reverse().find((route) => route.path === path);
    expect(latest('/api/create-new-user').handlers.slice(0, 2)).toEqual([mockRegisterLimiter, mockVerifyOptional]);
    expect(latest('/api/login').handlers[0]).toBe(mockLoginLimiter);
    expect(latest('/api/ban-user').handlers[0]).toBe(mockVerifyAdmin);
    expect(latest('/api/create-new-post').handlers[0]).toBe(mockVerifyUser);
    expect(latest('/api/get-recommended-post').handlers[0]).toBe(mockVerifyUser);
    expect(latest('/api/request-reset-password-otp').handlers[0]).toBe(mockOtpLimiter);
    expect(latest('/api/check-phonenumber-user').handlers[0]).toBe(mockPhoneLimiter);
  });

  test('internal notification endpoint fails closed when secret is missing/wrong', () => {
    const route = [...mockRoutes].reverse().find((item) => item.path === '/internal/emit-notification');
    const handler = route.handlers[0];
    const old = process.env.INTERNAL_SECRET;
    delete process.env.INTERNAL_SECRET;
    let res = createResponse();
    handler({ headers: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    process.env.INTERNAL_SECRET = 'secret';
    res = createResponse();
    handler({ headers: { 'x-internal-secret': 'wrong' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    if (old === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = old;
  });

  test('internal notification endpoint validates payload and emits valid events', () => {
    const route = [...mockRoutes].reverse().find((item) => item.path === '/internal/emit-notification');
    const handler = route.handlers[0];
    const old = process.env.INTERNAL_SECRET;
    process.env.INTERNAL_SECRET = 'secret';
    let res = createResponse();
    handler({ headers: { 'x-internal-secret': 'secret' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const notification = { id: 1, content: 'new' };
    res = createResponse();
    handler({ headers: { 'x-internal-secret': 'secret' }, body: { userId: 7, notification } }, res);
    expect(mockEmitNotification).toHaveBeenCalledWith(7, notification);
    expect(res.json).toHaveBeenCalledWith({ errCode: 0 });
    if (old === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = old;
  });
});
