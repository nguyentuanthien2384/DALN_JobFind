import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chain, makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => ({
    mysqlPool: { query: vi.fn() },
    pgPool: { query: vi.fn() },
    AuditLog: { create: vi.fn(), find: vi.fn(), countDocuments: vi.fn(), aggregate: vi.fn() },
    Tag: { find: vi.fn(), findOneAndUpdate: vi.fn(), findByIdAndDelete: vi.fn() }
}));

vi.mock('../admin-service/src/libs/sources.js', () => ({ mysqlPool: mocks.mysqlPool, pgPool: mocks.pgPool }));
vi.mock('../admin-service/src/models/AuditLog.js', () => ({ AuditLog: mocks.AuditLog }));
vi.mock('../admin-service/src/models/Tag.js', () => ({ Tag: mocks.Tag }));

beforeEach(() => {
    Object.values(mocks.AuditLog).forEach((fn) => fn.mockReset());
    Object.values(mocks.Tag).forEach((fn) => fn.mockReset());
    mocks.mysqlPool.query.mockReset();
    mocks.pgPool.query.mockReset();
});

describe('admin audit controller', () => {
    it.each([
        [{ jobId: 1 }, 'job', '1'],
        [{ applicationId: 2 }, 'application', '2'],
        [{ taskId: 't' }, 'ai_task', 't'],
        [{ job: { id: 3 } }, 'job', '3'],
        [{}, null, null]
    ])('classifies event targets %#', async (payload, type, id) => {
        mocks.AuditLog.create.mockResolvedValue({});
        const { recordEvent } = await import('../admin-service/src/controllers/auditController.js');
        await recordEvent('job.created', payload);
        expect(mocks.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'event', name: 'job.created', service: 'job', targetType: type, targetId: id
        }));
    });

    it('trims oversized/nested payloads and removes file contents', async () => {
        mocks.AuditLog.create.mockResolvedValue({});
        const { recordEvent } = await import('../admin-service/src/controllers/auditController.js');
        await recordEvent('ai.result', {
            userId: 7,
            long: 'x'.repeat(600),
            fileBase64: 'secret',
            nested: { cv_snapshot: { private: true }, short: 'ok' },
            array: [{ untouched: true }]
        });
        const saved = mocks.AuditLog.create.mock.calls[0][0];
        expect(saved.actorId).toBe(7);
        expect(saved.payload.long).toContain('đã cắt bớt 600 ký tự');
        expect(saved.payload.fileBase64).toBe('[đã lược bỏ]');
        expect(saved.payload.nested.cv_snapshot).toBe('[đã lược bỏ]');
        expect(saved.payload.array).toEqual([{ untouched: true }]);
    });

    it('records gateway actions with all audit metadata', async () => {
        const { recordAction } = await import('../admin-service/src/controllers/auditController.js');
        await recordAction({ method: 'POST', route: '/jobs', actorId: 1, actorRole: 'ADMIN', companyId: 2, status: 201, durationMs: 4, ip: 'x', correlationId: 'c' });
        expect(mocks.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'action', name: 'POST /jobs', service: 'api-gateway', actorId: 1, status: 201 }));
    });

    it('builds audit filters, limits pagination, and returns count', async () => {
        const q = chain([{ id: 1 }]);
        mocks.AuditLog.find.mockReturnValue(q);
        mocks.AuditLog.countDocuments.mockResolvedValue(5);
        const { listLogs } = await import('../admin-service/src/controllers/auditController.js');
        const res = makeRes();
        await listLogs(makeReq({ query: {
            kind: 'event', name: 'job', actorId: '2', targetType: 'job', targetId: 3,
            correlationId: 'c', fromDate: '2026-01-01', toDate: '2026-02-01', limit: '500', offset: '4'
        } }), res);
        const filter = mocks.AuditLog.find.mock.calls[0][0];
        expect(filter).toMatchObject({ kind: 'event', actorId: 2, targetType: 'job', targetId: '3', correlationId: 'c' });
        expect(filter.name).toBeInstanceOf(RegExp);
        expect(filter.createdAt.$gte).toBeInstanceOf(Date);
        expect(q.skip).toHaveBeenCalledWith(4);
        expect(q.limit).toHaveBeenCalledWith(200);
        expect(res.body.count).toBe(5);
    });

    it('handles audit list/history query errors', async () => {
        const { listLogs, targetHistory } = await import('../admin-service/src/controllers/auditController.js');
        const rejected = { sort: vi.fn(() => rejected), skip: vi.fn(() => rejected), limit: vi.fn(() => rejected), lean: vi.fn().mockRejectedValue(new Error('db')) };
        mocks.AuditLog.find.mockReturnValue(rejected);
        mocks.AuditLog.countDocuments.mockResolvedValue(0);
        const list = makeRes();
        await listLogs(makeReq(), list);
        expect(list.statusCode).toBe(500);
        mocks.AuditLog.find.mockReturnValue(rejected);
        const history = makeRes();
        await targetHistory(makeReq({ params: { type: 'job', id: '1' } }), history);
        expect(history.statusCode).toBe(500);
    });

    it('returns ordered target history', async () => {
        const q = chain([{ id: 1 }, { id: 2 }]);
        mocks.AuditLog.find.mockReturnValue(q);
        const { targetHistory } = await import('../admin-service/src/controllers/auditController.js');
        const res = makeRes();
        await targetHistory(makeReq({ params: { type: 'job', id: 9 } }), res);
        expect(mocks.AuditLog.find).toHaveBeenCalledWith({ targetType: 'job', targetId: '9' });
        expect(q.sort).toHaveBeenCalledWith({ createdAt: 1 });
        expect(res.body.count).toBe(2);
    });

    it('protects internal audit ingestion and reports persistence errors', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'secret');
        const { ingestAction } = await import('../admin-service/src/controllers/auditController.js');
        const denied = makeRes();
        await ingestAction(makeReq({ headers: { 'x-internal-secret': 'wrong' } }), denied);
        expect(denied.statusCode).toBe(403);
        mocks.AuditLog.create.mockResolvedValue({});
        const ok = makeRes();
        await ingestAction(makeReq({ headers: { 'x-internal-secret': 'secret' }, body: { method: 'POST', route: '/x' } }), ok);
        expect(ok.body.errCode).toBe(0);
        mocks.AuditLog.create.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await ingestAction(makeReq({ headers: { 'x-internal-secret': 'secret' }, body: {} }), failed);
        expect(failed.statusCode).toBe(500);
        vi.unstubAllEnvs();
    });
});

