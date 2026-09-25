const Sequelize = require('sequelize');
const migration = require('../../src/migrations/migrationzzzzzzzzzzzz-canonical-it-job-levels');
const previousMigration = require('../../src/migrations/migrationzzzzzzzzzzz-it-job-levels');
const seedCodes = require('../../src/seeders/20250101000001-demo-allcodes');
const seedDetails = require('../../src/seeders/20250101000010-demo-detailposts');
const { assertEventPayload } = require('../../src/contracts/eventValidator.cjs')(require('../../src/contracts/events.v1.json').events);

const canonicalCodes = ['intern', 'fresher', 'junior', 'middle', 'senior', 'lead', 'manager'];
const aliasCodes = ['nhan-vien', 'truong-phong', 'giam-doc'];
const copy = value => JSON.parse(JSON.stringify(value));

// Small transactional database double: assertions check committed rows and actual
// event contracts, including rollback on failed reference validation/outbox writes.
function database({ codes = [], details = [], posts = [], outbox = true, engine = 'InnoDB', otherReference } = {}) {
    const state = { Allcodes: copy(codes), DetailPosts: copy(details), Posts: copy(posts), ...(outbox ? { outbox_events: [] } : {}) };
    const transaction = {};
    const matches = (row, where) => Object.entries(where).every(([key, value]) => String(row[key]).toLowerCase() === String(value).toLowerCase());
    const q = {
        showAllTables: jest.fn(async () => Object.keys(state)),
        queryGenerator: { quoteTable: name => `\`${name}\``, quoteIdentifier: name => `\`${name}\`` },
        sequelize: {
            transaction: jest.fn(async work => {
                const before = copy(state);
                try { return await work(transaction); }
                catch (error) { Object.assign(state, before); throw error; }
            }),
            query: jest.fn(async (sql, options = {}) => {
                if (sql.includes('information_schema.TABLES')) return Object.keys(state).map(name => ({ name, engine }));
                if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [
                    { tableName: 'DetailPosts', columnName: 'categoryJoblevelCode' },
                    ...(otherReference ? [{ tableName: 'DetailPosts', columnName: otherReference }] : []),
                ];
                if (/SELECT code(?:, type)? FROM/.test(sql)) return copy(state.Allcodes.filter(row => !sql.includes("type = 'JOBLEVEL'") || row.type === 'JOBLEVEL'));
                if (sql.includes('SELECT p.id')) return state.Posts.flatMap(post => {
                    const detail = state.DetailPosts.find(row => row.id === post.detailPostId);
                    return detail && options.replacements.includes(detail.categoryJoblevelCode)
                        ? [{ id: post.id, statusCode: post.statusCode, name: detail.name, categoryJoblevelCode: detail.categoryJoblevelCode }] : [];
                });
                const reference = sql.match(/SELECT `([^`]+)` FROM `([^`]+)`/);
                if (reference) return state[reference[2]].filter(row => options.replacements.includes(row[reference[1]])).slice(0, 1);
                throw new Error(`Unexpected query: ${sql}`);
            }),
        },
        bulkInsert: jest.fn(async (table, rows) => {
            if (table === 'Allcodes') for (const row of rows) {
                if (state.Allcodes.some(existing => existing.code.toLowerCase() === row.code.toLowerCase())) throw new Error('duplicate code');
            }
            if (table === 'DetailPosts') for (const row of rows) {
                if (!state.Allcodes.some(code => code.code === row.categoryJoblevelCode && code.type === 'JOBLEVEL')) throw new Error('missing job level');
            }
            state[table].push(...copy(rows));
        }),
        bulkUpdate: jest.fn(async (table, update, where) => state[table].forEach(row => { if (matches(row, where)) Object.assign(row, update); })),
        bulkDelete: jest.fn(async (table, where) => { state[table] = state[table].filter(row => !matches(row, where)); }),
    };
    return { q, state, transaction };
}

const legacyCodes = () => aliasCodes.map(code => ({ code, type: 'JOBLEVEL', value: code }));
const legacyDetails = () => aliasCodes.map((categoryJoblevelCode, index) => ({ id: index + 1, name: `Job ${index + 1}`, categoryJoblevelCode }));

