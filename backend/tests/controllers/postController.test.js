const mockService = {
  handleCreateNewPost: jest.fn(), handleReupPost: jest.fn(), handleUpdatePost: jest.fn(),
  handleBanPost: jest.fn(), handleAcceptPost: jest.fn(), getListPostByAdmin: jest.fn(),
  getAllPostByAdmin: jest.fn(), getDetailPostById: jest.fn(), handleActivePost: jest.fn(),
  getFilterPost: jest.fn(), getStatisticalTypePost: jest.fn(), getListNoteByPost: jest.fn(),
  getRelatedPost: jest.fn(), getRecommendedPost: jest.fn()
};
const mockEmitJobCreated = jest.fn();
const mockEmitJobUpdated = jest.fn();
const mockEmitDashboardChanged = jest.fn();
const mockCanAccessPostApplicants = jest.fn();

jest.mock('../../src/services/postService', () => mockService);
jest.mock('../../src/utils/eventBus', () => ({
  emitJobCreated: mockEmitJobCreated,
  emitJobUpdated: mockEmitJobUpdated
}));
jest.mock('../../src/config/socket', () => ({ emitDashboardChanged: mockEmitDashboardChanged }));
jest.mock('../../src/utils/authorization', () => ({
  canAccessPostApplicants: mockCanAccessPostApplicants
}));

const controller = require('../../src/controllers/postController');
const { createRequest, createResponse } = require('../helpers/http');

const request = (roleCode = 'EMPLOYER') => createRequest({
  body: { id: 17, postId: 18, value: 'body' },
  query: { id: '19', companyId: '999', value: 'query' },
  user: { id: 7, companyId: 11, userAccountData: { roleCode } }
});

const cases = [
  ['handleCreateNewPost', 'handleCreateNewPost', (r) => ({ ...r.body, userId: r.user.id })],
  ['handleReupPost', 'handleReupPost', (r) => ({ ...r.body, userId: r.user.id })],
  ['handleUpdatePost', 'handleUpdatePost', (r) => ({ ...r.body, userId: r.user.id })],
  ['handleBanPost', 'handleBanPost', (r) => ({ ...r.body, userId: r.user.id })],
  ['handleAcceptPost', 'handleAcceptPost', (r) => ({ ...r.body, userId: r.user.id })],
  ['getListPostByAdmin', 'getListPostByAdmin', (r) => ({ ...r.query, companyId: 11 })],
  ['getAllPostByAdmin', 'getAllPostByAdmin', (r) => r.query],
  ['getDetailPostById', 'getDetailPostById', (r) => [r.query.id, { includeNonPublic: true }]],
  ['handleActivePost', 'handleActivePost', (r) => ({ ...r.body, userId: r.user.id })],
  ['getFilterPost', 'getFilterPost', (r) => r.query],
  ['getStatisticalTypePost', 'getStatisticalTypePost', (r) => ({ ...r.query, companyId: r.user.companyId })],
  ['getListNoteByPost', 'getListNoteByPost', (r) => r.query],
  ['getRelatedPost', 'getRelatedPost', (r) => r.query],
  ['getRecommendedPost', 'getRecommendedPost', (r) => ({ ...r.query, userId: r.user.id })]
];

