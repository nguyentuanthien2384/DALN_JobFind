import express from 'express';
import { createServiceRuntime } from '../../shared/serviceRuntime.js';
import { registerNotificationDeliveryMetrics } from '../../shared/operationalMetrics.js';
import { isConsumerReady, drainConsumers, closeConnection } from '../../shared/rabbitmq.js';
import { ensureDeliveryTables } from './libs/deliveryStore.js';
import { startDeliveryWorker } from './libs/deliveryWorker.js';
import { createLogger } from '../../shared/logger.js';
import {
    testMysql, isEmailConfigured, mysqlPool
} from './libs/channels.js';
import {
    stats, startNotificationConsumer
} from './consumers/notificationConsumer.js';
import { previewApplicationEmail, PreviewError } from './emailPreview.js';
import { requireTrustedGateway } from '../../shared/accessControl.js';

const logger = createLogger('notification-service');
const app = express();
const PORT = Number(process.env.PORT || 4005);
const runtime = createServiceRuntime(app, { service: 'notification-service', logger,
    checks: { mysql: () => mysqlPool.query('SELECT 1'), rabbitmq: () => isConsumerReady() } });
runtime.onStop(() => drainConsumers());
runtime.onClose(() => closeConnection());
runtime.onClose(() => mysqlPool.end());
registerNotificationDeliveryMetrics(runtime.registry, async () => {
    const [rows] = await mysqlPool.query('SELECT status, COUNT(*) AS total, MIN(createdAt) AS oldest FROM notification_deliveries GROUP BY status');
    return rows;
});

app.use(express.json());

// Noi bo: Application Service goi khi nha tuyen dung kiem tra truoc (dryRun) mot thu moi
// hay ket qua. Chi nhan request co khoa noi bo; Gateway khong bao gio mo /internal ra ngoai.
app.post('/internal/email-preview', requireTrustedGateway, (req, res) => {
    try {
        return res.json({ errCode: 0, data: previewApplicationEmail(req.body?.eventType, req.body?.payload) });
    } catch (error) {
        if (error instanceof PreviewError) return res.status(400).json({ errCode: 1, errMessage: error.message });
        logger.error('dung ban xem truoc email that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không dựng được bản xem trước email' });
    }
});

const start = async () => {
    await testMysql();
    await ensureDeliveryTables();

    if (!isEmailConfigured()) {
        logger.warn(
            'Chua cau hinh EMAIL_APP: thong bao van luu vao CSDL va day realtime, ' +
            'email co eventId se cho cau hinh trong hang doi.'
        );
    }

    // Previously committed intents can progress even while RabbitMQ is reconnecting.
    runtime.onStop(startDeliveryWorker({ stats }));
    await startNotificationConsumer();

    runtime.attach(app.listen(PORT, () => logger.info(`Notification Service dang chay tren cong ${PORT}`)));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
