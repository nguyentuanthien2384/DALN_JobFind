const mockService = {
  handleCreateCv: jest.fn(), getAllListCvByPost: jest.fn(), getDetailCvById: jest.fn(),
  getAllCvByUserId: jest.fn(), getStatisticalCv: jest.fn(), fillterCVBySelection: jest.fn(),
  checkSeeCandiate: jest.fn()
};
const mockFindCv = jest.fn();
const mockAuth = {
  isAdmin: jest.fn(), isRecruiter: jest.fn(), getRole: jest.fn(), getCompanyId: jest.fn(),
  canAccessCompany: jest.fn(), canAccessPostApplicants: jest.fn(),
  canAccessCandidateProfile: jest.fn()
};
const mockEmitDashboardChanged = jest.fn();
const mockEmitApplicationSubmitted = jest.fn();

jest.mock('../../src/services/cvService', () => mockService);
jest.mock('../../src/models/index', () => ({ Cv: { findOne: mockFindCv } }));
jest.mock('../../src/utils/authorization', () => mockAuth);
jest.mock('../../src/config/socket', () => ({ emitDashboardChanged: mockEmitDashboardChanged }));
jest.mock('../../src/utils/eventBus', () => ({ emitApplicationSubmitted: mockEmitApplicationSubmitted }));

const controller = require('../../src/controllers/cvController');
const { createRequest, createResponse } = require('../helpers/http');

const request = () => createRequest({
  body: { userId: 999, postId: 5, file: 'cv' },
  query: { cvId: '2', postId: '5', userId: '999', candidateId: '999', companyId: '11', value: 'query' }
});

