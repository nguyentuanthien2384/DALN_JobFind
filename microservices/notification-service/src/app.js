import express from 'express';
import { createServiceRuntime } from '../../shared/serviceRuntime.js';
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

const logger = createLogger('notification-service');
const app = express();
const PORT = Number(process.env.PORT || 4005);
const runtime = createServiceRuntime(app, { service: 'notification-service', logger,
    checks: { mysql: () => mysqlPool.query('SELECT 1'), rabbitmq: () => isConsumerReady() } });
runtime.onStop(() => drainConsumers());
runtime.onClose(() => closeConnection());
runtime.onClose(() => mysqlPool.end());

app.use(express.json());

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
