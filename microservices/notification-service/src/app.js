import express from 'express';
import { ensureDeliveryTables } from './libs/deliveryStore.js';
import { startDeliveryWorker } from './libs/deliveryWorker.js';
import { createLogger } from '../../shared/logger.js';
import {
    testMysql, isEmailConfigured
} from './libs/channels.js';
import {
    stats, startNotificationConsumer
} from './consumers/notificationConsumer.js';

const logger = createLogger('notification-service');
const app = express();
const PORT = Number(process.env.PORT || 4005);

app.use(express.json());
app.get('/health', (req, res) => res.json({
    status: 'ok',
    service: 'notification-service',
    emailConfigured: isEmailConfigured(),
    stats
}));

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
    startDeliveryWorker({ stats });
    await startNotificationConsumer();

    app.listen(PORT, () => logger.info(`Notification Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
