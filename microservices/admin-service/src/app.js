import express from 'express';
import { createServiceRuntime } from '../../shared/serviceRuntime.js';
import { isConsumerReady, drainConsumers, closeConnection } from '../../shared/rabbitmq.js';
import mongoose from 'mongoose';
import { createLogger } from '../../shared/logger.js';
import { startAuditConsumer } from './consumers/auditConsumer.js';
import { ensureAuditIndexes } from './models/AuditLog.js';
import { testSources, mysqlPool, pgPool } from './libs/sources.js';
import { overview, timeseries, distribution, recruitmentFunnel, activity } from './controllers/reportController.js';
import { listLogs, targetHistory, ingestAction } from './controllers/auditController.js';
import { listMasterData, upsertTag, deleteTag, aliasMap } from './controllers/tagController.js';
import {
    PERMISSIONS, requireServicePermission, requireTrustedGateway
} from '../../shared/accessControl.js';

const logger = createLogger('admin-service');
const app = express();
const PORT = Number(process.env.PORT || 4006);
const runtime = createServiceRuntime(app, { service: 'admin-service', logger,
    checks: { mongo: () => mongoose.connection.readyState === 1 && mongoose.connection.db.command({ ping: 1 }),
        mysql: () => mysqlPool.query('SELECT 1'), postgres: () => pgPool.query('SELECT 1'), rabbitmq: () => isConsumerReady() } });
runtime.onStop(() => drainConsumers());
runtime.onClose(() => closeConnection());
runtime.onClose(() => mongoose.disconnect());
runtime.onClose(() => mysqlPool.end());
runtime.onClose(() => pgPool.end());

app.use(express.json({ limit: '5mb' }));


app.use(requireTrustedGateway);

const canReadAdmin = requireServicePermission(PERMISSIONS.ADMIN_READ);
const canWriteAdmin = requireServicePermission(PERMISSIONS.ADMIN_WRITE);

// --- Bao cao & bieu do ---
app.get('/reports/overview', canReadAdmin, overview);
app.get('/reports/timeseries', canReadAdmin, timeseries);
app.get('/reports/distribution', canReadAdmin, distribution);
app.get('/reports/funnel', canReadAdmin, recruitmentFunnel);
app.get('/reports/activity', canReadAdmin, activity);

// --- Nhat ky hoat dong ---
app.get('/audit', canReadAdmin, listLogs);
app.get('/audit/target/:type/:id', canReadAdmin, targetHistory);

// --- Master data ---
app.get('/master-data', canReadAdmin, listMasterData);
app.post('/master-data', canWriteAdmin, upsertTag);
app.delete('/master-data/:id', canWriteAdmin, deleteTag);

// --- Noi bo ---
// Gateway day thao tac cua nguoi dung vao day.
app.post('/internal/audit-action', ingestAction);
// Search Service co the doc bang tu dong nghia.
app.get('/internal/alias-map', aliasMap);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    logger.error('loi khong bat duoc', { error: err.message, url: req.originalUrl });
    res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
});

const connectMongo = async (attempt = 1) => {
    try {
        await mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:27017/admin_db', {
            serverSelectionTimeoutMS: 5000
        });
        logger.info('da ket noi MongoDB');
    } catch (error) {
        if (attempt > 10) throw error;
        logger.warn(`chua ket noi duoc MongoDB (${error.message}), thu lai lan ${attempt}`);
        await new Promise((r) => setTimeout(r, 3000));
        return connectMongo(attempt + 1);
    }
};

const start = async () => {
    await connectMongo();
    await ensureAuditIndexes();
    await testSources();

    // Nghe TAT CA su kien trong he thong bang ky tu dai dien '#'.
    //
    // Day la service duy nhat lam vay: no can nhin thay moi thu de dung duoc buc
    // tranh toan canh. Cac service khac chi dang ky dung nhung su kien minh can,
    // de khong phai xu ly nhung thu khong lien quan.
    await startAuditConsumer();

    runtime.attach(app.listen(PORT, () => logger.info(`Admin & Reporting Service dang chay tren cong ${PORT}`)));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
