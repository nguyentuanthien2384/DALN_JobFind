const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(),
  update: jest.fn(), count: jest.fn(), sum: jest.fn()
});

const mockDb = {
  FavoritePost: model(), FollowCompany: model(), CompanyReview: model(), Notification: model(),
  ChatMessage: model(), Post: model(), Company: model(), User: model(), Account: model(),
  DetailPost: {}, Allcode: {}
};

jest.mock('../../src/models/index', () => mockDb);

const favorite = require('../../src/services/favoritePostService');
const follow = require('../../src/services/followCompanyService');
const review = require('../../src/services/companyReviewService');
const notification = require('../../src/services/notificationService');
const chat = require('../../src/services/chatService');

const resetDb = () => {
  for (const value of Object.values(mockDb)) {
    if (!value || typeof value !== 'object') continue;
    for (const fn of Object.values(value)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
};

describe('favoritePostService', () => {
  beforeEach(resetDb);

  test('validates required identifiers', async () => {
    expect((await favorite.handleToggleFavoritePost({})).errCode).toBe(1);
    expect((await favorite.checkFavoriteByUser({ userId: 1 })).errCode).toBe(1);
    expect((await favorite.getFavoritePostByUser({})).errCode).toBe(1);
  });

  test('toggles an existing favorite off', async () => {
    const row = { destroy: jest.fn().mockResolvedValue(undefined) };
    mockDb.FavoritePost.findOne.mockResolvedValue(row);
    expect(await favorite.handleToggleFavoritePost({ userId: 1, postId: 2 })).toEqual(expect.objectContaining({
      errCode: 0, isFavorite: false
    }));
    expect(row.destroy).toHaveBeenCalled();
  });

  test('rejects a missing post and creates a favorite for an existing post', async () => {
    mockDb.FavoritePost.findOne.mockResolvedValue(null);
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await favorite.handleToggleFavoritePost({ userId: 1, postId: 2 })).errCode).toBe(2);
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 2 });
    expect(await favorite.handleToggleFavoritePost({ userId: 1, postId: 2 })).toEqual(expect.objectContaining({
      errCode: 0, isFavorite: true
    }));
    expect(mockDb.FavoritePost.create).toHaveBeenCalledWith({ userId: 1, postId: 2 });
  });

  test('checks favorite state and returns paginated saved jobs', async () => {
    mockDb.Post.findOne.mockResolvedValue({ id: 2 });
    mockDb.FavoritePost.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
    expect((await favorite.checkFavoriteByUser({ userId: 1, postId: 2 })).isFavorite).toBe(true);
    expect((await favorite.checkFavoriteByUser({ userId: 1, postId: 3 })).isFavorite).toBe(false);
    mockDb.FavoritePost.findAndCountAll.mockResolvedValue({ rows: [{ id: 1 }], count: 1 });
    expect(await favorite.getFavoritePostByUser({ userId: 1, limit: '10', offset: '0' })).toEqual({
      errCode: 0, data: [{ id: 1 }], count: 1
    });
    expect(mockDb.FavoritePost.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
    const postInclude = mockDb.FavoritePost.findAndCountAll.mock.calls[0][0].include[0];
    expect(postInclude).toEqual(expect.objectContaining({ where: { statusCode: 'PS1' }, required: true }));
    expect(postInclude.include[1]).toEqual(expect.objectContaining({
      attributes: ['id', 'firstName', 'lastName', 'image', 'companyId'],
      required: true
    }));
    expect(postInclude.include[1].include[0]).toEqual(expect.objectContaining({
      where: { statusCode: 'S1', censorCode: 'CS1' },
      required: true
    }));
  });

  test('returns a neutral favorite state for a non-public post', async () => {
    mockDb.Post.findOne.mockResolvedValue(null);
    expect(await favorite.checkFavoriteByUser({ userId: 1, postId: 2 })).toEqual({
      errCode: 0, isFavorite: false
    });
    expect(mockDb.FavoritePost.findOne).not.toHaveBeenCalled();
  });

  test.each([
    ['handleToggleFavoritePost', { userId: 1, postId: 2 }, 'findOne'],
    ['getFavoritePostByUser', { userId: 1 }, 'findAndCountAll']
  ])('%s rejects database failures', async (method, args, dbMethod) => {
    mockDb.FavoritePost[dbMethod].mockRejectedValueOnce(new Error('db'));
    await expect(favorite[method](args)).rejects.toThrow('db');
  });
});

