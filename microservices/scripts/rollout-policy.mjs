// Pure evaluation of read-only observations. Unknown evidence never means ready.
export const featureFlags = {
    search: ['REACT_APP_JOB_SEARCH_MODE', 'legacy', 'core'],
    progress: ['REACT_APP_APPLICATION_PROGRESS_ENABLED', 'false', 'true'],
    ai: ['REACT_APP_CANDIDATE_AI_ENABLED', 'false', 'true'],
    preparedCv: ['REACT_APP_PREPARED_CV_APPLICATION_ENABLED', 'false', 'true'],
    workspace: ['REACT_APP_JOB_WORKSPACE_MODE', 'legacy', 'core'],
    create: ['REACT_APP_JOB_CREATE_MODE', 'legacy', 'core'],
    edit: ['REACT_APP_JOB_EDIT_MODE', 'legacy', 'core'],
    repost: ['REACT_APP_JOB_REPOST_MODE', 'legacy', 'core']
};
export const mysqlTables = ['users','accounts','companies','posts','detailposts','cvs','notes','outbox_events',
    'job_request_keys','ai_request_keys','ai_tasks','job_moderation_state','ai_result_inbox'];

export function hasExactUnique(indexes, table, columns, primary = false) {
    const groups = new Map();
    for (const row of indexes || []) {
        if (row.table !== table || Number(row.nonUnique) !== 0 || (primary && row.name !== 'PRIMARY')) continue;
        groups.set(row.name, [...(groups.get(row.name) || []), row]);
    }
    return [...groups.values()].some(rows => rows.length === columns.length && rows.every(row => row.prefix == null
        && typeof row.column === 'string') && rows.map(row => row.column.toLowerCase()).sort().join(',') === [...columns].map(x => x.toLowerCase()).sort().join(','));
}

export function mysqlChecks(snapshot) {
    if (!snapshot?.tables || !snapshot?.indexes || !snapshot?.columns) return [{ id: 'mysql.metadata', status: 'unknown' }];
    const checks = mysqlTables.map(name => ({ id: 'mysql.engine.' + name,
        status: snapshot.tables.some(row => row.name === name && row.engine?.toUpperCase() === 'INNODB') ? 'pass' : 'blocked' }));
    for (const [table, columns, primary] of [['cvs',['userId','postId'],false], ['job_request_keys',['userId','requestKey'],true],
        ['ai_request_keys',['userId','requestKey'],true], ['ai_request_keys',['taskId'],false], ['outbox_events',['id'],true]]) {
        checks.push({ id: `mysql.unique.${table}.${columns.join('+')}`, status: hasExactUnique(snapshot.indexes, table, columns, primary) ? 'pass' : 'blocked' });
    }
    for (const table of ['job_request_keys','ai_request_keys']) {
        const key = snapshot.columns.find(row => row.table === table && row.name === 'requestKey');
        checks.push({ id: `mysql.key.${table}`, status: key?.type === 'varchar' && Number(key.length) === 128
            && key.collation === 'ascii_bin' && key.nullable === 'NO' ? 'pass' : 'blocked' });
    }
    return checks;
}

// These must be verified on the target, not inferred from acceptance fixtures.
export const manualGates = ['verified-backup-restore', 'compatible-immutable-release-pair', 'served-frontend-flags',
    'running-legacy-version-and-jwt', 'database-privileges-and-full-schema', 'pending-event-compatibility',
    'target-cross-role-smoke', 'rollback-rehearsal'];

export function evaluateFeatures(checks) {
    const common = ['runtime.api-gateway', 'jwt.disk-to-gateway', 'internal-secret-consistency', 'secret-policy', ...manualGates];
    const needs = {
        search: ['runtime.search-service','runtime.job-core-service','broker.persistence'],
        progress: ['runtime.application-service','runtime.job-core-service','postgres.application-schema','broker.persistence',
            'mysql.engine.cvs','mysql.engine.outbox_events','mysql.unique.cvs.userId+postId'],
        ai: ['runtime.identity-service','runtime.job-core-service','runtime.ai-worker','runtime.admin-service','runtime.notification-service',
            'broker.persistence','mysql.engine.ai_tasks','mysql.engine.ai_request_keys','mysql.key.ai_request_keys', 'provider-approved'],
        preparedCv: ['runtime.identity-service','runtime.application-service','runtime.job-core-service','broker.persistence',
            'mysql.engine.cvs','mysql.engine.outbox_events','mysql.unique.cvs.userId+postId','postgres.application-schema'],
        workspace: ['runtime.job-core-service','mysql.engine.posts','mysql.engine.detailposts','mysql.engine.notes','mysql.engine.job_moderation_state'],
        create: ['runtime.job-core-service','runtime.ai-worker','runtime.notification-service','runtime.admin-service','broker.persistence','mysql.key.job_request_keys'],
        edit: ['runtime.job-core-service','runtime.ai-worker','runtime.notification-service','runtime.admin-service','broker.persistence','mysql.engine.job_moderation_state'],
        repost: ['runtime.job-core-service','runtime.ai-worker','runtime.notification-service','runtime.admin-service','broker.persistence','mysql.key.job_request_keys']
    };
    return Object.fromEntries(Object.keys(featureFlags).map(feature => {
        const gates = [...new Set([...common, ...needs[feature], ...(feature === 'workspace' || feature === 'search' ? [] : mysqlTables.map(name => 'mysql.engine.' + name))])];
        const unresolved = gates.filter(id => checks.find(check => check.id === id)?.status !== 'pass');
        return [feature, { decision: unresolved.length ? 'hold' : 'ready-for-review', unresolved }];
    }));
}
