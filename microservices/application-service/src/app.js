import express from 'express';
import { createLogger } from '../../shared/logger.js';
import { testConnection, initSchema, pool, STAGES, STAGE_LABELS } from './libs/db.js';
import {
    getBoard, listApplications, getApplication, moveStage,
    rateApplication, addNote, getFunnel, myApplications
} from './controllers/applicationController.js';
import { savedCandidates, saveCandidate, removeCandidate } from './controllers/talentPoolController.js';
import { syncFromLegacy, syncEndpoint } from './controllers/syncController.js';
import { startSubmissionConsumer } from './consumers/submissionConsumer.js';

const logger = createLogger('application-service');
const app = express();
const PORT = Number(process.env.PORT || 4004);

app.use(express.json({ limit: '10mb' }));

app.get('/health', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM applications');
        res.json({ status: 'ok', service: 'application-service', applications: rows[0].total });
    } catch (error) {
        res.status(503).json({ status: 'degraded', error: error.message });
    }
});

// Giao dien can biet danh sach cac buoc de ve cot Kanban.
app.get('/applications/stages', (req, res) => {
    res.json({
        errCode: 0,
        data: STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage] }))
    });
});

// --- Nha tuyen dung ---
app.get('/applications/board', getBoard);
app.get('/applications/funnel', getFunnel);
app.get('/applications', listApplications);
app.get('/applications/:id', getApplication);
app.patch('/applications/:id/stage', moveStage);
app.patch('/applications/:id/rating', rateApplication);
app.post('/applications/:id/notes', addNote);

// --- Ung vien ---
app.get('/my-applications', myApplications);

// --- Kho ung vien ---
app.get('/talent-pool', savedCandidates);
app.post('/talent-pool', saveCandidate);
app.delete('/talent-pool/:candidateId', removeCandidate);

// --- Noi bo ---
app.post('/internal/sync', syncEndpoint);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    logger.error('loi khong bat duoc', { error: err.message, url: req.originalUrl });
    res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
});

const start = async () => {
    await testConnection();
    await initSchema();
    // Nghe ho so moi tu backend cu. Phai bat TRUOC khi dong bo lan dau, de ho so
    // nop ngay trong luc dong bo cung khong bi bo lot.
    await startSubmissionConsumer();

    // Keo ho so cu sang de bang Kanban khong trong tron ngay tu dau.
    await syncFromLegacy();

    // Doi chieu lai dinh ky - cung ly do nhu ben Search Service: neu RabbitMQ chet
    // vai phut, nhung ho so nop trong khoang do se khong bao gio len bang Kanban,
    // va khong co dau hieu bao loi nao. Nha tuyen dung chi don gian la khong thay
    // ung vien. Dong bo dung rang buoc UNIQUE tren legacy_cv_id nen chay lai bao
    // nhieu lan cung khong nhan ban.
    const intervalMinutes = Number(process.env.RECONCILE_MINUTES || 10);
    const timer = setInterval(() => {
        syncFromLegacy().catch((error) =>
            logger.warn('doi chieu dinh ky that bai', { error: error.message }));
    }, intervalMinutes * 60 * 1000);
    timer.unref();
    logger.info(`se doi chieu lai ho so moi ${intervalMinutes} phut`);

    app.listen(PORT, () => logger.info(`Application Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