describe('followCompanyService', () => {
  beforeEach(resetDb);

  test('validates required identifiers', async () => {
    expect((await follow.handleToggleFollowCompany({})).errCode).toBe(1);
    expect((await follow.checkFollowCompany({})).errCode).toBe(1);
    expect((await follow.getFollowedCompanyByUser({})).errCode).toBe(1);
  });

  test('toggles an existing follow off', async () => {
    const row = { destroy: jest.fn() };
    mockDb.FollowCompany.findOne.mockResolvedValue(row);
    expect(await follow.handleToggleFollowCompany({ userId: 1, companyId: 2 })).toEqual(expect.objectContaining({
      errCode: 0, isFollow: false
    }));
    expect(row.destroy).toHaveBeenCalled();
  });

  test('validates company existence before following', async () => {
    mockDb.FollowCompany.findOne.mockResolvedValue(null);
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await follow.handleToggleFollowCompany({ userId: 1, companyId: 2 })).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 2 });
    expect(await follow.handleToggleFollowCompany({ userId: 1, companyId: 2 })).toEqual(expect.objectContaining({
      errCode: 0, isFollow: true
    }));
    expect(mockDb.FollowCompany.create).toHaveBeenCalledWith({ userId: 1, companyId: 2 });
  });

  test('returns public follower count and optional current-user state', async () => {
    mockDb.Company.findOne.mockResolvedValue({ id: 2 });
    mockDb.FollowCompany.count.mockResolvedValue(4);
    expect(await follow.checkFollowCompany({ companyId: 2 })).toEqual({ errCode: 0, isFollow: false, countFollower: 4 });
    mockDb.FollowCompany.findOne.mockResolvedValue({ id: 1 });
    expect((await follow.checkFollowCompany({ companyId: 2, userId: 1 })).isFollow).toBe(true);
  });

  test('returns a paginated list of followed companies', async () => {
    mockDb.FollowCompany.findAndCountAll.mockResolvedValue({ rows: ['company'], count: 1 });
    expect(await follow.getFollowedCompanyByUser({ userId: 1, limit: '5', offset: '10' })).toEqual({
      errCode: 0, data: ['company'], count: 1
    });
    expect(mockDb.FollowCompany.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, offset: 10 }));
    expect(mockDb.FollowCompany.findAndCountAll.mock.calls[0][0].include[0]).toEqual(expect.objectContaining({
      where: { statusCode: 'S1', censorCode: 'CS1' },
      required: true
    }));
  });

  test('does not expose follower state for a non-public company', async () => {
    mockDb.Company.findOne.mockResolvedValue(null);
    expect((await follow.checkFollowCompany({ companyId: 2, userId: 1 })).errCode).toBe(2);
    expect(mockDb.FollowCompany.count).not.toHaveBeenCalled();
  });

  test.each([
    ['handleToggleFollowCompany', { userId: 1, companyId: 2 }, 'findOne'],
    ['getFollowedCompanyByUser', { userId: 1 }, 'findAndCountAll']
  ])('%s rejects database failures', async (method, args, dbMethod) => {
    mockDb.FollowCompany[dbMethod].mockRejectedValueOnce(new Error('db'));
    await expect(follow[method](args)).rejects.toThrow('db');
  });
});

