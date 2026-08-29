import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const expressApp = { use: vi.fn(), get: vi.fn(), listen: vi.fn((port, callback) => callback?.()) };
    const express = vi.fn(() => expressApp);
    express.json = vi.fn(() => 'json-middleware');
    return {
        logger, expressApp, express,
        isConfigured: vi.fn(), logModel: vi.fn(), startTaskConsumer: vi.fn(),
        testMysql: vi.fn(), isEmailConfigured: vi.fn(), startNotificationConsumer: vi.fn(),
        stats: { saved: 0, emailed: 0, pushed: 0, failed: 0 }
    };
});

vi.mock('../shared/logger.js', () => ({ createLogger: () => mocks.logger }));
vi.mock('express', () => ({ default: mocks.express }));
vi.mock('../ai-worker/src/libs/claude.js', () => ({ isConfigured: mocks.isConfigured, logModel: mocks.logModel }));
vi.mock('../ai-worker/src/consumers/taskConsumer.js', () => ({ startTaskConsumer: mocks.startTaskConsumer }));
vi.mock('../notification-service/src/libs/channels.js', () => ({
    testMysql: mocks.testMysql,
    isEmailConfigured: mocks.isEmailConfigured
}));
vi.mock('../notification-service/src/consumers/notificationConsumer.js', () => ({
    stats: mocks.stats,
    startNotificationConsumer: mocks.startNotificationConsumer
}));

beforeEach(() => {
    vi.resetModules();
    for (const value of Object.values(mocks)) {
        if (typeof value?.mockReset === 'function') value.mockReset();
    }
    mocks.express.mockReturnValue(mocks.expressApp);
    mocks.express.json = vi.fn(() => 'json-middleware');
    mocks.expressApp.listen.mockImplementation((port, callback) => callback?.());
    mocks.startTaskConsumer.mockResolvedValue(undefined);
    mocks.testMysql.mockResolvedValue(undefined);
    mocks.startNotificationConsumer.mockResolvedValue(undefined);
});

describe('service bootstrap wiring', () => {
    it('starts the refactored AI consumer and preserves configuration diagnostics', async () => {
        mocks.isConfigured.mockReturnValue(false);
        await import('../ai-worker/src/app.js');
        await vi.waitFor(() => expect(mocks.startTaskConsumer).toHaveBeenCalledOnce());
        expect(mocks.logModel).toHaveBeenCalledOnce();
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY'));
        expect(mocks.logger.info).toHaveBeenCalledWith('AI Worker dang cho viec tu RabbitMQ');
    });

    it('keeps notification health route, dependency checks, consumer, and listen startup', async () => {
        mocks.isEmailConfigured.mockReturnValue(false);
        await import('../notification-service/src/app.js');
        await vi.waitFor(() => expect(mocks.expressApp.listen).toHaveBeenCalledOnce());
        expect(mocks.expressApp.use).toHaveBeenCalledWith('json-middleware');
        expect(mocks.expressApp.get).toHaveBeenCalledWith('/health', expect.any(Function));
        expect(mocks.testMysql).toHaveBeenCalledOnce();
        expect(mocks.startNotificationConsumer).toHaveBeenCalledOnce();
        expect(mocks.expressApp.listen).toHaveBeenCalledWith(4005, expect.any(Function));
    });
});
