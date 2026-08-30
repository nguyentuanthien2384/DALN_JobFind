const DEFAULT_ORIGIN = 'http://localhost:3000';

// CORS_ORIGIN ho tro nhieu giao dien, phan tach bang dau phay. Chuan hoa ve
// URL origin de "http://localhost:3000/" va "http://localhost:3000" khong bi
// xem la hai dia chi khac nhau.
export const parseAllowedOrigins = (raw = DEFAULT_ORIGIN) => {
    const values = String(raw || DEFAULT_ORIGIN)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    const origins = values.map((value) => {
        if (value === '*') {
            throw new Error('CORS_ORIGIN khong duoc dung * khi credentials=true');
        }
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(`CORS_ORIGIN khong hop le: ${value}`);
        }
        return url.origin;
    });

    return [...new Set(origins)];
};

// Express mac dinh KHONG tin X-Forwarded-For, vi vay client khong the tu gia
// mao IP. Khi dat Gateway sau reverse proxy, chi cho phep khai bao dia chi/CIDR
// cua proxy cu the. Cam "true", wildcard va so hop vi cac kieu nay de bi loi
// cau hinh mang bien X-Forwarded-For thanh du lieu do client tu quyet dinh.
export const parseTrustedProxies = (raw = '') => {
    const proxies = String(raw || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    if (proxies.length === 0) return false;

    const unsafe = new Set(['true', '*', 'all', '0.0.0.0/0', '::/0']);
    for (const proxy of proxies) {
        if (unsafe.has(proxy.toLowerCase()) || /^\d+$/.test(proxy)) {
            throw new Error(`TRUST_PROXY khong an toan: ${proxy}`);
        }
    }
    return proxies;
};

export const isOriginAllowed = (origin, allowedOrigins) => {
    // Client khong phai trinh duyet (health check, mobile/native app) co the
    // khong gui Origin. CORS chi bao ve ngu canh trinh duyet nen van cho phep.
    if (!origin) return true;
    try {
        return allowedOrigins.includes(new URL(origin).origin);
    } catch {
        return false;
    }
};

// http-proxy-middleware chep header CORS tu backend cu vao response. Backend cu
// co the dang chay voi URL_REACT la danh sach phan tach bang dau phay va tra ra
// ca danh sach trong mot header (khong hop le theo CORS). Gateway da xac thuc
// Origin, nen tai day chi phan chieu lai CHINH XAC mot origin da duoc phep.
export const applySocketCorsHeaders = (proxyRes, req, allowedOrigins) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
        proxyRes.headers['access-control-allow-origin'] = new URL(origin).origin;
        proxyRes.headers['access-control-allow-credentials'] = 'true';
        const vary = String(proxyRes.headers.vary || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
        if (!vary.some((value) => value.toLowerCase() === 'origin')) vary.push('Origin');
        proxyRes.headers.vary = vary.join(', ');
        return;
    }

    delete proxyRes.headers['access-control-allow-origin'];
    delete proxyRes.headers['access-control-allow-credentials'];
};

export const createSocketUpgradeHandler = ({ allowedOrigins, upgrade, logger }) => {
    return (req, socket, head) => {
        if (isOriginAllowed(req.headers.origin, allowedOrigins)) {
            return upgrade(req, socket, head);
        }

        logger?.warn('tu choi WebSocket tu origin khong duoc phep', {
            origin: req.headers.origin
        });
        // HTTP Upgrade khong di qua middleware CORS cua Express. Tra 403 tai
        // day de website la khong the mo socket truc tiep vao backend cu.
        try {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        } catch {
            // Socket co the da bi client dong trong luc Gateway dang tu choi.
        } finally {
            socket.destroy();
        }
        return undefined;
    };
};

// Tach thanh ham nho de wiring bao mat nay co the duoc unit test ma khong can
// mo cong HTTP that trong test runner.
export const mountLoginRateLimit = (app, limiter) => {
    app.post('/api/login', limiter);
};
