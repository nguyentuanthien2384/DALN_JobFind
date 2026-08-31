import axios from 'axios';
import CircuitBreaker from 'opossum';
import { getService, markHealth } from '../libs/registry.js';
import { createLogger } from '../../../shared/logger.js';
import { isSafeProxyPath } from '../libs/security.js';

const logger = createLogger('api-gateway');

// Circuit Breaker bang opossum.
//
// Van de can chan: khi mot service ben duoi bi treo, moi request di qua Gateway
// deu nam cho het timeout. Ket noi don lai, Gateway cung chet theo, va mot service
// hong keo sap ca he thong. Circuit breaker dem so lan that bai; vuot nguong thi
// "ngat cau dao" va tra loi that bai ngay lap tuc, khong con gui request nao xuong
// nua. Sau resetTimeout no cho mot request thu di qua de do xem service da song lai chua.

const breakers = new Map();

const breakerOptions = {
    timeout: Number(process.env.PROXY_TIMEOUT_MS || 10000),
    // Ngat khi tren 50% request that bai...
    errorThresholdPercentage: 50,
    // ...nhung chi sau khi da co du mau, tranh ngat oan vi 1 loi le te luc khoi dong.
    volumeThreshold: 5,
    // Sau 15s thu ha mot request xuong de do duong.
    resetTimeout: 15000,
    // Cua so thong ke phai DAI HON nhieu lan thoi gian mot request that bai.
    // Mac dinh cua opossum la 10s, va do chinh la cai bay: khi service chet han,
    // moi request mat ~5s moi bao loi (cho DNS/TCP het han), nen trong 10s chi kip
    // ghi nhan 2 lan that bai - khong bao gio du volumeThreshold de ngat. Cua so
    // 60s cho phep tich du so lan that bai ngay ca khi tung lan rat cham.
    rollingCountTimeout: 60000,
    rollingCountBuckets: 6
};

const callService = async ({ baseUrl, method, path, headers, body, query }) => {
    const response = await axios({
        method,
        url: `${baseUrl}${path}`,
        headers,
        params: query,
        data: body,
        timeout: breakerOptions.timeout,
        // Tu minh quyet dinh ma loi: 4xx la cau tra loi hop le cua service
        // (vi du 404, 403), khong phai dau hieu service chet. Chi 5xx moi tinh
        // la that bai cho circuit breaker.
        validateStatus: (status) => status < 500
    });
    return {
        status: response.status,
        headers: response.headers,
        data: response.data
    };
};

const getBreaker = (serviceKey) => {
    if (breakers.has(serviceKey)) return breakers.get(serviceKey);

    const service = getService(serviceKey);
    const breaker = new CircuitBreaker(callService, {
        ...breakerOptions,
        name: service.name
    });

    breaker.on('open', () => {
        logger.error(`CIRCUIT MO - tam ngung goi ${service.name}`, {
            resetTimeout: breakerOptions.resetTimeout
        });
        markHealth(serviceKey, false, 'circuit breaker mo');
    });
    breaker.on('halfOpen', () => {
        logger.warn(`CIRCUIT NUA MO - thu mot request toi ${service.name}`);
    });
    breaker.on('close', () => {
        logger.info(`CIRCUIT DONG - ${service.name} da hoat dong lai`);
        markHealth(serviceKey, true);
    });
    breaker.on('timeout', () => {
        logger.warn(`${service.name} qua han ${breakerOptions.timeout}ms`);
    });

    breakers.set(serviceKey, breaker);
    return breaker;
};

// Bo cac header khong duoc phep chuyen tiep nguyen si.
const buildForwardHeaders = (req, { includeInternalSecret = true } = {}) => {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    delete headers.connection;

    // Truyen danh tinh da xac thuc xuong duoi. Service ben duoi tin vao cac header
    // nay, nen Gateway phai xoa sach chung tu request cua client truoc khi tu dat lai
    // (neu khong ai cung co the gia mao bang cach tu gui x-user-id).
    delete headers['x-user-id'];
    delete headers['x-user-role'];
    delete headers['x-company-id'];
    // Khong bao gio chuyen khoa do client tu gui. Gateway dat lai khoa cua
    // chinh no de service phan biet request noi bo voi request goi thang.
    delete headers['x-internal-secret'];

    if (req.user) {
        headers['x-user-id'] = String(req.user.id);
        headers['x-user-role'] = req.user.roleCode || '';
        if (req.user.companyId !== null && req.user.companyId !== undefined) {
            headers['x-company-id'] = String(req.user.companyId);
        }
    }
    if (includeInternalSecret && process.env.INTERNAL_SECRET) {
        headers['x-internal-secret'] = process.env.INTERNAL_SECRET;
    }
    headers['x-correlation-id'] = req.correlationId;
    return headers;
};

// buildPath nhan ca req chu khong chi req.path. Ly do: voi app.use('/api/x') thi
// req.path la phan con lai sau tien to, con voi app.get('/api/x/:id') thi req.path
// la duong dan day du - nhan ca req de moi route tu quyet dinh, khong doan mo.
export const createProxy = (serviceKey, buildPath = (req) => req.path) => {
    return async (req, res, next) => {
        const service = getService(serviceKey);
        if (!service) return next(new Error(`Khong tim thay service ${serviceKey}`));

        const breaker = getBreaker(serviceKey);
        const targetPath = buildPath(req);

        // Defense in depth: ke ca khi mot route moi quen gan middleware tong,
        // proxy van khong bao gio chuan hoa `..`/slash ma hoa sang API noi bo.
        if (!isSafeProxyPath(targetPath)) {
            return res.status(400).json({
                errCode: 400,
                errMessage: 'Đường dẫn yêu cầu không hợp lệ'
            });
        }

        try {
            const result = await breaker.fire({
                baseUrl: service.baseUrl,
                method: req.method,
                path: targetPath,
                // Legacy `/api/*` khong can khoa noi bo. Khong gan khoa o nhanh
                // nay de mot URL la khong the muon quyen server-to-server.
                headers: buildForwardHeaders(req, {
                    includeInternalSecret: serviceKey !== 'legacy'
                }),
                body: req.body,
                query: req.query
            });

            markHealth(serviceKey, true);
            return res.status(result.status).json(result.data);
        } catch (error) {
            // opossum danh dau request bi chan bang thuoc tinh nay.
            if (error.code === 'EOPENBREAKER' || /Breaker is open/i.test(error.message || '')) {
                logger.warn(`chan request toi ${service.name} vi circuit dang mo`, {
                    path: req.originalUrl
                });
                return res.status(503).json({
                    errCode: 503,
                    errMessage: `Dịch vụ ${service.name} đang tạm gián đoạn, vui lòng thử lại sau ít phút`
                });
            }

            markHealth(serviceKey, false, error.message);
            logger.error(`goi ${service.name} that bai`, {
                path: req.originalUrl,
                error: error.message
            });
            return res.status(502).json({
                errCode: 502,
                errMessage: `Không kết nối được tới dịch vụ ${service.name}`
            });
        }
    };
};

export const getBreakerStats = () =>
    [...breakers.entries()].map(([key, breaker]) => ({
        service: key,
        // opossum: closed = binh thuong, open = dang ngat, halfOpen = dang do duong.
        state: breaker.opened ? 'open' : breaker.halfOpen ? 'halfOpen' : 'closed',
        stats: {
            successes: breaker.stats.successes,
            failures: breaker.stats.failures,
            timeouts: breaker.stats.timeouts,
            rejects: breaker.stats.rejects
        }
    }));