test('migrates all job references and commits one contract-valid invalidation for every affected post', async () => {
    const { q, state, transaction } = database({ codes: legacyCodes(), details: legacyDetails(), posts: [
        { id: 21, detailPostId: 1, statusCode: 'PS1' }, { id: 22, detailPostId: 1, statusCode: 'PS4' },
        { id: 23, detailPostId: 2, statusCode: 'PS3' },
    ] });
    expect(await migration.up(q, Sequelize)).toEqual({ updatedPosts: 3, levels: canonicalCodes });
    expect(state.DetailPosts.map(row => row.categoryJoblevelCode)).toEqual(['junior', 'lead', 'manager']);
    expect(state.Allcodes.map(row => row.code)).toEqual(canonicalCodes);
    expect(state.outbox_events).toHaveLength(3);
    for (const event of state.outbox_events) {
        const payload = JSON.parse(event.payload);
        expect(() => assertEventPayload(event.eventType, payload, { aggregateId: event.aggregateId })).not.toThrow();
        expect(event.aggregateType).toBe('legacy-job');
        expect(payload.job.categoryJoblevelCode).toBe(event.aggregateId === '23' ? 'lead' : 'junior');
    }
    for (const mutation of [q.bulkInsert, q.bulkUpdate, q.bulkDelete]) for (const call of mutation.mock.calls) {
        expect(call[call.length - 1]).toEqual({ transaction });
    }
});

test('rerunning preserves administrator labels/custom levels and emits no duplicate events', async () => {
    const { q, state } = database({ codes: [...legacyCodes(), { code: 'junior', type: 'JOBLEVEL', value: 'Junior Engineer' },
        { code: 'principal', type: 'JOBLEVEL', value: 'Principal Engineer' }], details: legacyDetails(),
        posts: [{ id: 21, detailPostId: 1, statusCode: 'PS1' }] });
    await migration.up(q, Sequelize);
    const first = copy(state);
    expect((await migration.up(q, Sequelize)).updatedPosts).toBe(0);
    expect(state).toEqual(first);
    expect(state.Allcodes.find(row => row.code === 'junior').value).toBe('Junior Engineer');
    expect(state.Allcodes.find(row => row.code === 'principal').value).toBe('Principal Engineer');
});

test('fresh migrations followed by demo seeders have no duplicate levels or dangling references', async () => {
    const { q, state } = database({ outbox: false });
    await previousMigration.up(q, Sequelize);
    await migration.up(q, Sequelize);
    await seedCodes.up(q, Sequelize);
    await seedDetails.up(q, Sequelize);
    expect(state.Allcodes.filter(row => row.type === 'JOBLEVEL').map(row => row.code).sort()).toEqual([...canonicalCodes].sort());
    expect(state.DetailPosts.length).toBeGreaterThan(0);
    expect(state.DetailPosts.every(row => canonicalCodes.includes(row.categoryJoblevelCode))).toBe(true);
});

test('rolls back references and catalog inserts if an affected database lacks its outbox', async () => {
    const { q, state } = database({ codes: legacyCodes(), details: legacyDetails(), outbox: false,
        posts: [{ id: 21, detailPostId: 1, statusCode: 'PS1' }] });
    const before = copy(state);
    await expect(migration.up(q, Sequelize)).rejects.toThrow('Missing outbox_events');
    expect(state).toEqual(before);
});

test('rolls back when an alias is still referenced by another classification', async () => {
    const { q, state } = database({ codes: legacyCodes(), details: [{ ...legacyDetails()[0], categoryJobCode: 'nhan-vien' }],
        otherReference: 'categoryJobCode' });
    const before = copy(state);
    await expect(migration.up(q, Sequelize)).rejects.toThrow('DetailPosts.categoryJobCode');
    expect(state).toEqual(before);
});

test('rolls back remapped details when recording an invalidation fails', async () => {
    const { q, state } = database({ codes: legacyCodes(), details: legacyDetails(),
        posts: [{ id: 21, detailPostId: 1, statusCode: 'PS1' }] });
    const before = copy(state), insert = q.bulkInsert.getMockImplementation();
    q.bulkInsert.mockImplementation(async (table, ...args) => {
        if (table === 'outbox_events') throw new Error('outbox unavailable');
        return insert(table, ...args);
    });
    await expect(migration.up(q, Sequelize)).rejects.toThrow('outbox unavailable');
    expect(state).toEqual(before);
});

test.each([
    [{ engine: 'MyISAM' }, 'must use InnoDB'],
    [{ codes: [{ code: 'junior', type: 'JOBTYPE', value: 'Other' }] }, 'belongs to JOBTYPE'],
])('rejects unsafe schema/catalog %j without changes', async (input, error) => {
    const { q, state } = database(input), before = copy(state);
    await expect(migration.up(q, Sequelize)).rejects.toThrow(error);
    expect(state).toEqual(before);
});
