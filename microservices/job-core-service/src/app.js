import express from 'express';
import { createLogger } from '../../shared/logger.js';
import { testConnection } from './libs/db.js';
import { consume } from '../../shared/rabbitmq.js';
import { EVENTS, QUEUES } from '../../shared/events.js';
import {
    PERMISSIONS, requireServicePermission, requireTrustedGateway
} from '../../shared/accessControl.js';
import {
    createJob, updateJob, deleteJob, getJob, listJobsForReindex
} from './controllers/jobController.js';
import {
    ensureAiTaskTable, parseResume, matchCv, coverLetter, getTask, handleAiResult
} from './controllers/aiController.js';

const logger = createLogger('job-core-service');
const app = express();
const PORT = Number(process.env.PORT || 4002);

app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'job-core-service' }));

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

const start = async () => {
    await testConnection();
    await ensureAiTaskTable();

    // Lang nghe ket qua tra ve tu AI Worker.
    await consume(QUEUES.AI_RESULT_HANDLER, [EVENTS.AI_RESULT], async (payload) => {
        await handleAiResult(payload);
    });

    app.listen(PORT, () => logger.info(`Job Core Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
