const { normalizeNotificationDestination } = require('../../src/utils/notificationDestination');

const legacyNotice = {
    id: 1,
    userId: 5,
    typeCode: 'NEW_POST',
    isChecked: 0,
    createdAt: '2025-06-25T01:00:00.000Z',
    updatedAt: '2025-06-25T01:00:00.000Z',
    content: 'Công ty bạn theo dõi vừa đăng tin tuyển dụng mới',
    link: '/job'
};

test.each([
    ['Công ty bạn theo dõi vừa đăng tin tuyển dụng mới', 'Việc làm từ các công ty bạn đang theo dõi', '/candidate/followed-jobs'],
    ['Có 2 việc làm mới phù hợp với kỹ năng của bạn', 'Việc làm phù hợp với hồ sơ của bạn', '/candidate/recommended-jobs']
])('repairs the legacy sample "%s" without changing its identity or read state', (legacyContent, content, link) => {
    const original = Object.freeze({ ...legacyNotice, content: legacyContent });
    expect(normalizeNotificationDestination(original)).toEqual({ ...original, content, link });
    expect(original.link).toBe('/job');
    expect(original.content).toBe(legacyContent);
});

test.each([
    { ...legacyNotice, userId: 9 },
    { ...legacyNotice, typeCode: 'POST_APPROVED' },
    { ...legacyNotice, link: '/detail-job/42' },
    { ...legacyNotice, content: 'CMC GLOBAL vừa đăng tin tuyển dụng: Java Developer' },
    { ...legacyNotice, link: '/candidate/followed-jobs' },
    null,
    undefined
])('preserves real notifications and rows outside the exact legacy signature: %p', (notice) => {
    expect(normalizeNotificationDestination(notice)).toBe(notice);
});
