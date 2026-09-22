'use strict';

// These old demo notices did not store job IDs. Route them to the relevant
// current lists without inventing a job or preserving an unsupported count.
const DEMO_JOB_NOTIFICATIONS = Object.freeze([
    Object.freeze({
        legacyContent: 'Công ty bạn theo dõi vừa đăng tin tuyển dụng mới',
        content: 'Việc làm từ các công ty bạn đang theo dõi',
        link: '/candidate/followed-jobs'
    }),
    Object.freeze({
        legacyContent: 'Có 2 việc làm mới phù hợp với kỹ năng của bạn',
        content: 'Việc làm phù hợp với hồ sơ của bạn',
        link: '/candidate/recommended-jobs'
    })
]);

const normalizeNotificationDestination = (notification) => {
    if (!notification || notification.userId !== 5
        || notification.typeCode !== 'NEW_POST' || notification.link !== '/job') {
        return notification;
    }

    const destination = DEMO_JOB_NOTIFICATIONS.find(
        (item) => item.legacyContent === notification.content
    );
    if (!destination) return notification;

    return { ...notification, content: destination.content, link: destination.link };
};

module.exports = { DEMO_JOB_NOTIFICATIONS, normalizeNotificationDestination };
