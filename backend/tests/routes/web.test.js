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
const mockAuthorize = jest.fn((permission) => {
  const middleware = jest.fn();
  middleware.permission = permission;
  return middleware;
});
const mockPermissions = new Proxy({}, { get: (_target, key) => String(key) });

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
jest.mock('../../src/middlewares/authorize', () => ({
  authorize: mockAuthorize,
  PERMISSIONS: mockPermissions
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
      'get:/', 'get:/health',
      'post:/api/create-new-user', 'post:/api/login', 'put:/api/ban-company',
      'post:/api/create-new-cv', 'put:/api/accept-post', 'post:/api/payment-success',
      'post:/api/toggle-favorite-post', 'post:/api/send-chat-message',
      'post:/internal/emit-notification'
    ]) expect(uniquePaths).toContain(endpoint);
  });

  test('exposes useful root and health responses for direct browser checks', () => {
    const latest = (path) => [...mockRoutes].reverse().find((route) => route.path === path);
    const rootResponse = createResponse();
    latest('/').handlers[0]({}, rootResponse);
    expect(rootResponse.json).toHaveBeenCalledWith({
      status: 'ok',
      service: 'legacy-monolith',
      message: 'Job Finder legacy backend is running',
      endpoints: { health: '/health', api: '/api', socket: '/socket.io' }
    });

    const healthResponse = createResponse();
    latest('/health').handlers[0]({}, healthResponse);
    expect(healthResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok', service: 'legacy-monolith', time: expect.any(String)
    }));
    expect(Number.isNaN(Date.parse(healthResponse.json.mock.calls[0][0].time))).toBe(false);
  });

  test('security-sensitive endpoints have their expected middleware', () => {
    const latest = (path) => [...mockRoutes].reverse().find((route) => route.path === path);
    expect(latest('/api/create-new-user').handlers.slice(0, 2)).toEqual([mockRegisterLimiter, mockVerifyOptional]);
    expect(latest('/api/login').handlers[0]).toBe(mockLoginLimiter);
    expect(latest('/api/ban-user').handlers[0]).toBe(mockVerifyUser);
    expect(latest('/api/ban-user').handlers[1].permission).toBe('ADMINISTRATION');
    expect(latest('/api/create-new-post').handlers[0]).toBe(mockVerifyUser);
    expect(latest('/api/create-new-post').handlers[1].permission).toBe('JOB_MANAGE');
    expect(latest('/api/get-recommended-post').handlers[0]).toBe(mockVerifyUser);
    expect(latest('/api/get-recommended-post').handlers[1].permission).toBe('RECOMMENDATION_READ');
    expect(latest('/api/get-detail-post-by-id').handlers[0]).toBe(mockVerifyOptional);
    expect(latest('/api/auth/me').handlers[1].permission).toBe('ACCOUNT_SELF');
    expect(latest('/api/request-reset-password-otp').handlers[0]).toBe(mockOtpLimiter);
    expect(latest('/api/check-phonenumber-user').handlers[0]).toBe(mockPhoneLimiter);
  });

  test('every private legacy API visibly pairs authentication with a named permission', () => {
    const exceptions = new Set([
      'post:/api/create-new-user', 'post:/api/login',
      'get:/api/check-phonenumber-user', 'post:/api/request-reset-password-otp',
      'post:/api/changepasswordbyPhone', 'get:/api/get-all-code',
      'get:/api/get-list-allcode', 'get:/api/get-detail-all-code-by-code',
      'get:/api/get-list-job-count-post', 'get:/api/get-all-skill-by-job-code',
      'get:/api/get-list-skill', 'get:/api/get-list-company',
      'get:/api/get-detail-company-by-id', 'get:/api/get-detail-post-by-id',
      'get:/api/get-filter-post', 'get:/api/get-related-post',
      'get:/api/check-favorite-post', 'get:/api/get-review-by-company',
      'get:/api/check-follow-company'
    ]);
    const latestRoutes = new Map();
    for (const route of mockRoutes) latestRoutes.set(`${route.method}:${route.path}`, route);
    for (const [key, route] of latestRoutes) {
      if (!route.path.startsWith('/api/') || exceptions.has(key)) continue;
      expect(route.handlers[0]).toBe(mockVerifyUser);
      expect(route.handlers[1]?.permission).toEqual(expect.any(String));
    }
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
