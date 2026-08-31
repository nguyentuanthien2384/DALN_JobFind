const { createRequest, createResponse } = require('../helpers/http');

jest.mock('../../src/services/allcodeService', () => ({
  handleCreateNewAllCode: jest.fn(), getAllCodeService: jest.fn(), handleUpdateAllCode: jest.fn(),
  getDetailAllcodeByCode: jest.fn(), handleDeleteAllCode: jest.fn(), getListAllCodeService: jest.fn(),
  getListJobTypeAndCountPost: jest.fn(), handleCreateNewSkill: jest.fn(), handleDeleteSkill: jest.fn(),
  getAllSkillByJobCode: jest.fn(), getListSkill: jest.fn(), handleUpdateSkill: jest.fn(),
  getDetailSkillById: jest.fn()
}));
jest.mock('../../src/services/companyService', () => ({
  handleCreateNewCompany: jest.fn(), handleUpdateCompany: jest.fn(), handleBanCompany: jest.fn(),
  handleUnBanCompany: jest.fn(), handleAddUserCompany: jest.fn(), getListCompany: jest.fn(),
  getDetailCompanyById: jest.fn(), getDetailCompanyByUserId: jest.fn(), getAllUserByCompanyId: jest.fn(),
  handleQuitCompany: jest.fn(), getAllCompanyByAdmin: jest.fn(), handleAccecptCompany: jest.fn()
}));
jest.mock('../../src/services/companyReviewService', () => ({
  handleCreateReview: jest.fn(), getReviewByCompany: jest.fn(), handleDeleteReview: jest.fn()
}));
jest.mock('../../src/services/favoritePostService', () => ({
  handleToggleFavoritePost: jest.fn(), checkFavoriteByUser: jest.fn(), getFavoritePostByUser: jest.fn()
}));
jest.mock('../../src/services/followCompanyService', () => ({
  handleToggleFollowCompany: jest.fn(), checkFollowCompany: jest.fn(), getFollowedCompanyByUser: jest.fn()
}));
jest.mock('../../src/services/notificationService', () => ({
  getNotificationByUser: jest.fn(), handleMarkReadNotification: jest.fn()
}));
jest.mock('../../src/services/packageCvService', () => ({
  getAllPackage: jest.fn(), getAllToSelect: jest.fn(), getPackageById: jest.fn(), getPaymentLink: jest.fn(),
  paymentOrderSuccess: jest.fn(), setActiveTypePackage: jest.fn(), creatNewPackageCv: jest.fn(),
  updatePackageCv: jest.fn(), getStatisticalPackage: jest.fn(), getHistoryTrade: jest.fn(), getSumByYear: jest.fn()
}));
jest.mock('../../src/services/packagePostService', () => ({
  getAllPackage: jest.fn(), getPackageByType: jest.fn(), getPackageById: jest.fn(), getPaymentLink: jest.fn(),
  paymentOrderSuccess: jest.fn(), setActiveTypePackage: jest.fn(), creatNewPackagePost: jest.fn(),
  updatePackagePost: jest.fn(), getStatisticalPackage: jest.fn(), getHistoryTrade: jest.fn(), getSumByYear: jest.fn()
}));
jest.mock('../../src/config/socket', () => ({ emitDashboardChanged: jest.fn() }));
jest.mock('../../src/utils/eventBus', () => ({ emitCompanyUpdated: jest.fn() }));

const allcodeService = require('../../src/services/allcodeService');
const companyService = require('../../src/services/companyService');
const reviewService = require('../../src/services/companyReviewService');
const favoriteService = require('../../src/services/favoritePostService');
const followService = require('../../src/services/followCompanyService');
const notificationService = require('../../src/services/notificationService');
const packageCvService = require('../../src/services/packageCvService');
const packagePostService = require('../../src/services/packagePostService');
const socket = require('../../src/config/socket');
const events = require('../../src/utils/eventBus');

const allcodeController = require('../../src/controllers/allcodeController');
const companyController = require('../../src/controllers/companyController');
const reviewController = require('../../src/controllers/companyReviewController');
const favoriteController = require('../../src/controllers/favoritePostController');
const followController = require('../../src/controllers/followCompanyController');
const notificationController = require('../../src/controllers/notificationController');
const packageCvController = require('../../src/controllers/packageCvController');
const packagePostController = require('../../src/controllers/packagePostController');

const baseRequest = () => createRequest({
  body: { id: 21, code: 'CODE', data: { id: 31 }, userId: 999, value: 'body' },
  query: { id: '41', code: 'QUERY', type: 'TYPE', categoryJobCode: 'IT', userId: 999, value: 'query' }
});

const body = (req) => req.body;
const query = (req) => req.query;

