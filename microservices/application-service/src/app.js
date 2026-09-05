import express from 'express';
import { contractRoute } from '../../shared/requestContract.js';
import { jsonBodies, safeHttpError } from '../../shared/httpBoundary.js';
import { createServiceRuntime, periodicTask } from '../../shared/serviceRuntime.js';
import { isConsumerReady, drainConsumers, closeConnection } from '../../shared/rabbitmq.js';
import { closeOutboxPublisher } from '../../shared/outboxPublisher.js';
import { registerOutboxMetrics } from '../../shared/operationalMetrics.js';
import { createLogger } from '../../shared/logger.js';
import { testConnection, initSchema, pool, STAGES, STAGE_LABELS } from './libs/db.js';
import { ensureOutboxTable, startOutboxRelay, stopOutboxRelay } from './libs/outbox.js';
import {
    getBoard, listApplications, getApplication, moveStage,
    sendDecisionNotification, rateApplication, addNote, getFunnel, myApplications
} from './controllers/applicationController.js';
import { savedCandidates, saveCandidate, removeCandidate } from './controllers/talentPoolController.js';
import { syncFromLegacy, syncEndpoint, closeLegacySource } from './controllers/syncController.js';
import { startSubmissionConsumer } from './consumers/submissionConsumer.js';
import {
    PERMISSIONS, requireServicePermission, requireTrustedGateway
} from '../../shared/accessControl.js';

const logger = createLogger('application-service');
const app = express();
const PORT = Number(process.env.PORT || 4004);
const runtime = createServiceRuntime(app, { service: 'application-service', logger,
    checks: { postgres: () => pool.query('SELECT 1'), rabbitmq: () => isConsumerReady() } });
runtime.onStop(() => stopOutboxRelay());
runtime.onStop(() => drainConsumers());
runtime.onClose(() => closeConnection());
runtime.onClose(() => closeOutboxPublisher());
runtime.onClose(() => pool.end());
runtime.onClose(() => closeLegacySource());
registerOutboxMetrics(runtime.registry, async () => {
    const { rows } = await pool.query('SELECT COUNT(*) AS pending, MIN(created_at) AS oldest FROM outbox_events WHERE published_at IS NULL');
    return rows[0];
});

app.use(jsonBodies(express));


app.use(requireTrustedGateway);

const canManageApplications = requireServicePermission(
    PERMISSIONS.APPLICATION_MANAGE,
    { companyRequired: true }
);
const canReadOwnApplications = requireServicePermission(PERMISSIONS.APPLICATION_SELF_READ);
const canManageTalentPool = requireServicePermission(
    PERMISSIONS.TALENT_POOL_MANAGE,
    { companyRequired: true }
);

// Giao dien can biet danh sach cac buoc de ve cot Kanban.
contractRoute(app, 'applicationStages', canManageApplications, (req, res) => {
    res.json({
        errCode: 0,
        data: STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage] }))
    });
});

// --- Nha tuyen dung ---
contractRoute(app, 'applicationBoard', canManageApplications, getBoard);
contractRoute(app, 'applicationFunnel', canManageApplications, getFunnel);
contractRoute(app, 'applicationList', canManageApplications, listApplications);
contractRoute(app, 'applicationGet', canManageApplications, getApplication);
contractRoute(app, 'applicationMove', canManageApplications, moveStage);
contractRoute(app, 'applicationDecision', canManageApplications, sendDecisionNotification);
contractRoute(app, 'applicationRating', canManageApplications, rateApplication);
contractRoute(app, 'applicationNote', canManageApplications, addNote);

// --- Ung vien ---
contractRoute(app, 'myApplications', canReadOwnApplications, myApplications);

// --- Kho ung vien ---
contractRoute(app, 'talentList', canManageTalentPool, savedCandidates);
contractRoute(app, 'talentSave', canManageTalentPool, saveCandidate);
contractRoute(app, 'talentDelete', canManageTalentPool, removeCandidate);

// --- Noi bo ---
contractRoute(app, 'applicationSync', syncEndpoint);

// eslint-disable-next-line no-unused-vars
app.use(safeHttpError);

const start = async () => {
    await testConnection();
    await initSchema();
    await ensureOutboxTable();
    // Nghe ho so moi tu backend cu. Phai bat TRUOC khi dong bo lan dau, de ho so
    // nop ngay trong luc dong bo cung khong bi bo lot.
    await startSubmissionConsumer();

    // Keo ho so cu sang de bang Kanban khong trong tron ngay tu dau.
    await syncFromLegacy();
    startOutboxRelay();

    // Doi chieu lai dinh ky - cung ly do nhu ben Search Service: neu RabbitMQ chet
    // vai phut, nhung ho so nop trong khoang do se khong bao gio len bang Kanban,
    // va khong co dau hieu bao loi nao. Nha tuyen dung chi don gian la khong thay
    // ung vien. Dong bo dung rang buoc UNIQUE tren legacy_cv_id nen chay lai bao
    // nhieu lan cung khong nhan ban.
    const intervalMinutes = Number(process.env.RECONCILE_MINUTES || 10);
    runtime.onStop(periodicTask(syncFromLegacy, intervalMinutes * 60 * 1000,
        (error) => logger.warn('doi chieu dinh ky that bai', { error: error.message })));
    logger.info(`se doi chieu lai ho so moi ${intervalMinutes} phut`);

    runtime.attach(app.listen(PORT, () => logger.info(`Application Service dang chay tren cong ${PORT}`)));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