describe('postController', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());
  beforeEach(() => {
    mockCanAccessPostApplicants.mockReset().mockResolvedValue(true);
  });

  test.each(cases)('%s forwards input and returns a stable response', async (method, serviceMethod, expectedArg) => {
    const req = request();
    const res = createResponse();
    const result = { errCode: 2, data: method };
    mockService[serviceMethod].mockResolvedValueOnce(result);
    await controller[method](req, res);
    const expected = expectedArg(req);
    if (Array.isArray(expected)) expect(mockService[serviceMethod]).toHaveBeenCalledWith(...expected);
    else expect(mockService[serviceMethod]).toHaveBeenCalledWith(expected);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(result);
  });

  test.each(cases)('%s handles a rejected service promise', async (method, serviceMethod) => {
    mockService[serviceMethod].mockRejectedValueOnce(new Error('failed'));
    const res = createResponse();
    await controller[method](request(), res);
    expect(res.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });

  test('an employer cannot override their company filter while an admin can', async () => {
    mockService.getListPostByAdmin.mockResolvedValue({ errCode: 0 });
    await controller.getListPostByAdmin(request('EMPLOYER'), createResponse());
    expect(mockService.getListPostByAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 11 }));
    await controller.getListPostByAdmin(request('ADMIN'), createResponse());
    expect(mockService.getListPostByAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: '999' }));

    mockService.getStatisticalTypePost.mockResolvedValue({ errCode: 0 });
    await controller.getStatisticalTypePost(request('EMPLOYER'), createResponse());
    expect(mockService.getStatisticalTypePost).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 11 }));
    await controller.getStatisticalTypePost(request('ADMIN'), createResponse());
    expect(mockService.getStatisticalTypePost).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: '999' }));
  });

  test('post detail exposes non-public posts only to an authorized admin or same-company recruiter', async () => {
    mockService.getDetailPostById.mockResolvedValue({ errCode: 0 });
    const guest = request();
    delete guest.user;
    await controller.getDetailPostById(guest, createResponse());
    expect(mockService.getDetailPostById).toHaveBeenLastCalledWith('19', { includeNonPublic: false });

    mockCanAccessPostApplicants.mockResolvedValueOnce(false);
    await controller.getDetailPostById(request(), createResponse());
    expect(mockService.getDetailPostById).toHaveBeenLastCalledWith('19', { includeNonPublic: false });

    await controller.getDetailPostById(request('ADMIN'), createResponse());
    expect(mockService.getDetailPostById).toHaveBeenLastCalledWith('19', { includeNonPublic: true });
  });

  test.each([
    ['handleReupPost', 'handleReupPost'],
    ['handleUpdatePost', 'handleUpdatePost'],
    ['getListNoteByPost', 'getListNoteByPost']
  ])('%s rejects access to a post owned by another company', async (method, serviceMethod) => {
    mockCanAccessPostApplicants.mockResolvedValueOnce(false);
    mockService[serviceMethod].mockClear();
    const res = createResponse();

    await controller[method](request(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 3 }));
    expect(mockService[serviceMethod]).not.toHaveBeenCalled();
  });

  test('create and re-up emit job-created only when a new post id exists', async () => {
    mockService.handleCreateNewPost.mockResolvedValueOnce({ errCode: 0, postId: 101 });
    await controller.handleCreateNewPost(request(), createResponse());
    expect(mockEmitJobCreated).toHaveBeenCalledWith(101);
    expect(mockEmitDashboardChanged).toHaveBeenCalledWith('post');

    mockService.handleReupPost.mockResolvedValueOnce({ errCode: 0, postId: 102 });
    await controller.handleReupPost(request(), createResponse());
    expect(mockEmitJobCreated).toHaveBeenCalledWith(102);

    mockEmitJobCreated.mockClear();
    mockEmitDashboardChanged.mockClear();
    mockService.handleCreateNewPost.mockResolvedValueOnce({ errCode: 1 });
    await controller.handleCreateNewPost(request(), createResponse());
    expect(mockEmitJobCreated).not.toHaveBeenCalled();
    expect(mockEmitDashboardChanged).not.toHaveBeenCalled();
  });

  test.each([
    ['handleUpdatePost', false],
    ['handleBanPost', true],
    ['handleAcceptPost', true],
    ['handleActivePost', true]
  ])('%s emits update events and the expected dashboard invalidation', async (method, changesDashboard) => {
    mockService[method].mockResolvedValueOnce({ errCode: 0 });
    await controller[method](request(), createResponse());
    expect(mockEmitJobUpdated).toHaveBeenCalledWith(17);
    if (changesDashboard) expect(mockEmitDashboardChanged).toHaveBeenCalledWith('post');
  });

  test('updated post falls back to postId and emits nothing on failure/missing id', async () => {
    mockService.handleUpdatePost.mockResolvedValue({ errCode: 0 });
    const postIdReq = request();
    delete postIdReq.body.id;
    await controller.handleUpdatePost(postIdReq, createResponse());
    expect(mockEmitJobUpdated).toHaveBeenCalledWith(18);

    mockEmitJobUpdated.mockClear();
    mockService.handleUpdatePost.mockResolvedValueOnce({ errCode: 1 });
    await controller.handleUpdatePost(request(), createResponse());
    const noIdReq = request();
    delete noIdReq.body.id;
    delete noIdReq.body.postId;
    mockService.handleUpdatePost.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleUpdatePost(noIdReq, createResponse());
    expect(mockEmitJobUpdated).not.toHaveBeenCalled();
  });
});
