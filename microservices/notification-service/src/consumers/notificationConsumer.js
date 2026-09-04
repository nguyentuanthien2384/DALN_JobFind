import { createLogger } from '../../../shared/logger.js';
import { consume } from '../../../shared/rabbitmq.js';
import { EVENTS } from '../../../shared/events.js';
import { queueNotification } from '../libs/deliveryStore.js';
import {
    saveNotification, getUserEmail, getCompanyFollowers, sendEmail, pushRealtime
} from '../libs/channels.js';
import {
    applicationStageTemplate, applicationDecisionTemplate, jobModeratedTemplate,
    newJobFromFollowedCompanyTemplate, newApplicationTemplate
} from '../templates.js';

const logger = createLogger('notification-service');
const QUEUE = 'notification-service.events';

export const stats = { saved: 0, emailed: 0, pushed: 0, failed: 0 };

export const resetStats = () => {
    stats.saved = 0;
    stats.emailed = 0;
    stats.pushed = 0;
    stats.failed = 0;
};

export const deliver = async ({ userId, template, recipientEmail, eventId }) => {
    if (!userId || !template) return;

    if (eventId) {
        // Return to RabbitMQ only after notification + delivery intents commit together.
        const result = await queueNotification({ eventId, userId, template, recipientEmail });
        if (!result.duplicate) stats.saved += 1;
        return;
    }

    // Rolling-deployment compatibility: legacy producers have no stable event ID yet.

    let saved;
    try {
        saved = await saveNotification({
            userId,
            typeCode: template.typeCode,
            content: template.content,
            link: template.link
        });
        stats.saved += 1;
    } catch (error) {
        logger.error('luu thong bao that bai', { userId, error: error.message });
        stats.failed += 1;
    }

    if (saved) {
        const pushed = await pushRealtime({ userId, notification: saved });
        if (pushed.sent) stats.pushed += 1;
    }

    if (template.email) {
        let email = recipientEmail;
        if (!email) {
            try {
                email = (await getUserEmail(userId))?.email;
            } catch (error) {
                logger.warn('khong tim duoc email nguoi dung', { userId, error: error.message });
                stats.failed += 1;
            }
        }
        if (email) {
            const sent = await sendEmail({
                to: email,
                subject: template.email.subject,
                html: template.email.html,
                text: template.email.text
            });
            if (sent.sent) stats.emailed += 1;
        }
    }
};

export const handlers = {
    [EVENTS.APPLICATION_STAGE_CHANGED]: async (payload, metadata = {}) => {
        const template = applicationStageTemplate({
            toStage: payload.toStage,
            jobTitle: payload.jobTitle,
            candidateName: payload.candidateName,
            companyName: payload.companyName
        });
        if (!template) return;
        await deliver({
            eventId: metadata.eventId,
            userId: payload.candidateId,
            recipientEmail: payload.candidateEmail,
            template
        });
        logger.info('da bao chuyen buoc cho ung vien', {
            candidateId: payload.candidateId, toStage: payload.toStage
        });
    },

    [EVENTS.APPLICATION_DECISION_EMAIL_REQUESTED]: async (payload, metadata = {}) => {
        const template = applicationDecisionTemplate({
            decision: payload.decision,
            jobTitle: payload.jobTitle,
            candidateName: payload.candidateName,
            message: payload.message
        });
        await deliver({
            eventId: metadata.eventId,
            userId: payload.candidateId,
            recipientEmail: payload.candidateEmail,
            template
        });
        logger.info('da xu ly yeu cau gui email ket qua tuyen dung', {
            applicationId: payload.applicationId,
            candidateId: payload.candidateId,
            decision: payload.decision
        });
    },

    [EVENTS.APPLICATION_SUBMITTED]: async (payload, metadata = {}) => {
        if (!payload.posterId) {
            logger.debug('su kien nop ho so thieu posterId, bo qua', { cvId: payload.cvId });
            return;
        }
        const template = newApplicationTemplate({
            candidateName: payload.candidateName,
            jobTitle: payload.jobTitle
        });
        await deliver({ userId: payload.posterId, template, eventId: metadata.eventId });
        logger.info('da bao ho so moi cho nha tuyen dung', {
            posterId: payload.posterId, cvId: payload.cvId
        });
    },

    [EVENTS.JOB_MODERATED]: async (payload, metadata = {}) => {
        if (!payload.posterId) {
            logger.debug('su kien kiem duyet thieu posterId, bo qua', { jobId: payload.jobId });
            return;
        }
        const template = jobModeratedTemplate({
            approved: payload.approved,
            jobTitle: payload.jobTitle || `#${payload.jobId}`,
            reason: payload.reason
        });
        await deliver({ userId: payload.posterId, template, eventId: metadata.eventId });
        logger.info('da bao ket qua kiem duyet', { jobId: payload.jobId, approved: payload.approved });
    },

    [EVENTS.JOB_CREATED]: async (payload, metadata = {}) => {
        const job = payload.job;
        if (!job?.companyId) return;

        const followers = await getCompanyFollowers(job.companyId);
        if (!followers.length) return;

        const template = newJobFromFollowedCompanyTemplate({
            jobTitle: job.name,
            companyName: job.companyName,
            jobId: job.id
        });
        for (const userId of followers) {
            await deliver({ userId, template, eventId: metadata.eventId });
        }
        logger.info('da bao tin moi cho nguoi theo doi', {
            jobId: job.id, companyId: job.companyId, soNguoi: followers.length
        });
    }
};

export const handleNotificationEvent = async (payload, routingKey, metadata) => {
    const handler = handlers[routingKey];
    if (!handler) return;
    try {
        await handler(payload, metadata);
    } catch (error) {
        stats.failed += 1;
        logger.error('xu ly su kien that bai', { routingKey, error: error.message });
        throw error;
    }
};

export const startNotificationConsumer = async () => {
    await consume(QUEUE, Object.keys(handlers), handleNotificationEvent, { prefetch: 10 });
};