const cases = [
  [allcodeController, 'handleCreateNewAllCode', allcodeService, 'handleCreateNewAllCode', body],
  [allcodeController, 'getAllCodeService', allcodeService, 'getAllCodeService', (r) => r.query.type],
  [allcodeController, 'handleUpdateAllCode', allcodeService, 'handleUpdateAllCode', body],
  [allcodeController, 'getDetailAllcodeByCode', allcodeService, 'getDetailAllcodeByCode', (r) => r.query.code],
  [allcodeController, 'handleDeleteAllCode', allcodeService, 'handleDeleteAllCode', (r) => r.body.code],
  [allcodeController, 'getListAllCodeService', allcodeService, 'getListAllCodeService', query],
  [allcodeController, 'getListJobTypeAndCountPost', allcodeService, 'getListJobTypeAndCountPost', query],
  [allcodeController, 'handleCreateNewSkill', allcodeService, 'handleCreateNewSkill', body],
  [allcodeController, 'handleDeleteSkill', allcodeService, 'handleDeleteSkill', (r) => r.body.id],
  [allcodeController, 'getAllSkillByJobCode', allcodeService, 'getAllSkillByJobCode', (r) => r.query.categoryJobCode],
  [allcodeController, 'getListSkill', allcodeService, 'getListSkill', query],
  [allcodeController, 'handleUpdateSkill', allcodeService, 'handleUpdateSkill', body],
  [allcodeController, 'getDetailSkillById', allcodeService, 'getDetailSkillById', (r) => r.query.id],

  [companyController, 'handleCreateNewCompany', companyService, 'handleCreateNewCompany', (r) => ({ ...r.body, userId: r.user.id })],
  [companyController, 'handleUpdateCompany', companyService, 'handleUpdateCompany', (r) => ({ ...r.body, id: r.user.companyId })],
  [companyController, 'handleBanCompany', companyService, 'handleBanCompany', (r) => r.body.id],
  [companyController, 'handleUnBanCompany', companyService, 'handleUnBanCompany', (r) => r.body.id],
  [companyController, 'handleAddUserCompany', companyService, 'handleAddUserCompany', (r) => ({ ...r.body, companyId: r.user.companyId })],
  [companyController, 'getListCompany', companyService, 'getListCompany', query],
  [companyController, 'getDetailCompanyById', companyService, 'getDetailCompanyById', (r) => r.query.id],
  [companyController, 'getDetailCompanyByUserId', companyService, 'getDetailCompanyByUserId', (r) => ({ userId: r.user.id, companyId: r.user.companyId })],
  [companyController, 'getAllUserByCompanyId', companyService, 'getAllUserByCompanyId', (r) => ({ ...r.query, companyId: r.user.companyId })],
  [companyController, 'handleQuitCompany', companyService, 'handleQuitCompany', (r) => ({
    ...r.body,
    userId: r.user.id,
    targetUserId: r.user.id,
    requesterUserId: r.user.id,
    requesterCompanyId: r.user.companyId,
    requesterRoleCode: r.user.userAccountData.roleCode
  })],
  [companyController, 'getAllCompanyByAdmin', companyService, 'getAllCompanyByAdmin', query],
  [companyController, 'handleAccecptCompany', companyService, 'handleAccecptCompany', body],

  [reviewController, 'handleCreateReview', reviewService, 'handleCreateReview', (r) => ({ ...r.body, userId: r.user.id })],
  [reviewController, 'getReviewByCompany', reviewService, 'getReviewByCompany', query],
  [reviewController, 'handleDeleteReview', reviewService, 'handleDeleteReview', (r) => ({ ...r.body, userId: r.user.id })],

  [favoriteController, 'handleToggleFavoritePost', favoriteService, 'handleToggleFavoritePost', (r) => ({ ...r.body, userId: r.user.id })],
  [favoriteController, 'checkFavoriteByUser', favoriteService, 'checkFavoriteByUser', (r) => ({ ...r.query, userId: r.user.id })],
  [favoriteController, 'getFavoritePostByUser', favoriteService, 'getFavoritePostByUser', (r) => ({ ...r.query, userId: r.user.id })],

  [followController, 'handleToggleFollowCompany', followService, 'handleToggleFollowCompany', (r) => ({ ...r.body, userId: r.user.id })],
  [followController, 'checkFollowCompany', followService, 'checkFollowCompany', (r) => ({ ...r.query, userId: r.user.id })],
  [followController, 'getFollowedCompanyByUser', followService, 'getFollowedCompanyByUser', (r) => ({ ...r.query, userId: r.user.id })],

  [notificationController, 'getNotificationByUser', notificationService, 'getNotificationByUser', (r) => ({ ...r.query, userId: r.user.id })],
  [notificationController, 'handleMarkReadNotification', notificationService, 'handleMarkReadNotification', (r) => ({ ...r.body, userId: r.user.id })],

  [packageCvController, 'getAllPackage', packageCvService, 'getAllPackage', query],
  [packageCvController, 'getAllToSelect', packageCvService, 'getAllToSelect', query],
  [packageCvController, 'getPackageById', packageCvService, 'getPackageById', query],
  [packageCvController, 'getPaymentLink', packageCvService, 'getPaymentLink', (r) => ({ ...r.query, userId: r.user.id })],
  [packageCvController, 'paymentOrderSuccess', packageCvService, 'paymentOrderSuccess', (r) => ({ ...r.body, userId: r.user.id })],
  [packageCvController, 'setActiveTypePackage', packageCvService, 'setActiveTypePackage', body],
  [packageCvController, 'creatNewPackageCv', packageCvService, 'creatNewPackageCv', body],
  [packageCvController, 'updatePackageCv', packageCvService, 'updatePackageCv', body],
  [packageCvController, 'getStatisticalPackageCv', packageCvService, 'getStatisticalPackage', query],
  [packageCvController, 'getHistoryTrade', packageCvService, 'getHistoryTrade', (r) => ({ ...r.query, companyId: r.user.companyId })],
  [packageCvController, 'getSumByYear', packageCvService, 'getSumByYear', query],

  [packagePostController, 'getAllPackage', packagePostService, 'getAllPackage', query],
  [packagePostController, 'getPackageById', packagePostService, 'getPackageById', query],
  [packagePostController, 'getPackageByType', packagePostService, 'getPackageByType', query],
  [packagePostController, 'getPaymentLink', packagePostService, 'getPaymentLink', (r) => ({ ...r.query, userId: r.user.id })],
  [packagePostController, 'paymentOrderSuccess', packagePostService, 'paymentOrderSuccess', (r) => ({ ...r.body, userId: r.user.id })],
  [packagePostController, 'setActiveTypePackage', packagePostService, 'setActiveTypePackage', body],
  [packagePostController, 'creatNewPackagePost', packagePostService, 'creatNewPackagePost', body],
  [packagePostController, 'updatePackagePost', packagePostService, 'updatePackagePost', body],
  [packagePostController, 'getStatisticalPackage', packagePostService, 'getStatisticalPackage', query],
  [packagePostController, 'getHistoryTrade', packagePostService, 'getHistoryTrade', (r) => ({ ...r.query, companyId: r.user.companyId })],
  [packagePostController, 'getSumByYear', packagePostService, 'getSumByYear', query]
];

