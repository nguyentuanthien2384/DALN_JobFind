// Runs only against test-auth-integration's disposable database.
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
module.exports = async ({ db, base, headers, password, user }) => {
  const users = require('../../src/services/userService');
  const post = (route, body, cookie) => fetch(base + route, { method: 'POST',
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const data = { firstName: 'Registration', lastName: 'Fixture', email: 'new.jobfind.fixture@gmail.com',
    phonenumber: '0970000001', password: 'Mật khẩu an toàn!9', roleCode: 'CANDIDATE', companyId: 999 };
  for (const patch of [{ password: '1234567' }, { password: 'é'.repeat(37) }, { phonenumber: '123' },
    { firstName: {} }, { roleCode: 'ADMIN' }, { password: null }]) {
    const rejected = await (await post('/api/create-new-user', { ...data, ...patch })).json();
    assert.notEqual(rejected.errCode, 0);
  }
  assert.equal(await db.User.count({ where: { email: data.email } }), 0);
  const races = await Promise.all([data, { ...data, phonenumber: '0970000002', email: ' NEW.JOBFIND.FIXTURE@GMAIL.COM ' }]
    .map(body => post('/api/create-new-user', body).then(res => res.json())));
  assert.equal(races.filter(result => result.errCode === 0).length, 1);
  assert.equal(races.filter(result => result.errCode === 4).length, 1);
  const saved = await db.User.findOne({ where: { email: data.email }, raw: true });
  assert.equal(saved.companyId, null);
  const account = await db.Account.findOne({ where: { userId: saved.id }, raw: true });
  assert.equal(account.roleCode, 'CANDIDATE');
  assert.equal(await bcrypt.compare(data.password, account.password), true);
  for (const rememberMe of [false, true]) {
    const response = await post('/api/login', { identifier: ' NEW.JOBFIND.FIXTURE@GMAIL.COM ', password: data.password, rememberMe });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.equal(/Max-Age=/.test(cookie), rememberMe);
    const body = await response.json();
    assert.equal(body.user.id, saved.id);
    const refreshed = await post('/api/auth/refresh', {}, cookie.split(';')[0]);
    assert.equal(refreshed.status, 200);
    assert.equal(/Max-Age=/.test(refreshed.headers.get('set-cookie')), rememberMe);
  }
  // Existing short passwords can still log in; policy applies to newly set passwords.
  const legacyPassword = 'abc123';
  const legacy = await db.User.create({ firstName: 'Legacy', email: user.email.toUpperCase() });
  await db.Account.create({ userId: legacy.id, phonenumber: '0970000003', password: await bcrypt.hash(legacyPassword, 10), roleCode: 'CANDIDATE', statusCode: 'S1' });
  assert.equal((await post('/api/login', { identifier: user.email, password })).status, 401, 'Ambiguous email must never select one legacy user');
  assert.equal((await post('/api/login', { phonenumber: '0970000003', password: legacyPassword })).status, 200);
  await db.Account.destroy({ where: { userId: legacy.id } }); await db.User.destroy({ where: { id: legacy.id } });
  const originalCreate = db.Account.create;
  try {
    db.Account.create = async () => { throw new Error('simulated account write failure'); };
    await assert.rejects(users.createRegisteredAccount({ ...data, email: 'rollback.jobfind.fixture@gmail.com', phonenumber: '0970000004' }), /simulated/);
  } finally { db.Account.create = originalCreate; }
  assert.equal(await db.User.count({ where: { email: 'rollback.jobfind.fixture@gmail.com' } }), 0, 'No orphan profile after account creation failure');
  const passwordChanges = await Promise.all([
    users.handleChangePassword({ id: saved.id, oldpassword: data.password, password: 'New password one!9' }),
    users.handleChangePassword({ id: saved.id, oldpassword: data.password, password: 'New password two!9' }),
  ]);
  assert.equal(passwordChanges.filter(result => result.errCode === 0).length, 1, 'Only one concurrent request may use the old password proof');
  console.log('PASS: real DB registration validation, concurrent normalized email uniqueness, atomic rollback, email/phone login, legacy password compatibility, remember-me cookie and refresh.');
};
