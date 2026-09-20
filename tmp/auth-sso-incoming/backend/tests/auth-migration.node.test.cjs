// Dependency-free schema smoke test: node --test tests/auth-migration.node.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/migrations/migrationzzzzzzz-auth-sessions-sso');
test('auth migration creates three separate tables and unique identity/session keys', async () => {
  const tables = new Map(), indexes = [];
  const q = { createTable: async (name, fields) => tables.set(name, fields),
    addIndex: async (name, fields, opts) => indexes.push({ name, fields, ...opts }) };
  const S = new Proxy({ UUID: 'UUID', INTEGER: 'INTEGER', DATE: 'DATE' },
    { get(target, key) { return target[key] || ((n) => `${String(key)}(${n})`); } });
  await migration.up(q, S);
  assert.deepEqual([...tables.keys()], ['AuthSessions', 'AuthIdentities', 'OidcTransactions']);
  assert.equal(tables.get('AuthSessions').tokenHash.unique, true);
  assert.equal(tables.get('OidcTransactions').browserHash.allowNull, false);
  assert.ok(indexes.some(i => i.unique && i.name === 'uq_oidc_issuer_subject'));
});