describe('simple controller contracts', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());

  test.each(cases)('%# forwards trusted input and serialises the service result', async (
    controller, controllerMethod, service, serviceMethod, getExpectedArgument
  ) => {
    const request = baseRequest();
    const response = createResponse();
    const result = { errCode: 0, data: `${controllerMethod}-ok` };
    service[serviceMethod].mockResolvedValueOnce(result);

    await controller[controllerMethod](request, response);

    expect(service[serviceMethod]).toHaveBeenCalledWith(getExpectedArgument(request));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(result);
  });

  test.each(cases)('%# converts service failures into a stable API error', async (
    controller, controllerMethod, service, serviceMethod
  ) => {
    service[serviceMethod].mockRejectedValueOnce(new Error('service failed'));
    const response = createResponse();
    await controller[controllerMethod](baseRequest(), response);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });

  test('successful package payments emit the matching dashboard events only on success', async () => {
    packageCvService.paymentOrderSuccess.mockResolvedValueOnce({ errCode: 0 });
    await packageCvController.paymentOrderSuccess(baseRequest(), createResponse());
    expect(socket.emitDashboardChanged).toHaveBeenCalledWith('payment-cv');

    packagePostService.paymentOrderSuccess.mockResolvedValueOnce({ errCode: 0 });
    await packagePostController.paymentOrderSuccess(baseRequest(), createResponse());
    expect(socket.emitDashboardChanged).toHaveBeenCalledWith('payment-post');

    socket.emitDashboardChanged.mockClear();
    packageCvService.paymentOrderSuccess.mockResolvedValueOnce({ errCode: 2 });
    await packageCvController.paymentOrderSuccess(baseRequest(), createResponse());
    expect(socket.emitDashboardChanged).not.toHaveBeenCalled();

    packagePostService.paymentOrderSuccess.mockResolvedValueOnce({ errCode: 0, alreadyProcessed: true });
    await packagePostController.paymentOrderSuccess(baseRequest(), createResponse());
    expect(socket.emitDashboardChanged).not.toHaveBeenCalled();
  });

  test('successful company state changes refresh the search authorization scope', async () => {
    companyService.handleUpdateCompany.mockResolvedValueOnce({ errCode: 0 });
    await companyController.handleUpdateCompany(baseRequest(), createResponse());
    expect(events.emitCompanyUpdated).toHaveBeenLastCalledWith(11);

    companyService.handleBanCompany.mockResolvedValueOnce({ errCode: 0 });
    await companyController.handleBanCompany(baseRequest(), createResponse());
    expect(events.emitCompanyUpdated).toHaveBeenLastCalledWith(21);

    companyService.handleAccecptCompany.mockResolvedValueOnce({ errCode: 0 });
    const accept = baseRequest();
    accept.body.companyId = 44;
    await companyController.handleAccecptCompany(accept, createResponse());
    expect(events.emitCompanyUpdated).toHaveBeenLastCalledWith(44);

    events.emitCompanyUpdated.mockClear();
    companyService.handleUnBanCompany.mockResolvedValueOnce({ errCode: 2 });
    await companyController.handleUnBanCompany(baseRequest(), createResponse());
    expect(events.emitCompanyUpdated).not.toHaveBeenCalled();
  });
});
