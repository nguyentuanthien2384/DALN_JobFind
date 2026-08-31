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
    if (!origin) return true;
    try {
        return allowedOrigins.includes(new URL(origin).origin);
    } catch {
        return false;
    }
};

// Express co the nhan URL o dang ma hoa, roi WHATWG URL/Axios lai chuan hoa
// khi Gateway ghep dia chi service. Giai ma lap co gioi han de bat ca bien the
// ma hoa hai lan va tu choi bat ky path nao co the doi cau truc route.
export const isSafeProxyPath = (rawValue) => {
    if (typeof rawValue !== 'string' || !rawValue.startsWith('/')) return false;
    let current = rawValue.split('?')[0];

    for (let depth = 0; depth < 5; depth += 1) {
        const hasControlCharacter = [...current].some((character) => {
            const code = character.charCodeAt(0);
            return code <= 31 || code === 127;
        });
        if (hasControlCharacter || /[\\?#]/.test(current)) return false;

        const segments = current.split('/');
        if (segments.some((segment) => segment === '.' || segment === '..')) return false;

        let decoded;
        try {
            decoded = decodeURIComponent(current);
        } catch {
            return false;
        }
        if (decoded === current) return true;

        // Slash/backslash/query/fragment ma hoa co the thay doi endpoint ma
        // service phia sau nhin thay, nen khong duoc phep xuat hien trong path.
        const slashCount = (value) => (value.match(/\//g) || []).length;
        if (slashCount(decoded) !== slashCount(current)) return false;
        current = decoded;
    }

    return false;
};

export const rejectUnsafeProxyPath = (req, res, next) => {
    const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
    if (!isSafeProxyPath(rawPath)) {
        return res.status(400).json({
            errCode: 400,
            errMessage: 'Đường dẫn yêu cầu không hợp lệ'
        });
    }
    return next();
};

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
        const rawPath = String(req.url || '').split('?')[0];
        const isSocketPath = rawPath === '/socket.io' || rawPath.startsWith('/socket.io/');
        if (isSocketPath && isSafeProxyPath(rawPath)
            && isOriginAllowed(req.headers.origin, allowedOrigins)) {
            return upgrade(req, socket, head);
        }

        logger?.warn('tu choi WebSocket khong hop le', {
            origin: req.headers.origin,
            path: rawPath
        });
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

export const mountLoginRateLimit = (app, limiter) => {
    app.post('/api/login', limiter);
};