describe('companyReviewService', () => {
  beforeEach(resetDb);

  test('validates review fields and star range before database access', async () => {
    expect((await review.handleCreateReview({})).errCode).toBe(1);
    expect((await review.handleCreateReview({ userId: 1, companyId: 2, star: 0 })).errCode).toBe(1);
    expect((await review.handleCreateReview({ userId: 1, companyId: 2, star: 6 })).errCode).toBe(2);
  });

  test('rejects reviews for missing companies', async () => {
    mockDb.Company.findOne.mockResolvedValue(null);
    expect((await review.handleCreateReview({ userId: 1, companyId: 2, star: 5 })).errCode).toBe(3);
  });

  test('updates an existing review and preserves old content when omitted', async () => {
    const row = { star: 2, content: 'old', save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue({ id: 2 });
    mockDb.CompanyReview.findOne.mockResolvedValue(row);
    expect((await review.handleCreateReview({ userId: 1, companyId: 2, star: '4' })).errCode).toBe(0);
    expect(row).toEqual(expect.objectContaining({ star: 4, content: 'old' }));
    expect(row.save).toHaveBeenCalled();
  });

  test('creates a new review with normalised values', async () => {
    mockDb.Company.findOne.mockResolvedValue({ id: 2 });
    mockDb.CompanyReview.findOne.mockResolvedValue(null);
    expect((await review.handleCreateReview({ userId: 1, companyId: 2, star: '5', content: 'great' })).errCode).toBe(0);
    expect(mockDb.CompanyReview.create).toHaveBeenCalledWith({ userId: 1, companyId: 2, star: 5, content: 'great' });
  });

  test('calculates rounded averages and handles an empty review list', async () => {
    mockDb.Company.findOne.mockResolvedValue({ id: 2 });
    mockDb.CompanyReview.findAndCountAll.mockResolvedValue({ rows: ['r'], count: 1 });
    mockDb.CompanyReview.sum.mockResolvedValueOnce(13).mockResolvedValueOnce(null);
    mockDb.CompanyReview.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    expect(await review.getReviewByCompany({ companyId: 2, limit: '2', offset: '0' })).toEqual({
      errCode: 0, data: ['r'], count: 3, averageStar: 4.3
    });
    expect(mockDb.CompanyReview.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 2, offset: 0 }));
    expect((await review.getReviewByCompany({ companyId: 2 })).averageStar).toBe(0);
    expect((await review.getReviewByCompany({})).errCode).toBe(1);
  });

  test('does not expose reviews for a non-public company', async () => {
    mockDb.Company.findOne.mockResolvedValue(null);
    expect((await review.getReviewByCompany({ companyId: 2 })).errCode).toBe(3);
    expect(mockDb.CompanyReview.findAndCountAll).not.toHaveBeenCalled();
  });

  test('deletion handles missing rows and enforces owner/admin authorisation', async () => {
    expect((await review.handleDeleteReview({})).errCode).toBe(1);
    mockDb.CompanyReview.findOne.mockResolvedValueOnce(null);
    expect((await review.handleDeleteReview({ id: 1, userId: 2 })).errCode).toBe(2);

    const otherReview = { userId: 3, destroy: jest.fn() };
    mockDb.CompanyReview.findOne.mockResolvedValueOnce(otherReview);
    mockDb.Account.findOne.mockResolvedValueOnce({ roleCode: 'CANDIDATE' });
    expect((await review.handleDeleteReview({ id: 1, userId: 2 })).errCode).toBe(3);
    expect(otherReview.destroy).not.toHaveBeenCalled();

    mockDb.CompanyReview.findOne.mockResolvedValueOnce(otherReview);
    mockDb.Account.findOne.mockResolvedValueOnce({ roleCode: 'ADMIN' });
    expect((await review.handleDeleteReview({ id: 1, userId: 2 })).errCode).toBe(0);
    expect(otherReview.destroy).toHaveBeenCalled();

    const ownReview = { userId: 2, destroy: jest.fn() };
    mockDb.CompanyReview.findOne.mockResolvedValueOnce(ownReview);
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await review.handleDeleteReview({ id: 2, userId: 2 })).errCode).toBe(0);
  });

  test.each([
    ['handleCreateReview', { userId: 1, companyId: 2, star: 5 }, mockDb.Company, 'findOne'],
    ['getReviewByCompany', { companyId: 2 }, mockDb.Company, 'findOne'],
    ['handleDeleteReview', { id: 1, userId: 2 }, mockDb.CompanyReview, 'findOne']
  ])('%s rejects database failures', async (method, args, target, dbMethod) => {
    target[dbMethod].mockRejectedValueOnce(new Error('db'));
    await expect(review[method](args)).rejects.toThrow('db');
  });
});

