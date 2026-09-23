const mockService = {
  uploadChatAttachment: jest.fn(),
  readChatAttachment: jest.fn(),
  listChatJobs: jest.fn(),
};
jest.mock('../../src/services/chatMediaService', () => mockService);

const controller = require('../../src/controllers/chatMediaController');

const response = () => {
  const res = { set: jest.fn(), json: jest.fn() };
  res.status = jest.fn(() => res);
  return res;
};
const request = (overrides = {}) => ({
  user: { id: 7 },
  body: {},
  params: {},
  query: {},
  ...overrides,
});
const expectPrivateJson = (res, status, payload) => {
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.json).toHaveBeenCalledWith(payload);
};

beforeEach(() => jest.resetAllMocks());

test('upload uses the verified account and returns only the service metadata', async () => {
  const body = {
    userId: 999, receiverId: 8, fileName: 'CV.pdf',
    fileBase64: Buffer.from('%PDF-example').toString('base64'),
  };
  const result = { errCode: 0, data: {
    id: 'attachment-id', name: 'CV.pdf', mimeType: 'application/pdf', size: 12, pageCount: 1,
  } };
  mockService.uploadChatAttachment.mockResolvedValue(result);
  const res = response();
  await controller.upload(request({ body }), res);

  expect(mockService.uploadChatAttachment).toHaveBeenCalledTimes(1);
  expect(mockService.uploadChatAttachment).toHaveBeenCalledWith(7, body);
  expectPrivateJson(res, 200, result);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('fileBase64');
});

test('read uses the URL id and verified account, preserving the base64 PDF response', async () => {
  const result = { errCode: 0, data: {
    id: 'url-attachment', name: 'CV.pdf', mimeType: 'application/pdf',
    size: 12, pageCount: 1, fileBase64: 'JVBERi0xLjQ=',
  } };
  mockService.readChatAttachment.mockResolvedValue(result);
  const res = response();
  await controller.read(request({
    body: { id: 'untrusted-body', userId: 999 },
    query: { id: 'untrusted-query', userId: 999 },
    params: { id: 'url-attachment' },
  }), res);

  expect(mockService.readChatAttachment).toHaveBeenCalledTimes(1);
  expect(mockService.readChatAttachment).toHaveBeenCalledWith(7, 'url-attachment');
  expectPrivateJson(res, 200, result);
  expect(res.send).toBeUndefined();
});

test('jobs passes the search and pagination query with the verified account', async () => {
  const query = { userId: 999, partnerId: '8', search: 'Backend', limit: '5', offset: '10' };
  const result = { errCode: 0, data: [{ id: 41, name: 'Backend developer' }], count: 1 };
  mockService.listChatJobs.mockResolvedValue(result);
  const res = response();
  await controller.jobs(request({ query }), res);

  expect(mockService.listChatJobs).toHaveBeenCalledTimes(1);
  expect(mockService.listChatJobs).toHaveBeenCalledWith(7, query);
  expectPrivateJson(res, 200, result);
});

test.each([
  ['upload', 'uploadChatAttachment', 400, { errCode: 1, httpStatus: 400, errMessage: 'PDF không hợp lệ' }],
  ['upload', 'uploadChatAttachment', 403, { errCode: 5, httpStatus: 403, errMessage: 'Không có quyền gửi' }],
  ['upload', 'uploadChatAttachment', 429, { errCode: 1, httpStatus: 429, errMessage: 'Tải quá nhanh' }],
  ['read', 'readChatAttachment', 404, { errCode: 1, httpStatus: 404, errMessage: 'Không tìm thấy tài liệu' }],
  ['read', 'readChatAttachment', 403, { errCode: 5, httpStatus: 403, errMessage: 'Không có quyền xem' }],
  ['jobs', 'listChatJobs', 400, { errCode: 1, httpStatus: 400, errMessage: 'Tham số không hợp lệ' }],
  ['jobs', 'listChatJobs', 403, { errCode: 5, httpStatus: 403, errMessage: 'Không có quyền xem tin' }],
])('%s preserves %s validation result and HTTP %i', async (method, serviceMethod, status, result) => {
  mockService[serviceMethod].mockResolvedValue(result);
  const res = response();
  await controller[method](request({ params: { id: 'attachment-id' } }), res);
  expectPrivateJson(res, status, result);
});

test.each([
  ['upload', 'uploadChatAttachment'],
  ['read', 'readChatAttachment'],
  ['jobs', 'listChatJobs'],
])('%s hides internal service errors and still sets private response headers', async (method, serviceMethod) => {
  mockService[serviceMethod].mockRejectedValue(new Error('database failure: private file and credentials'));
  const res = response();
  await controller[method](request({ params: { id: 'attachment-id' } }), res);
  expectPrivateJson(res, 503, {
    errCode: -1,
    errMessage: 'Chưa xử lý được tài liệu hoặc tin tuyển dụng. Vui lòng thử lại.',
  });
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private file');
});

test('missing JSON body reaches upload validation instead of becoming a server error', async () => {
  const invalid = { errCode: 5, httpStatus: 403, errMessage: 'Không có quyền gửi' };
  mockService.uploadChatAttachment.mockResolvedValue(invalid);
  const res = response();
  await controller.upload(request({ body: null }), res);
  expect(mockService.uploadChatAttachment).toHaveBeenCalledWith(7, {});
  expectPrivateJson(res, 403, invalid);
});

test('missing query reaches job search validation instead of becoming a server error', async () => {
  const invalid = { errCode: 1, httpStatus: 400, errMessage: 'Tham số không hợp lệ' };
  mockService.listChatJobs.mockResolvedValue(invalid);
  const res = response();
  await controller.jobs(request({ query: null }), res);
  expect(mockService.listChatJobs).toHaveBeenCalledWith(7, {});
  expectPrivateJson(res, 400, invalid);
});

test('missing URL parameter reaches attachment validation instead of becoming a server error', async () => {
  const invalid = { errCode: 1, httpStatus: 404, errMessage: 'Không tìm thấy tài liệu' };
  mockService.readChatAttachment.mockResolvedValue(invalid);
  const res = response();
  await controller.read(request({ params: undefined }), res);
  expect(mockService.readChatAttachment).toHaveBeenCalledWith(7, undefined);
  expectPrivateJson(res, 404, invalid);
});
