const {
  ROLES,
  PERMISSIONS,
  permissionMatrix,
  getRoleCode,
  isPermissionGranted,
  getGrantedPermissions,
  authorize
} = require('../../src/middlewares/authorize');
const { createResponse } = require('../helpers/http');

const reqFor = (roleCode, companyId = null) => ({
  user: { id: 7, companyId, userAccountData: { roleCode } }
});

describe('central backend authorization policy', () => {
  test('defines every supported role and a rule for every permission', () => {
    expect(Object.values(ROLES)).toEqual(['ADMIN', 'COMPANY', 'EMPLOYER', 'CANDIDATE']);
    expect(Object.keys(permissionMatrix).sort()).toEqual(Object.values(PERMISSIONS).sort());
    for (const rule of Object.values(permissionMatrix)) {
      expect(rule.roles.length).toBeGreaterThan(0);
      expect(rule.roles.every((role) => Object.values(ROLES).includes(role))).toBe(true);
    }
  });

  test.each([
    ['ADMIN', null, [
      'account:self', 'administration:manage', 'company:private:read',
      'recruitment:read', 'recruitment:report:read', 'candidate:profile:read',
      'candidate:search', 'package:catalog:read', 'package:history:read',
      'notification:read'
    ]],
    ['COMPANY', 4, [
      'account:self', 'company:private:read', 'company:manage',
      'company:team:manage', 'company:team:exit', 'job:manage',
      'recruitment:read', 'recruitment:report:read', 'candidate:profile:read',
      'candidate:search', 'package:catalog:read', 'package:purchase',
      'package:history:read', 'notification:read', 'chat:use'
    ]],
    ['EMPLOYER', 4, [
      'account:self', 'company:team:exit', 'job:manage', 'recruitment:read',
      'recruitment:report:read', 'candidate:profile:read', 'candidate:search',
      'notification:read', 'chat:use'
    ]],
    ['EMPLOYER', null, [
      'account:self', 'company:create', 'candidate:profile:read', 'notification:read'
    ]],
    ['CANDIDATE', null, [
      'account:self', 'candidate:apply', 'candidate:profile:read',
      'recommendation:read', 'social:interact', 'notification:read', 'chat:use'
    ]]
  ])('%s with company=%s receives only its exact permission set', (roleCode, companyId, expected) => {
    expect(getGrantedPermissions(reqFor(roleCode, companyId)).sort()).toEqual(expected.sort());
  });

  test('fails closed for unknown roles, permissions, and missing identities', () => {
    expect(getRoleCode({})).toBeNull();
    expect(isPermissionGranted(reqFor('UNKNOWN'), PERMISSIONS.ACCOUNT_SELF)).toBe(false);
    expect(isPermissionGranted(reqFor('ADMIN'), 'missing:permission')).toBe(false);
    expect(isPermissionGranted({}, PERMISSIONS.ACCOUNT_SELF)).toBe(false);

    const res = createResponse();
    authorize('missing:permission')({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 401 without identity, 403 without permission, and annotates allowed requests', () => {
    let res = createResponse();
    authorize(PERMISSIONS.JOB_MANAGE)({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);

    res = createResponse();
    const deniedNext = jest.fn();
    authorize(PERMISSIONS.JOB_MANAGE)(reqFor('CANDIDATE'), res, deniedNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deniedNext).not.toHaveBeenCalled();

    const req = reqFor('EMPLOYER', '12');
    const next = jest.fn();
    authorize(PERMISSIONS.JOB_MANAGE)(req, createResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.authorization).toEqual({
      permission: 'job:manage', roleCode: 'EMPLOYER', companyId: 12
    });
  });

  test('company creation and tenant-required permissions react to current company membership', () => {
    expect(isPermissionGranted(reqFor('EMPLOYER'), PERMISSIONS.COMPANY_CREATE)).toBe(true);
    expect(isPermissionGranted(reqFor('EMPLOYER', 3), PERMISSIONS.COMPANY_CREATE)).toBe(false);
    expect(isPermissionGranted(reqFor('CANDIDATE'), PERMISSIONS.COMPANY_CREATE)).toBe(false);
    expect(isPermissionGranted(reqFor('COMPANY'), PERMISSIONS.COMPANY_MANAGE)).toBe(false);
    expect(isPermissionGranted(reqFor('COMPANY', 3), PERMISSIONS.COMPANY_MANAGE)).toBe(true);
  });
});
