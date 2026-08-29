import express from 'express';
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
    try {
        await testMysql();
    } catch (error) {
        // SMTP va RabbitMQ van co the hoat dong khi MySQL tam thoi khong san
        // sang. Dac biet, email ket qua tuyen dung da mang san dia chi nguoi
        // nhan nen khong can phai doc nguoc CSDL de gui duoc.
        logger.warn('chua ket noi duoc MySQL: se thu lai khi xu ly thong bao', {
            error: error.message
        });
    }

    if (!isEmailConfigured()) {
        logger.warn(
            'Chua cau hinh EMAIL_APP: thong bao van luu vao CSDL va day realtime, ' +
            'chi rieng email la bo qua.'
        );
    }

    await startNotificationConsumer();

    app.listen(PORT, () => logger.info(`Notification Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