describe('master-data tag controller', () => {
    it('joins MySQL codes with optional Mongo tag metadata', async () => {
        mocks.mysqlPool.query.mockResolvedValue([[{ code: 'IT', value: 'Công nghệ', type: 'JOBTYPE' }, { code: 'HR', value: 'Nhân sự', type: 'JOBTYPE' }]]);
        mocks.Tag.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ code: 'IT', type: 'JOBTYPE', aliases: ['tech'], group: 'digital', weight: 2, isActive: false, description: 'd' }]) });
        const { listMasterData } = await import('../admin-service/src/controllers/tagController.js');
        const res = makeRes();
        await listMasterData(makeReq({ query: { type: 'JOBTYPE' } }), res);
        expect(mocks.mysqlPool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE type = ?'), ['JOBTYPE']);
        expect(res.body.data[0]).toMatchObject({ aliases: ['tech'], group: 'digital', weight: 2, isActive: false, hasTag: true });
        expect(res.body.data[1]).toMatchObject({ aliases: [], group: null, weight: 0, isActive: true, hasTag: false });
    });

    it('handles unfiltered reads and read failures', async () => {
        mocks.mysqlPool.query.mockResolvedValueOnce([[]]);
        mocks.Tag.find.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([]) });
        const { listMasterData } = await import('../admin-service/src/controllers/tagController.js');
        await listMasterData(makeReq(), makeRes());
        expect(mocks.Tag.find).toHaveBeenCalledWith({});
        mocks.mysqlPool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await listMasterData(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('validates tag type/name and uses canonical MySQL names', async () => {
        const { upsertTag } = await import('../admin-service/src/controllers/tagController.js');
        const noType = makeRes();
        await upsertTag(makeReq(), noType);
        expect(noType.statusCode).toBe(400);
        mocks.mysqlPool.query.mockResolvedValueOnce([[]]);
        const noName = makeRes();
        await upsertTag(makeReq({ body: { type: 'JOBTYPE', code: 'X' } }), noName);
        expect(noName.statusCode).toBe(400);
        mocks.mysqlPool.query.mockResolvedValueOnce([[{ value: 'Công nghệ' }]]);
        mocks.Tag.findOneAndUpdate.mockResolvedValue({ id: 1 });
        const ok = makeRes();
        await upsertTag(makeReq({ headers: { 'x-user-id': '7' }, body: {
            type: 'JOBTYPE', code: 'IT', name: 'Wrong', aliases: ['tech'], group: 'g', weight: 4, isActive: false, description: 'd'
        } }), ok);
        const [, update, options] = mocks.Tag.findOneAndUpdate.mock.calls[0];
        expect(update).toMatchObject({ name: 'Công nghệ', slug: 'công-nghệ', aliases: ['tech'], group: 'g', weight: 4, isActive: false, createdBy: 7 });
        expect(options).toEqual({ upsert: true, new: true, setDefaultsOnInsert: true });
        mocks.mysqlPool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await upsertTag(makeReq({ body: { type: 'X', code: 'Y', name: 'N' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('deletes tags with 404/error handling', async () => {
        const { deleteTag } = await import('../admin-service/src/controllers/tagController.js');
        mocks.Tag.findByIdAndDelete.mockResolvedValueOnce(null);
        const missing = makeRes();
        await deleteTag(makeReq({ params: { id: 'x' } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.Tag.findByIdAndDelete.mockResolvedValueOnce({ id: 'x' });
        const ok = makeRes();
        await deleteTag(makeReq({ params: { id: 'x' } }), ok);
        expect(ok.body.errCode).toBe(0);
        mocks.Tag.findByIdAndDelete.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await deleteTag(makeReq({ params: { id: 'x' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('builds a case-insensitive alias lookup and handles errors', async () => {
        const { aliasMap } = await import('../admin-service/src/controllers/tagController.js');
        const q = { select: vi.fn(() => q), lean: vi.fn().mockResolvedValue([{ code: 'IT', type: 'JOBTYPE', name: 'Tech', aliases: ['Node JS', 'Backend'] }]) };
        mocks.Tag.find.mockReturnValue(q);
        const res = makeRes();
        await aliasMap(makeReq(), res);
        expect(res.body.data['node js']).toEqual({ code: 'IT', type: 'JOBTYPE', name: 'Tech' });
        expect(res.body.count).toBe(2);
        const bad = { select: vi.fn(() => bad), lean: vi.fn().mockRejectedValue(new Error('db')) };
        mocks.Tag.find.mockReturnValue(bad);
        const failed = makeRes();
        await aliasMap(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });
});

describe('admin reporting controller', () => {
    it('combines MySQL/PostgreSQL overview metrics and coerces revenue', async () => {
        for (const total of [10, 3, 2, 4, 1, '100.5', '20']) mocks.mysqlPool.query.mockResolvedValueOnce([[{ total }]]);
        mocks.pgPool.query.mockResolvedValue({ rows: [{ total: 7, hired: 2 }] });
        const { overview } = await import('../admin-service/src/controllers/reportController.js');
        const res = makeRes();
        await overview(makeReq({ query: { fromDate: '2026-01-01', toDate: '2026-01-31' } }), res);
        expect(res.body.data).toMatchObject({
            nguoiDung: { tong: 10, moi: 3 }, congTy: 2,
            tinTuyenDung: { dangHienThi: 4, choDuyet: 1 },
            hoSoUngTuyen: { tong: 7, daTuyen: 2 },
            doanhThu: { goiTin: 100.5, goiXemCv: 20, tong: 120.5 }
        });
        expect(mocks.mysqlPool.query.mock.calls[1][1]).toEqual(['2026-01-01 00:00:00', '2026-01-31 00:00:00']);
    });

    it('degrades only application metrics when PostgreSQL is down and maps MySQL failure to 500', async () => {
        for (let i = 0; i < 7; i++) mocks.mysqlPool.query.mockResolvedValueOnce([[{ total: 0 }]]);
        mocks.pgPool.query.mockRejectedValue(new Error('pg'));
        const { overview } = await import('../admin-service/src/controllers/reportController.js');
        const ok = makeRes();
        await overview(makeReq(), ok);
        expect(ok.body.data.hoSoUngTuyen).toEqual({ tong: 0, daTuyen: 0 });
        mocks.mysqlPool.query.mockRejectedValue(new Error('mysql'));
        const failed = makeRes();
        await overview(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('returns timeseries with numeric revenue and tolerates PostgreSQL outage', async () => {
        mocks.mysqlPool.query.mockResolvedValueOnce([[{ ngay: 'd', soLuong: 1 }]]).mockResolvedValueOnce([[{ ngay: 'd', soLuong: 2 }]]).mockResolvedValueOnce([[{ ngay: 'd', tien: '12.5' }]]);
        mocks.pgPool.query.mockResolvedValueOnce({ rows: [{ ngay: 'd', soLuong: 3 }] });
        const { timeseries } = await import('../admin-service/src/controllers/reportController.js');
        const res = makeRes();
        await timeseries(makeReq(), res);
        expect(res.body.data.doanhThu[0].tien).toBe(12.5);
        expect(res.body.data.hoSoUngTuyen[0].soLuong).toBe(3);

        mocks.mysqlPool.query.mockReset().mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
        mocks.pgPool.query.mockRejectedValue(new Error('pg'));
        const degraded = makeRes();
        await timeseries(makeReq(), degraded);
        expect(degraded.body.data.hoSoUngTuyen).toEqual([]);
        mocks.mysqlPool.query.mockRejectedValue(new Error('mysql'));
        const failed = makeRes();
        await timeseries(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('returns four distribution datasets and handles failures', async () => {
        const datasets = [[{ ten: 'IT' }], [{ ten: 'HN' }], [{ ten: 'High' }], [{ ten: 'Admin' }]];
        datasets.forEach((x) => mocks.mysqlPool.query.mockResolvedValueOnce([x]));
        const { distribution } = await import('../admin-service/src/controllers/reportController.js');
        const res = makeRes();
        await distribution(makeReq(), res);
        expect(res.body.data).toEqual({ theoNganhNghe: datasets[0], theoTinhThanh: datasets[1], theoMucLuong: datasets[2], theoVaiTro: datasets[3] });
        mocks.mysqlPool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await distribution(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('fills missing funnel stages and computes conversion rate', async () => {
        mocks.pgPool.query.mockResolvedValueOnce({ rows: [{ stage: 'moi_ung_tuyen', soLuong: 8 }, { stage: 'nhan_viec', soLuong: 2 }] }).mockResolvedValueOnce({ rows: [{ congTyId: 1 }] });
        const { recruitmentFunnel } = await import('../admin-service/src/controllers/reportController.js');
        const res = makeRes();
        await recruitmentFunnel(makeReq(), res);
        expect(res.body.data).toMatchObject({ tong: 10, tyLeTuyen: 20, topCongTy: [{ congTyId: 1 }] });
        expect(res.body.data.pheu).toHaveLength(6);
        mocks.pgPool.query.mockReset().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
        const empty = makeRes();
        await recruitmentFunnel(makeReq(), empty);
        expect(empty.body.data.tyLeTuyen).toBe(0);
        mocks.pgPool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await recruitmentFunnel(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('maps activity aggregates and handles failures', async () => {
        mocks.AuditLog.aggregate
            .mockResolvedValueOnce([{ _id: 'job.created', soLuong: 2 }])
            .mockResolvedValueOnce([{ _id: 'job', soLuong: 3 }])
            .mockResolvedValueOnce([{ _id: '2026-01-01', soLuong: 4 }]);
        const { activity } = await import('../admin-service/src/controllers/reportController.js');
        const res = makeRes();
        await activity(makeReq(), res);
        expect(res.body.data).toEqual({
            theoLoai: [{ ten: 'job.created', soLuong: 2 }],
            theoService: [{ ten: 'job', soLuong: 3 }],
            theoNgay: [{ ngay: '2026-01-01', soLuong: 4 }]
        });
        mocks.AuditLog.aggregate.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await activity(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });
});
