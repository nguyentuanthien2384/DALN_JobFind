import express from 'express';
import { createLogger } from '../../shared/logger.js';
import { consume } from '../../shared/rabbitmq.js';
import { EVENTS } from '../../shared/events.js';
import {
    saveNotification, getUserEmail, getCompanyFollowers,
    sendEmail, pushRealtime, testMysql, isEmailConfigured
} from './libs/channels.js';
import {
    applicationStageTemplate, jobModeratedTemplate,
    newJobFromFollowedCompanyTemplate, newApplicationTemplate
} from './templates.js';

const logger = createLogger('notification-service');
const app = express();
const PORT = Number(process.env.PORT || 4005);

// Hang doi rieng cua service nay.
const QUEUE = 'notification-service.events';

const stats = { saved: 0, emailed: 0, pushed: 0, failed: 0 };

app.use(express.json());
app.get('/health', (req, res) => res.json({
    status: 'ok',
    service: 'notification-service',
    emailConfigured: isEmailConfigured(),
    stats
}));

// Gui mot thong bao qua ca ba kenh. Ba kenh chay doc lap: kenh nao hong thi ghi
// log roi di tiep, khong chan cac kenh con lai.
const deliver = async ({ userId, template }) => {
    if (!userId || !template) return;

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
        return;
    }

    // Day realtime truoc: nguoi dung dang mo trang thi thay ngay lap tuc.
    const pushed = await pushRealtime({ userId, notification: saved });
    if (pushed.sent) stats.pushed += 1;

    if (template.email) {
        const user = await getUserEmail(userId);
        if (user?.email) {
            const sent = await sendEmail({
                to: user.email,
                subject: template.email.subject,
                html: template.email.html
            });
            if (sent.sent) stats.emailed += 1;
        }
    }
};

const handlers = {
    // Ho so ung tuyen chuyen buoc -> bao cho ung vien.
    [EVENTS.APPLICATION_STAGE_CHANGED]: async (payload) => {
        const template = applicationStageTemplate({
            toStage: payload.toStage,
            jobTitle: payload.jobTitle,
            candidateName: payload.candidateName,
            companyName: payload.companyName
        });
        // Buoc "moi ung tuyen" khong sinh thong bao: chinh ung vien vua bam nop.
        if (!template) return;
        await deliver({ userId: payload.candidateId, template });
        logger.info('da bao chuyen buoc cho ung vien', {
            candidateId: payload.candidateId, toStage: payload.toStage
        });
    },

    // Co nguoi vua ung tuyen -> bao cho nguoi dang tin.
    [EVENTS.APPLICATION_SUBMITTED]: async (payload) => {
        if (!payload.posterId) {
            logger.debug('su kien nop ho so thieu posterId, bo qua', { cvId: payload.cvId });
            return;
        }
        const template = newApplicationTemplate({
            candidateName: payload.candidateName,
            jobTitle: payload.jobTitle
        });
        await deliver({ userId: payload.posterId, template });
        logger.info('da bao ho so moi cho nha tuyen dung', {
            posterId: payload.posterId, cvId: payload.cvId
        });
    },

    // Tin tuyen dung duoc duyet / bi tu choi -> bao cho nguoi dang tin.
    [EVENTS.JOB_MODERATED]: async (payload) => {
        if (!payload.posterId) {
            logger.debug('su kien kiem duyet thieu posterId, bo qua', { jobId: payload.jobId });
            return;
        }
        const template = jobModeratedTemplate({
            approved: payload.approved,
            jobTitle: payload.jobTitle || `#${payload.jobId}`,
            reason: payload.reason
        });
        await deliver({ userId: payload.posterId, template });
        logger.info('da bao ket qua kiem duyet', { jobId: payload.jobId, approved: payload.approved });
    },

    // Cong ty dang tin moi -> bao cho nhung nguoi dang theo doi cong ty do.
    [EVENTS.JOB_CREATED]: async (payload) => {
        const job = payload.job;
        if (!job?.companyId) return;

        const followers = await getCompanyFollowers(job.companyId);
        if (!followers.length) return;

        const template = newJobFromFollowedCompanyTemplate({
            jobTitle: job.name,
            companyName: job.companyName,
            jobId: job.id
        });

        // Gui tuan tu de khong dam mot luc hang tram ket noi CSDL/SMTP.
        for (const userId of followers) {
            await deliver({ userId, template });
        }
        logger.info('da bao tin moi cho nguoi theo doi', {
            jobId: job.id, companyId: job.companyId, soNguoi: followers.length
        });
    }
};

const start = async () => {
    await testMysql();

    if (!isEmailConfigured()) {
        logger.warn(
            'Chua cau hinh EMAIL_APP: thong bao van luu vao CSDL va day realtime, ' +
            'chi rieng email la bo qua.'
        );
    }

    await consume(QUEUE, Object.keys(handlers), async (payload, routingKey) => {
        const handler = handlers[routingKey];
        if (!handler) return;
        try {
            await handler(payload);
        } catch (error) {
            stats.failed += 1;
            logger.error('xu ly su kien that bai', { routingKey, error: error.message });
            throw error;
        }
    }, { prefetch: 10 });

    app.listen(PORT, () => logger.info(`Notification Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
