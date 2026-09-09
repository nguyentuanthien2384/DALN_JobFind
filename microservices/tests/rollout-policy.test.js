import { describe, it, expect } from 'vitest';
import { hasExactUnique, mysqlChecks, mysqlTables, evaluateFeatures, featureFlags } from '../scripts/rollout-policy.mjs';

const index = (column, extra = {}) => ({ table:'cvs',name:'unique_cv',column,nonUnique:0,prefix:null,...extra });
describe('deployment preflight fails closed', () => {
    it('does not treat an absent observation as ready', () => {
        expect(Object.values(evaluateFeatures([])).every(feature => feature.decision === 'hold')).toBe(true);
        expect(mysqlChecks({ unavailable:true })).toEqual([{id:'mysql.metadata',status:'unknown'}]);
    });
    it('accepts a two-column unique in either order', () => {
        expect(hasExactUnique([index('postId'),index('userId')],'cvs',['userId','postId'])).toBe(true);
    });
    it.each([
        [index('userId'),index('postId'),index('extra')],
        [index('userId'),index('postId',{prefix:5})],
        [index('userId'),index('postId',{nonUnique:1})],
        [index('userId'),index(null)]
    ])('rejects unique indexes which cannot guarantee one application per job: %j', (...rows) => {
        expect(hasExactUnique(rows,'cvs',['userId','postId'])).toBe(false);
    });
    it('does not accept a secondary unique as a required primary key', () => {
        expect(hasExactUnique([index('userId'),index('postId')],'cvs',['userId','postId'],true)).toBe(false);
    });
    it('blocks missing and non-transactional tables', () => {
        const rows = mysqlChecks({ tables:[{name:'cvs',engine:'MyISAM'}],columns:[],indexes:[] });
        expect(rows.find(r=>r.id==='mysql.engine.cvs').status).toBe('blocked');
        expect(rows.filter(r=>r.id.startsWith('mysql.engine.'))).toHaveLength(mysqlTables.length);
        expect(rows.every(r=>r.status==='blocked')).toBe(true);
    });
    it('does not accept an unsafe request key collation', () => {
        const rows = mysqlChecks({tables:[], indexes:[], columns:[{table:'job_request_keys',name:'requestKey',type:'varchar',length:128,collation:'utf8mb4_general_ci',nullable:'NO'}]});
        expect(rows.find(r=>r.id==='mysql.key.job_request_keys').status).toBe('blocked');
    });
    it('does not confuse healthy dependencies with a release approval', () => {
        const needs = [...new Set(Object.values(evaluateFeatures([])).flatMap(f=>f.unresolved))];
        const checks = needs.map(id=>({id,status:id==='verified-backup-restore'?'unknown':'pass'}));
        expect(Object.values(evaluateFeatures(checks)).every(f=>f.decision==='hold')).toBe(true);
    });
    it('isolates feature-specific failures and still requires review', () => {
        const needs = [...new Set(Object.values(evaluateFeatures([])).flatMap(f=>f.unresolved))];
        const checks = needs.map(id=>({id,status:id==='runtime.ai-worker'?'blocked':'pass'}));
        const result=evaluateFeatures(checks);
        expect(result.ai.decision).toBe('hold'); expect(result.create.decision).toBe('hold');
        expect(result.search.decision).toBe('ready-for-review');
        expect(result.progress.decision).toBe('ready-for-review');
    });
    it('defines independent off/on settings for all eight frontend features', () => {
        expect(Object.keys(featureFlags)).toHaveLength(8);
        expect(new Set(Object.values(featureFlags).map(row=>row[0])).size).toBe(8);
        expect(Object.values(featureFlags).every(([,off,on])=>off!==on)).toBe(true);
    });
});
