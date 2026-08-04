import { Client } from '@elastic/elasticsearch';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('search-service');

export const INDEX = 'jobs';

export const es = new Client({
    node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200',
    requestTimeout: 10000
});

// Mapping duoc khai bao ro thay vi de Elasticsearch tu doan. Neu de tu doan,
// truong nao cung thanh `text` va viec loc chinh xac theo ma nganh nghe hay sap xep
// theo thoi gian se khong hoat dong dung.
const mapping = {
    properties: {
        id: { type: 'integer' },
        name: {
            // `text` de tim toan van; sub-field `keyword` de sap xep va gop nhom.
            type: 'text',
            analyzer: 'standard',
            fields: { keyword: { type: 'keyword', ignore_above: 256 } }
        },
        description: { type: 'text', analyzer: 'standard' },
        statusCode: { type: 'keyword' },
        categoryJobCode: { type: 'keyword' },
        addressCode: { type: 'keyword' },
        salaryJobCode: { type: 'keyword' },
        categoryJoblevelCode: { type: 'keyword' },
        categoryWorktypeCode: { type: 'keyword' },
        experienceJobCode: { type: 'keyword' },
        amount: { type: 'integer' },
        isHot: { type: 'boolean' },
        userId: { type: 'integer' },
        companyId: { type: 'integer' },
        companyName: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        companyLogo: { type: 'keyword', index: false },
        timePost: { type: 'long' },
        timeEnd: { type: 'long' },
        indexedAt: { type: 'date' }
    }
};

export const waitForElastic = async (attempt = 1) => {
    try {
        await es.cluster.health({ wait_for_status: 'yellow', timeout: '30s' });
        logger.info('Elasticsearch da san sang');
    } catch (error) {
        if (attempt > 10) throw error;
        logger.warn(`Elasticsearch chua san sang (${error.message}), thu lai lan ${attempt}`);
        await new Promise((r) => setTimeout(r, 3000));
        return waitForElastic(attempt + 1);
    }
};

export const ensureIndex = async () => {
    const exists = await es.indices.exists({ index: INDEX });
    if (!exists) {
        await es.indices.create({ index: INDEX, mappings: mapping });
        logger.info(`da tao index "${INDEX}"`);
    } else {
        logger.info(`index "${INDEX}" da ton tai`);
    }
};

// Chuyen ban ghi tu MySQL sang dang cua index. Lam sach the HTML vi nguoi dung
// tim theo chu, khong ai go "<p>" vao o tim kiem.
export const toDocument = (job) => ({
    id: job.id,
    name: job.name,
    description: String(job.descriptionHTML || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20000),
    statusCode: job.statusCode,
    categoryJobCode: job.categoryJobCode,
    addressCode: job.addressCode,
    salaryJobCode: job.salaryJobCode,
    categoryJoblevelCode: job.categoryJoblevelCode,
    categoryWorktypeCode: job.categoryWorktypeCode,
    experienceJobCode: job.experienceJobCode,
    amount: job.amount ?? 1,
    isHot: Boolean(job.isHot),
    userId: job.userId,
    companyId: job.companyId ?? null,
    companyName: job.companyName ?? null,
    companyLogo: job.companyLogo ?? null,
    timePost: Number(job.timePost) || null,
    timeEnd: Number(job.timeEnd) || null,
    indexedAt: new Date().toISOString()
});
