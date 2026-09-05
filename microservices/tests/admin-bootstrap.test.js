import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const app = Object.fromEntries(['use', 'get', 'post', 'delete', 'listen'].map((key) => [key, vi.fn()]));
    const express = Object.assign(vi.fn(() => app), { json: vi.fn() });
    return { app, express, connect: vi.fn(), ensureAuditIndexes: vi.fn(), testSources: vi.fn(), startAuditConsumer: vi.fn() };
});
vi.mock('express', () => ({ default: mocks.express }));
vi.mock('mongoose', () => ({ default: { connect: mocks.connect, connection: { readyState: 1 } } }));
vi.mock('../admin-service/src/models/AuditLog.js', () => ({ ensureAuditIndexes: mocks.ensureAuditIndexes }));
vi.mock('../admin-service/src/libs/sources.js', () => ({ testSources: mocks.testSources }));
vi.mock('../admin-service/src/consumers/auditConsumer.js', () => ({ startAuditConsumer: mocks.startAuditConsumer }));
vi.mock('../admin-service/src/controllers/auditController.js', () => ({ listLogs: vi.fn(), targetHistory: vi.fn(), ingestAction: vi.fn() }));
vi.mock('../admin-service/src/controllers/reportController.js', () => ({ overview: vi.fn(), timeseries: vi.fn(), distribution: vi.fn(), recruitmentFunnel: vi.fn(), activity: vi.fn() }));
vi.mock('../admin-service/src/controllers/tagController.js', () => ({ listMasterData: vi.fn(), upsertTag: vi.fn(), deleteTag: vi.fn(), aliasMap: vi.fn() }));

beforeEach(() => {
    vi.resetModules();
    for (const fn of Object.values(mocks.app)) fn.mockReset();
    mocks.express.mockReturnValue(mocks.app);
    for (const key of ['connect', 'ensureAuditIndexes', 'testSources', 'startAuditConsumer']) mocks[key].mockReset().mockResolvedValue(undefined);
});

describe('Admin startup requires the idempotency index', () => {
    it('waits for indexes before consuming or exposing the service', async () => {
        let finishIndex;
        mocks.ensureAuditIndexes.mockImplementationOnce(() => new Promise((resolve) => { finishIndex = resolve; }));
        await import('../admin-service/src/app.js');
        await vi.waitFor(() => expect(mocks.ensureAuditIndexes).toHaveBeenCalledOnce());
        expect(mocks.startAuditConsumer).not.toHaveBeenCalled();
        expect(mocks.app.listen).not.toHaveBeenCalled();
        finishIndex();
        await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
        expect(mocks.startAuditConsumer).toHaveBeenCalledOnce();
        expect(mocks.ensureAuditIndexes.mock.invocationCallOrder[0]).toBeLessThan(mocks.testSources.mock.invocationCallOrder[0]);
        expect(mocks.app.get).toHaveBeenCalledWith('/audit', expect.any(Function), expect.any(Function), expect.any(Function));
    });

    it('fails startup if the uniqueness index cannot be created; no destructive repair', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
        mocks.ensureAuditIndexes.mockRejectedValueOnce(new Error('existing duplicate IDs'));
        try {
            await import('../admin-service/src/app.js');
            await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
            expect(mocks.startAuditConsumer).not.toHaveBeenCalled();
            expect(mocks.app.listen).not.toHaveBeenCalled();
            expect(mocks.testSources).not.toHaveBeenCalled();
        } finally {
            exit.mockRestore();
        }
    });
});
