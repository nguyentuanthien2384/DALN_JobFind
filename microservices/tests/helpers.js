import { vi } from 'vitest';

export const makeReq = (overrides = {}) => ({
    headers: {},
    query: {},
    params: {},
    body: {},
    method: 'GET',
    path: '/',
    originalUrl: '/',
    ip: '127.0.0.1',
    correlationId: 'corr-test',
    ...overrides
});

export const makeRes = () => {
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        listeners: {},
        status: vi.fn((code) => {
            res.statusCode = code;
            return res;
        }),
        json: vi.fn((body) => {
            res.body = body;
            return res;
        }),
        setHeader: vi.fn((name, value) => {
            res.headers[name] = value;
        }),
        on: vi.fn((event, handler) => {
            res.listeners[event] = handler;
            return res;
        })
    };
    return res;
};

export const chain = (value) => {
    const q = {
        sort: vi.fn(() => q),
        skip: vi.fn(() => q),
        limit: vi.fn(() => q),
        select: vi.fn(() => q),
        lean: vi.fn(() => Promise.resolve(value))
    };
    return q;
};
