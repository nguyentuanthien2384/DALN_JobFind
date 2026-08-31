import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('api-gateway');

// Service Registry dua tren DNS cua Docker.
//
// Trong mang cua Docker Compose, moi service duoc phan giai bang chinh ten cua no
// ("http://job-core-service:4002"), nen khong can Consul/Eureka cho quy mo nay:
// Docker da dong vai tro registry. Module nay chi giu bang anh xa ten logic ->
// dia chi, cong them theo doi suc khoe de Gateway biet dich nao dang song.

const services = {
    identity: {
        name: 'identity-service',
        baseUrl: process.env.IDENTITY_URL || 'http://identity-service:4001'
    },
    jobs: {
        name: 'job-core-service',
        baseUrl: process.env.JOB_CORE_URL || 'http://job-core-service:4002'
    },
    search: {
        name: 'search-service',
        baseUrl: process.env.SEARCH_URL || 'http://search-service:4003'
    },
    applications: {
        name: 'application-service',
        baseUrl: process.env.APPLICATION_URL || 'http://application-service:4004'
    },
    admin: {
        name: 'admin-service',
        baseUrl: process.env.ADMIN_URL || 'http://admin-service:4006'
    },
    // Backend monolith cu van con phuc vu cac tinh nang chua tach ra
    // (chat, thanh toan, thong bao). Gateway dinh tuyen sang do de he thong
    // chuyen dan tung phan thay vi phai viet lai tat ca cung mot luc.
    legacy: {
        name: 'legacy-monolith',
        baseUrl: process.env.LEGACY_URL || 'http://host.docker.internal:5000'
    }
};

const health = {};
for (const key of Object.keys(services)) {
    health[key] = { healthy: true, lastCheck: null, lastError: null };
}

export const getService = (key) => services[key];

export const listServices = () =>
    Object.entries(services).map(([key, svc]) => ({
        key,
        name: svc.name,
        baseUrl: svc.baseUrl,
        ...health[key]
    }));

export const markHealth = (key, healthy, error = null) => {
    if (!health[key]) return;
    const previous = health[key].healthy;
    health[key] = { healthy, lastCheck: new Date().toISOString(), lastError: error };
    if (previous !== healthy) {
        logger[healthy ? 'info' : 'warn'](
            `service ${services[key].name} chuyen sang ${healthy ? 'HEALTHY' : 'UNHEALTHY'}`,
            { error }
        );
    }
};

// Chu dong do suc khoe dinh ky.
//
// Neu chi cap nhat khi co request di qua (markHealth goi tu proxy), trang /status
// se noi sai: mot service da hoi phuc van hien "chet" cho toi khi tinh co co nguoi
// dung goi vao no. Mot trang giam sat noi sai con te hon la khong co trang nao.
export const startHealthPolling = (intervalMs = 15000) => {
    const probe = async () => {
        await Promise.all(Object.entries(services).map(async ([key, svc]) => {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 4000);
                const res = await fetch(`${svc.baseUrl}/health`, { signal: controller.signal });
                clearTimeout(timer);
                const healthy = res.status >= 200 && res.status < 400;
                markHealth(key, healthy, healthy ? null : `HTTP ${res.status}`);
            } catch (error) {
                markHealth(key, false, error.message);
            }
        }));
    };

    probe();
    const timer = setInterval(probe, intervalMs);
    // unref: vong do nay khong duoc giu tien trinh song khi may chu dang tat.
    timer.unref();
    return timer;
};
