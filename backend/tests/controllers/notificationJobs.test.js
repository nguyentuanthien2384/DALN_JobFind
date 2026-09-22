jest.mock('../../src/services/notificationService', () => ({}));
jest.mock('../../src/services/notificationJobService', () => ({ getNotificationJobs: jest.fn() }));
const service = require('../../src/services/notificationJobService');
const controller = require('../../src/controllers/notificationController');
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => jest.clearAllMocks());

test('notification collections always use token identity and accept only explicit filter fields', async () => {
    const result = { errCode: 0, data: [], count: 0, source: 'followed' };
    service.getNotificationJobs.mockResolvedValue(result);
    const res = response();
    await controller.getNotificationJobs({
        user: { id: 7 },
        query: { userId: 999, source: 'followed', limit: '10', offset: '0', companyId: 88, notificationCollection: false }
    }, res);
    expect(service.getNotificationJobs).toHaveBeenCalledWith({ userId: 7, source: 'followed', limit: '10', offset: '0' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(result);
});

test('validation errors use 400 and database errors use 500 without exposing details', async () => {
    const res = response();
    service.getNotificationJobs.mockResolvedValueOnce({ errCode: 1 });
    await controller.getNotificationJobs({ user: { id: 7 }, query: { source: 'invalid' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    service.getNotificationJobs.mockRejectedValueOnce(new Error('private database details'));
    await controller.getNotificationJobs({ user: { id: 7 }, query: { source: 'followed' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls.at(-1)[0]).toEqual({ errCode: -1, errMessage: expect.not.stringContaining('private database details') });
    log.mockRestore();
});
