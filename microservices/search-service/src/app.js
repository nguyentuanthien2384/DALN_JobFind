import express from 'express';
import { createLogger } from '../../shared/logger.js';
import { waitForElastic, ensureIndex, es, INDEX, liveIndexQuery } from './libs/elastic.js';
import { startIndexer, rebuildIndex } from './consumers/jobIndexer.js';
import { searchJobs, suggest, facets, related } from './controllers/searchController.js';
import { requireTrustedGateway } from '../../shared/accessControl.js';

const logger = createLogger('search-service');
const app = express();
const PORT = Number(process.env.PORT || 4003);

app.use(express.json());

app.get('/health', async (req, res) => {
    try {
        const count = await es.count({ index: INDEX, query: liveIndexQuery });
        res.json({ status: 'ok', service: 'search-service', indexed: count.count });
    } catch (error) {
        res.status(503).json({ status: 'degraded', error: error.message });
    }
});

// Search cong khai tai Gateway, khong dong nghia voi viec cong khai cong service.
app.use(requireTrustedGateway);

app.get('/search/jobs', searchJobs);
app.get('/search/suggest', suggest);
app.get('/search/facets', facets);
app.get('/search/related/:id', related);

// Cho phep dung lai index thu cong khi can (vi du sau khi sua du lieu truc tiep
// trong MySQL, luc do khong co su kien nao duoc phat ra).
app.post('/internal/reindex', async (req, res) => {
    try {
        const reconciliation = await rebuildIndex();
        const count = await es.count({ index: INDEX, query: liveIndexQuery });
        res.json({ errCode: 0, indexed: count.count, reconciliation });
    } catch (error) {
        logger.warn('doi chieu thu cong that bai', { error: error.message });
        res.status(503).json({ errCode: -1, errMessage: 'Chưa đối chiếu đầy đủ dữ liệu tìm kiếm' });
    }
});

const start = async () => {
    await waitForElastic();
    await ensureIndex();
    await startIndexer();
    // Dung lai index luc khoi dong: he thong tu phuc hoi sau khi mat du lieu
    // hoac bo lo su kien trong luc offline.
    await rebuildIndex().catch((error) => logger.warn('doi chieu luc khoi dong that bai', { error: error.message }));

    // Doi chieu lai dinh ky.
    //
    // Su kien la duong chinh, nhung khong dam bao 100%: RabbitMQ chet vai phut,
    // hoac ai do sua thang trong CSDL, la index lech ngay - va lech VINH VIEN
    // cho toi khi co nguoi khoi dong lai service. Trieu chung rat kho phat hien:
    // tin dang len khong ai tim thay, ma khong co loi nao duoc ghi ra ca.
    //
    // Reconciliation and event updates share the same source reread + CAS path.
    const intervalMinutes = Number(process.env.RECONCILE_MINUTES || 10);
    const timer = setInterval(() => {
        rebuildIndex().catch((error) =>
            logger.warn('doi chieu dinh ky that bai', { error: error.message }));
    }, intervalMinutes * 60 * 1000);
    timer.unref();
    logger.info(`se doi chieu lai index moi ${intervalMinutes} phut`);

    app.listen(PORT, () => logger.info(`Search Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