describe('cvController', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());

  beforeEach(() => {
    mockAuth.isAdmin.mockReturnValue(false);
    mockAuth.isRecruiter.mockReturnValue(true);
    mockAuth.getRole.mockReturnValue('EMPLOYER');
    mockAuth.getCompanyId.mockReturnValue(11);
    mockAuth.canAccessCompany.mockReturnValue(true);
    mockAuth.canAccessPostApplicants.mockResolvedValue(true);
    mockAuth.canAccessCandidateProfile.mockResolvedValue(true);
    mockFindCv.mockResolvedValue({ id: 2, userId: 7, postId: 5 });
  });

  test('submits a CV as the authenticated user and emits both downstream events', async () => {
    mockService.handleCreateCv.mockResolvedValueOnce({ errCode: 0, cvId: 55 });
    const res = createResponse();
    await controller.handleCreateNewCV(request(), res);
    expect(mockService.handleCreateCv).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, postId: 5 }));
    expect(mockEmitDashboardChanged).toHaveBeenCalledWith('cv');
    expect(mockEmitApplicationSubmitted).toHaveBeenCalledWith(55);
    expect(res.json).toHaveBeenCalledWith({ errCode: 0, cvId: 55 });
  });

  test('does not emit application events for failed/incomplete submissions', async () => {
    mockService.handleCreateCv.mockResolvedValueOnce({ errCode: 1 });
    await controller.handleCreateNewCV(request(), createResponse());
    expect(mockEmitDashboardChanged).not.toHaveBeenCalled();
    expect(mockEmitApplicationSubmitted).not.toHaveBeenCalled();
    mockService.handleCreateCv.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleCreateNewCV(request(), createResponse());
    expect(mockEmitDashboardChanged).toHaveBeenCalledWith('cv');
    expect(mockEmitApplicationSubmitted).not.toHaveBeenCalled();
  });

  test('post applicant list is available only when post ownership authorisation passes', async () => {
    mockAuth.canAccessPostApplicants.mockResolvedValueOnce(false);
    const denied = createResponse();
    await controller.getAllListCvByPost(request(), denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(mockService.getAllListCvByPost).not.toHaveBeenCalled();

    mockService.getAllListCvByPost.mockResolvedValueOnce({ errCode: 0 });
    await controller.getAllListCvByPost(request(), createResponse());
    expect(mockService.getAllListCvByPost).toHaveBeenCalledWith(request().query);
  });

  test('CV detail handles missing rows, owner access, recruiter access and denial', async () => {
    mockFindCv.mockResolvedValueOnce(null);
    const missing = createResponse();
    await controller.getDetailCvById(request(), missing);
    expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 2 }));

    mockFindCv.mockResolvedValueOnce({ id: 2, userId: 7, postId: 5 });
    mockService.getDetailCvById.mockResolvedValueOnce({ errCode: 0 });
    await controller.getDetailCvById(request(), createResponse());
    expect(mockService.getDetailCvById).toHaveBeenLastCalledWith({ cvId: '2', roleCode: 'CANDIDATE' });

    mockFindCv.mockResolvedValueOnce({ id: 2, userId: 99, postId: 5 });
    mockService.getDetailCvById.mockResolvedValueOnce({ errCode: 0 });
    await controller.getDetailCvById(request(), createResponse());
    expect(mockService.getDetailCvById).toHaveBeenLastCalledWith({ cvId: '2', roleCode: 'EMPLOYER' });

    mockFindCv.mockResolvedValueOnce({ id: 2, userId: 99, postId: 5 });
    mockAuth.canAccessPostApplicants.mockResolvedValueOnce(false);
    const denied = createResponse();
    await controller.getDetailCvById(request(), denied);
    expect(denied.status).toHaveBeenCalledWith(403);
  });

  test('candidate history requires self/admin/company entitlement authorization', async () => {
    mockService.getAllCvByUserId.mockResolvedValue({ errCode: 0 });
    await controller.getAllCvByUserId(request(), createResponse());
    expect(mockService.getAllCvByUserId).toHaveBeenLastCalledWith(expect.objectContaining({ userId: '999' }));

    mockAuth.canAccessCandidateProfile.mockResolvedValueOnce(false);
    const denied = createResponse();
    await controller.getAllCvByUserId(request(), denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(mockService.getAllCvByUserId).toHaveBeenCalledTimes(1);

    const self = request();
    delete self.query.userId;
    await controller.getAllCvByUserId(self, createResponse());
    expect(mockAuth.canAccessCandidateProfile).toHaveBeenLastCalledWith(self, 7);
    expect(mockService.getAllCvByUserId).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 7 }));
  });

  test('company statistics require access to the requested company', async () => {
    mockAuth.canAccessCompany.mockReturnValueOnce(false);
    const denied = createResponse();
    await controller.getStatisticalCv(request(), denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    mockService.getStatisticalCv.mockResolvedValueOnce({ errCode: 0 });
    await controller.getStatisticalCv(request(), createResponse());
    expect(mockService.getStatisticalCv).toHaveBeenCalledWith({
      ...request().query,
      companyId: 11
    });
  });

  test('candidate search is limited to recruiter/admin roles', async () => {
    mockAuth.isRecruiter.mockReturnValueOnce(false);
    mockAuth.isAdmin.mockReturnValueOnce(false);
    const denied = createResponse();
    await controller.fillterCVBySelection(request(), denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    mockService.fillterCVBySelection.mockResolvedValueOnce({ errCode: 0 });
    await controller.fillterCVBySelection(request(), createResponse());
    expect(mockService.fillterCVBySelection).toHaveBeenCalledWith(request().query);
  });

  test('candidate-view quota is charged only to the authenticated company', async () => {
    mockAuth.isAdmin.mockReturnValueOnce(true);
    const admin = createResponse();
    await controller.checkSeeCandiate(request(), admin);
    expect(admin.json).toHaveBeenCalledWith(expect.objectContaining({
      errCode: 0, alreadyGranted: true, chargedAllowance: null
    }));
    expect(mockService.checkSeeCandiate).not.toHaveBeenCalled();

    mockAuth.isRecruiter.mockReturnValueOnce(false);
    mockAuth.isAdmin.mockReturnValueOnce(false);
    const roleDenied = createResponse();
    await controller.checkSeeCandiate(request(), roleDenied);
    expect(roleDenied.status).toHaveBeenCalledWith(403);

    mockAuth.getCompanyId.mockReturnValueOnce(null);
    const noCompany = createResponse();
    await controller.checkSeeCandiate(request(), noCompany);
    expect(noCompany.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 2 }));

    mockService.checkSeeCandiate.mockResolvedValueOnce({ errCode: 0 });
    await controller.checkSeeCandiate(request(), createResponse());
    expect(mockService.checkSeeCandiate).toHaveBeenCalledWith({ companyId: 11, candidateId: '999' });
  });

  test.each([
    ['handleCreateNewCV', 'handleCreateCv'],
    ['getAllListCvByPost', 'getAllListCvByPost'],
    ['getDetailCvById', 'getDetailCvById'],
    ['getAllCvByUserId', 'getAllCvByUserId'],
    ['getStatisticalCv', 'getStatisticalCv'],
    ['fillterCVBySelection', 'fillterCVBySelection'],
    ['checkSeeCandiate', 'checkSeeCandiate']
  ])('%s returns a stable error when its service fails', async (method, serviceMethod) => {
    mockService[serviceMethod].mockRejectedValueOnce(new Error('failed'));
    if (method === 'getDetailCvById') mockFindCv.mockResolvedValueOnce({ id: 2, userId: 7, postId: 5 });
    const res = createResponse();
    await controller[method](request(), res);
    expect(res.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });
});
