import axios from 'axios';
import { es, INDEX, toDocument } from '../libs/elastic.js';
import { consume } from '../../../shared/rabbitmq.js';
import { EVENTS, QUEUES } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('search-service');

// Ben Doc cua CQRS. Service nay khong bao gio ghi vao MySQL - no chi nghe su kien
// tu ben Ghi roi dung lai du lieu duoi dang toi uu cho tim kiem.

const indexJob = async (job) => {
    if (!job?.id) return;
    await es.index({ index: INDEX, id: String(job.id), document: toDocument(job) });
    logger.info('da dua tin vao index', { jobId: job.id });
};

const removeJob = async (jobId) => {
    try {
        await es.delete({ index: INDEX, id: String(jobId) });
        logger.info('da go tin khoi index', { jobId });
    } catch (error) {
        // Tin chua tung duoc index thi khong co gi de xoa, khong phai loi.
        if (error?.meta?.statusCode !== 404) throw error;
    }
};

// Dung lai toan bo index tu ben Ghi. Chay luc khoi dong de he thong tu phuc hoi
// sau khi mat du lieu index hoac sau khi bo lo su kien luc offline.
export const rebuildIndex = async () => {
    const jobCoreUrl = process.env.JOB_CORE_URL || 'http://job-core-service:4002';
    try {
        const { data } = await axios.get(`${jobCoreUrl}/internal/jobs`, {
            timeout: 30000,
            headers: { 'x-internal-secret': process.env.INTERNAL_SECRET || '' }
        });
        if (data.errCode !== 0 || !Array.isArray(data.data)) {
            logger.warn('ben Ghi tra ve du lieu khong hop le, bo qua dung lai index');
            return;
        }
        if (!data.data.length) {
            logger.info('ben Ghi chua co tin nao');
            return;
        }

        // Bulk API: mot lan goi cho ca lo, thay vi mot request cho moi tin.
        const operations = data.data.flatMap((job) => [
            { index: { _index: INDEX, _id: String(job.id) } },
            toDocument(job)
        ]);
        const result = await es.bulk({ refresh: true, operations });

        if (result.errors) {
            const failed = result.items.filter((i) => i.index?.error);
            logger.warn('mot so tin khong dua vao index duoc', {
                count: failed.length,
                sample: failed[0]?.index?.error?.reason
            });
        }

        // Don tin ma: tin da bien mat khoi nguon nhung con nam trong index.
        //
        // Chi ghi de thoi la chua du. Neu mot tin bi xoa thang trong CSDL (khong
        // qua API nen khong co su kien nao duoc phat), no se nam lai trong index
        // mai mai - nguoi dung van tim thay va bam vao mot tin khong con ton tai.
        // Dung lai index phai la doi chieu HAI CHIEU moi that su dong bo.
        const sourceIds = new Set(data.data.map((job) => String(job.id)));
        const indexed = await es.search({
            index: INDEX,
            size: 10000,
            _source: false,
            query: { match_all: {} }
        });
        const orphans = indexed.hits.hits
            .map((hit) => hit._id)
            .filter((id) => !sourceIds.has(id));

        if (orphans.length) {
            await es.bulk({
                refresh: true,
                operations: orphans.flatMap((id) => [{ delete: { _index: INDEX, _id: id } }])
            });
            logger.info('da don tin ma khoi index', { count: orphans.length, ids: orphans });
        }

        logger.info('da dung lai index', {
            total: data.data.length,
            daDon: orphans.length
        });
    } catch (error) {
        // Khong lam sap service: API tim kiem van phuc vu duoc bang du lieu cu,
        // va su kien moi van tiep tuc cap nhat index.
        logger.error('dung lai index that bai', { error: error.message });
    }
};

export const startIndexer = async () => {
    await consume(
        QUEUES.SEARCH_INDEXER,
        [EVENTS.JOB_CREATED, EVENTS.JOB_UPDATED, EVENTS.JOB_DELETED, EVENTS.JOB_MODERATED],
        async (payload, routingKey) => {
            switch (routingKey) {
                case EVENTS.JOB_CREATED:
                case EVENTS.JOB_UPDATED:
                    await indexJob(payload.job);
                    break;
                case EVENTS.JOB_DELETED:
                    await removeJob(payload.jobId);
                    break;
                case EVENTS.JOB_MODERATED:
                    // Cap nhat trang thai sau kiem duyet: tin bi tu choi phai bien
                    // khoi ket qua tim kiem ngay.
                    await es.update({
                        index: INDEX,
                        id: String(payload.jobId),
                        doc: { statusCode: payload.statusCode },
                        retry_on_conflict: 3
                    }).catch((error) => {
                        if (error?.meta?.statusCode !== 404) throw error;
                    });
                    logger.info('da cap nhat trang thai kiem duyet', {
                        jobId: payload.jobId, statusCode: payload.statusCode
                    });
                    break;
                default:
                    break;
            }
        },
        { prefetch: 20 }
    );
};
