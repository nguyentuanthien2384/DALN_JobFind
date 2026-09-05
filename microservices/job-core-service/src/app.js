import express from 'express';
import { createServiceRuntime } from '../../shared/serviceRuntime.js';
import { jsonBodies, safeHttpError } from '../../shared/httpBoundary.js';
import { registerOutboxMetrics, registerAiTaskMetrics } from '../../shared/operationalMetrics.js';
import { closeOutboxPublisher } from '../../shared/outboxPublisher.js';
import { createLogger } from '../../shared/logger.js';
import { testConnection, pool } from './libs/db.js';
import { ensureOutboxTable, startOutboxRelay, stopOutboxRelay } from './libs/outbox.js';
import { ensureAiResultTables } from './libs/moderationState.js';
import { ensureAiRequestTable } from './libs/aiTaskRequest.js';
import { aiResultRetry } from './libs/aiResultRetry.js';
import { consume, isConsumerReady, drainConsumers, closeConnection } from '../../shared/rabbitmq.js';
import { EVENTS, QUEUES } from '../../shared/events.js';
import {
    PERMISSIONS, requireServicePermission, requireTrustedGateway
} from '../../shared/accessControl.js';
import {
    createJob, updateJob, deleteJob, getJob, listJobsForReindex, getJobForIndex
} from './controllers/jobController.js';
import {
    ensureAiTaskTable, parseResume, matchCv, coverLetter, getTask, handleAiResult
} from './controllers/aiController.js';

const logger = createLogger('job-core-service');
const app = express();
const PORT = Number(process.env.PORT || 4002);
const runtime = createServiceRuntime(app, { service: 'job-core-service', logger,
    checks: { mysql: () => pool.query('SELECT 1'), rabbitmq: () => isConsumerReady() } });
runtime.onStop(() => stopOutboxRelay());
runtime.onStop(() => drainConsumers());
runtime.onClose(() => closeConnection());
runtime.onClose(() => closeOutboxPublisher());
runtime.onClose(() => pool.end());
registerOutboxMetrics(runtime.registry, async () => {
    const [[row]] = await pool.query('SELECT COUNT(*) AS pending, MIN(createdAt) AS oldest FROM outbox_events WHERE publishedAt IS NULL');
    return row;
});
registerAiTaskMetrics(runtime.registry, async () => {
    const [rows] = await pool.query('SELECT status, COUNT(*) AS total, MIN(createdAt) AS oldest FROM ai_tasks GROUP BY status');
    return rows;
});

app.use(jsonBodies(express));


// Moi API nghiep vu chi nhan request da duoc Gateway ky bang khoa noi bo.
// Health check duoc de cong khai cho Docker/orchestrator.
app.use(requireTrustedGateway);

// --- Ben Ghi (Command) ---
const canManageJobs = requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true });
app.post('/jobs', canManageJobs, createJob);
app.put('/jobs/:id', canManageJobs, updateJob);
app.delete('/jobs/:id', canManageJobs, deleteJob);
app.get('/jobs/:id', getJob);

// --- Cac tinh nang AI ---
const canUseCandidateAi = requireServicePermission(PERMISSIONS.AI_CANDIDATE_USE);
app.post('/ai/parse-resume', canUseCandidateAi, parseResume);
app.post('/ai/match-cv', canUseCandidateAi, matchCv);
app.post('/ai/cover-letter', canUseCandidateAi, coverLetter);
app.get('/ai/tasks/:taskId', canUseCandidateAi, getTask);

// --- Noi bo: Search Service goi de dung lai index tu dau ---
app.get('/internal/jobs', listJobsForReindex);
app.get('/internal/jobs/:id', getJobForIndex);
app.use(safeHttpError);

const start = async () => {
    await testConnection();
    await ensureAiTaskTable();
    await ensureOutboxTable();
    await ensureAiResultTables();
    await ensureAiRequestTable();

    // Lang nghe ket qua tra ve tu AI Worker.
    await consume(QUEUES.AI_RESULT_HANDLER, [EVENTS.AI_RESULT], async (payload, _routingKey, metadata) => {
        const result = await handleAiResult(payload, metadata);
        logger.info('da xu ly ket qua AI', { eventId: metadata?.eventId, outcome: result.outcome });
    }, { retry: aiResultRetry });

    startOutboxRelay();

    runtime.attach(app.listen(PORT, () => logger.info(`Job Core Service dang chay tren cong ${PORT}`)));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