describe('notificationService', () => {
  beforeEach(resetDb);

  test('requires the authenticated user id', async () => {
    expect((await notification.getNotificationByUser({})).errCode).toBe(1);
    expect((await notification.handleMarkReadNotification({})).errCode).toBe(1);
  });

  test('returns notifications, total and unread counts with pagination', async () => {
    mockDb.Notification.findAndCountAll.mockResolvedValue({ rows: ['n'], count: 4 });
    mockDb.Notification.count.mockResolvedValue(2);
    expect(await notification.getNotificationByUser({ userId: 1, limit: '10', offset: '0' })).toEqual({
      errCode: 0, data: ['n'], count: 4, unreadCount: 2
    });
    expect(mockDb.Notification.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  test('marks one notification or all user notifications as read', async () => {
    expect((await notification.handleMarkReadNotification({ userId: 1, id: 5 })).errCode).toBe(0);
    expect(mockDb.Notification.update).toHaveBeenLastCalledWith({ isChecked: 1 }, { where: { userId: 1, id: 5 } });
    await notification.handleMarkReadNotification({ userId: 1 });
    expect(mockDb.Notification.update).toHaveBeenLastCalledWith({ isChecked: 1 }, { where: { userId: 1 } });
  });

  test('propagates database failures', async () => {
    mockDb.Notification.findAndCountAll.mockRejectedValueOnce(new Error('db'));
    await expect(notification.getNotificationByUser({ userId: 1 })).rejects.toThrow('db');
    mockDb.Notification.update.mockRejectedValueOnce(new Error('db'));
    await expect(notification.handleMarkReadNotification({ userId: 1 })).rejects.toThrow('db');
  });
});

describe('chatService', () => {
  beforeEach(resetDb);

  test('validates message participants/content, maximum length and self-message', async () => {
    expect((await chat.handleSendMessage({})).errCode).toBe(1);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: '   ' })).errCode).toBe(1);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: 'x'.repeat(2001) })).errCode).toBe(4);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: '1', content: 'x' })).errCode).toBe(2);
  });

  test('enforces candidate-to-approved-recruiter chat and stores trimmed content', async () => {
    mockDb.User.findAll.mockResolvedValueOnce([{ id: 1 }]);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: ' hi ' })).errCode).toBe(3);

    mockDb.User.findAll.mockResolvedValueOnce([
      { id: 1, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } },
      { id: 2, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } }
    ]);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: ' hi ' })).errCode).toBe(5);

    mockDb.User.findAll.mockResolvedValueOnce([
      { id: 1, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } },
      {
        id: 2, companyId: 4,
        userAccountData: { roleCode: 'EMPLOYER', statusCode: 'S1' },
        userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS3' }
      }
    ]);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: ' hi ' })).errCode).toBe(5);

    const saved = { id: 9 };
    mockDb.User.findAll.mockResolvedValueOnce([
      { id: 1, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } },
      {
        id: 2, companyId: 4,
        userAccountData: { roleCode: 'EMPLOYER', statusCode: 'S1' },
        userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS1' }
      }
    ]);
    mockDb.ChatMessage.create.mockResolvedValueOnce(saved);
    expect(await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: ' hi ' })).toEqual(expect.objectContaining({
      errCode: 0, data: saved
    }));
    expect(mockDb.ChatMessage.create).toHaveBeenCalledWith({ senderId: 1, receiverId: 2, content: 'hi', isRead: 0 });
  });

  test('allows an active ADMIN to send, receive and open chat with any active account', async () => {
    const activeAdmin = {
      id: 1,
      userAccountData: { roleCode: 'ADMIN', statusCode: 'S1' }
    };
    const activeEmployer = {
      id: 2,
      userAccountData: { roleCode: 'EMPLOYER', statusCode: 'S1' }
    };

    mockDb.User.findAll.mockResolvedValueOnce([activeAdmin, activeEmployer]);
    mockDb.ChatMessage.create.mockResolvedValueOnce({ id: 10 });
    expect(await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: 'Admin hỗ trợ' })).toEqual(
      expect.objectContaining({ errCode: 0, data: { id: 10 } })
    );

    mockDb.User.findAll.mockResolvedValueOnce([activeAdmin, activeEmployer]);
    mockDb.ChatMessage.create.mockResolvedValueOnce({ id: 11 });
    expect(await chat.handleSendMessage({ senderId: 2, receiverId: 1, content: 'Phản hồi admin' })).toEqual(
      expect.objectContaining({ errCode: 0, data: { id: 11 } })
    );
    expect(mockDb.ChatMessage.create).toHaveBeenNthCalledWith(2, {
      senderId: 2,
      receiverId: 1,
      content: 'Phản hồi admin',
      isRead: 0
    });

    mockDb.User.findAll.mockResolvedValueOnce([activeAdmin, activeEmployer]);
    mockDb.ChatMessage.update.mockResolvedValueOnce([1]);
    mockDb.ChatMessage.findAll.mockResolvedValueOnce([{ id: 11 }, { id: 10 }]);
    mockDb.User.findOne.mockResolvedValueOnce({ id: 2 });
    expect(await chat.getConversation({ userId: 1, partnerId: 2 })).toEqual({
      errCode: 0,
      data: [{ id: 10 }, { id: 11 }],
      partnerData: { id: 2 }
    });

    mockDb.User.findAll.mockResolvedValueOnce([
      { ...activeAdmin, userAccountData: { roleCode: 'ADMIN', statusCode: 'S2' } },
      activeEmployer
    ]);
    expect((await chat.handleSendMessage({ senderId: 1, receiverId: 2, content: 'blocked' })).errCode).toBe(5);
    expect(mockDb.ChatMessage.create).toHaveBeenCalledTimes(2);
  });

  test('marks unread incoming messages as read', async () => {
    expect((await chat.markConversationRead({})).errCode).toBe(1);
    mockDb.ChatMessage.update.mockResolvedValue([3]);
    expect(await chat.markConversationRead({ userId: 1, partnerId: 2 })).toEqual({ errCode: 0, updatedCount: 3 });
    expect(mockDb.ChatMessage.update).toHaveBeenCalledWith({ isRead: 1 }, { where: {
      senderId: 2, receiverId: 1, isRead: 0
    } });
  });

  test('loads newest limited messages, reverses for display, and returns partner data', async () => {
    expect((await chat.getConversation({})).errCode).toBe(1);
    const rows = [{ id: 3 }, { id: 2 }, { id: 1 }];
    mockDb.User.findAll.mockResolvedValueOnce([
      { id: 1, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } },
      {
        id: 2, companyId: 4,
        userAccountData: { roleCode: 'EMPLOYER', statusCode: 'S1' },
        userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS1' }
      }
    ]);
    mockDb.ChatMessage.update.mockResolvedValue([1]);
    mockDb.ChatMessage.findAll.mockResolvedValue(rows);
    mockDb.User.findOne.mockResolvedValue({ id: 2 });
    expect(await chat.getConversation({ userId: 1, partnerId: 2, limit: 500 })).toEqual({
      errCode: 0, data: [{ id: 1 }, { id: 2 }, { id: 3 }], partnerData: { id: 2 }
    });
    expect(mockDb.ChatMessage.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 200, order: [['createdAt', 'DESC']] }));
    mockDb.User.findAll.mockResolvedValueOnce([
      { id: 1, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } },
      {
        id: 2, companyId: 4,
        userAccountData: { roleCode: 'EMPLOYER', statusCode: 'S1' },
        userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS1' }
      }
    ]);
    await chat.getConversation({ userId: 1, partnerId: 2, limit: -5 });
    expect(mockDb.ChatMessage.findAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1 }));
  });

  test('groups conversations, counts unread incoming messages and sorts newest first', async () => {
    expect((await chat.getListConversation({})).errCode).toBe(1);
    mockDb.ChatMessage.findAll.mockResolvedValue([
      { id: 3, senderId: 3, receiverId: 1, isRead: 0, createdAt: '2026-01-03' },
      { id: 2, senderId: 1, receiverId: 2, isRead: 0, createdAt: '2026-01-02' },
      { id: 1, senderId: 2, receiverId: 1, isRead: 0, createdAt: '2026-01-01' }
    ]);
    mockDb.User.findAll.mockResolvedValue([{ id: 2, firstName: 'Two' }, { id: 3, firstName: 'Three' }]);
    const result = await chat.getListConversation({ userId: 1 });
    expect(result.errCode).toBe(0);
    expect(result.totalUnread).toBe(2);
    expect(result.data.map((item) => item.partnerId)).toEqual([3, 2]);
    expect(result.data[1]).toEqual(expect.objectContaining({ unreadCount: 1, partnerData: expect.objectContaining({ id: 2 }) }));
  });

  test.each([
    ['handleSendMessage', { senderId: 1, receiverId: 2, content: 'hi' }, mockDb.User, 'findAll'],
    ['markConversationRead', { userId: 1, partnerId: 2 }, mockDb.ChatMessage, 'update'],
    ['getConversation', { userId: 1, partnerId: 2 }, mockDb.User, 'findAll'],
    ['getListConversation', { userId: 1 }, mockDb.ChatMessage, 'findAll']
  ])('%s rejects database failures', async (method, args, target, dbMethod) => {
    target[dbMethod].mockRejectedValueOnce(new Error('db'));
    await expect(chat[method](args)).rejects.toThrow('db');
  });
});
