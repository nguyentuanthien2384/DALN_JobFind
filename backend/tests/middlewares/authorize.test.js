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
  user: {
    id: 7,
    companyId,
    userAccountData: { roleCode },
    userCompanyData: companyId
      ? { id: companyId, statusCode: 'S1', censorCode: 'CS1' }
      : {}
  }
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
    ['ADMIN', null, Object.values(PERMISSIONS).filter(permission => permission !== PERMISSIONS.CANDIDATE_APPLY)],
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
      'account:self', 'company:create', 'notification:read'
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

  test('companyless ADMIN retains access to other permission families', () => {
    const representativePermissions = [
      PERMISSIONS.COMPANY_MANAGE,
      PERMISSIONS.JOB_MANAGE,
      PERMISSIONS.PACKAGE_PURCHASE,
      PERMISSIONS.SOCIAL_INTERACT,
      PERMISSIONS.CHAT
    ];

    for (const permission of representativePermissions) {
      const req = reqFor('ADMIN');
      const res = createResponse();
      const next = jest.fn();

      authorize(permission)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(req.authorization).toEqual({
        permission,
        roleCode: 'ADMIN',
        companyId: null
      });
    }

    expect(isPermissionGranted(reqFor('ADMIN'), 'missing:permission')).toBe(false);
  });

  test.each([
    [null, 401],
    ['ADMIN', 403],
    ['COMPANY', 403],
    ['EMPLOYER', 403],
    ['CANDIDATE', null]
  ])('application submission accepts only candidates: role=%s', (roleCode, deniedStatus) => {
    const req = roleCode ? reqFor(roleCode, roleCode === 'CANDIDATE' ? null : 4) : {};
    const res = createResponse();
    const next = jest.fn();

    authorize(PERMISSIONS.CANDIDATE_APPLY)(req, res, next);

    if (deniedStatus) {
      expect(res.status).toHaveBeenCalledWith(deniedStatus);
      expect(next).not.toHaveBeenCalled();
    } else {
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.authorization).toMatchObject({ permission: 'candidate:apply', roleCode: 'CANDIDATE' });
    }
  });

  test('operational recruiter permissions require a currently active and approved company', () => {
    const pending = reqFor('COMPANY', 3);
    pending.user.userCompanyData.censorCode = 'CS3';
    expect(isPermissionGranted(pending, PERMISSIONS.COMPANY_MANAGE)).toBe(true);
    expect(isPermissionGranted(pending, PERMISSIONS.JOB_MANAGE)).toBe(false);
    expect(isPermissionGranted(pending, PERMISSIONS.CANDIDATE_SEARCH)).toBe(false);
    expect(isPermissionGranted(pending, PERMISSIONS.PACKAGE_PURCHASE)).toBe(false);

    const banned = reqFor('EMPLOYER', 3);
    banned.user.userCompanyData.statusCode = 'S2';
    expect(isPermissionGranted(banned, PERMISSIONS.RECRUITMENT_READ)).toBe(false);
    expect(isPermissionGranted(banned, PERMISSIONS.CHAT)).toBe(false);
    expect(isPermissionGranted(banned, PERMISSIONS.COMPANY_TEAM_EXIT)).toBe(true);
  });
});

// Decision table written independently of permissionMatrix: for every permission, which role may
// act in which company state. `none` = no company, `pending` = company not yet approved,
// `approved` = active approved company. ADMIN may do everything except apply for a job.
describe('authorization decision table', () => {
  const STATES = ['none', 'pending', 'approved'];
  const ANY = STATES;
  const WITH_COMPANY = ['pending', 'approved'];
  const APPROVED = ['approved'];
  const ADMIN_ALL = { ADMIN: ANY };
  const spec = {
    [PERMISSIONS.ACCOUNT_SELF]: { ...ADMIN_ALL, COMPANY: ANY, EMPLOYER: ANY, CANDIDATE: ANY },
    [PERMISSIONS.ADMINISTRATION]: { ...ADMIN_ALL },
    [PERMISSIONS.COMPANY_CREATE]: { ...ADMIN_ALL, EMPLOYER: ['none'] },
    [PERMISSIONS.COMPANY_PRIVATE_READ]: { ...ADMIN_ALL, COMPANY: WITH_COMPANY },
    [PERMISSIONS.COMPANY_MANAGE]: { ...ADMIN_ALL, COMPANY: WITH_COMPANY },
    [PERMISSIONS.COMPANY_TEAM_MANAGE]: { ...ADMIN_ALL, COMPANY: APPROVED },
    [PERMISSIONS.COMPANY_TEAM_EXIT]: { ...ADMIN_ALL, COMPANY: WITH_COMPANY, EMPLOYER: WITH_COMPANY },
    [PERMISSIONS.JOB_MANAGE]: { ...ADMIN_ALL, COMPANY: APPROVED, EMPLOYER: APPROVED },
    [PERMISSIONS.RECRUITMENT_READ]: { ...ADMIN_ALL, COMPANY: APPROVED, EMPLOYER: APPROVED },
    [PERMISSIONS.RECRUITMENT_REPORT_READ]: { ...ADMIN_ALL, COMPANY: APPROVED, EMPLOYER: APPROVED },
    [PERMISSIONS.CANDIDATE_APPLY]: { CANDIDATE: ANY },
    [PERMISSIONS.CANDIDATE_PROFILE_READ]: { ...ADMIN_ALL, COMPANY: APPROVED, EMPLOYER: APPROVED, CANDIDATE: ANY },
    [PERMISSIONS.CANDIDATE_SEARCH]: { ...ADMIN_ALL, COMPANY: APPROVED, EMPLOYER: APPROVED },
    [PERMISSIONS.RECOMMENDATION_READ]: { ...ADMIN_ALL, CANDIDATE: ANY },
    [PERMISSIONS.PACKAGE_CATALOG_READ]: { ...ADMIN_ALL, COMPANY: ANY },
    [PERMISSIONS.PACKAGE_PURCHASE]: { ...ADMIN_ALL, COMPANY: APPROVED },
    [PERMISSIONS.PACKAGE_HISTORY_READ]: { ...ADMIN_ALL, COMPANY: APPROVED },
    [PERMISSIONS.SOCIAL_INTERACT]: { ...ADMIN_ALL, CANDIDATE: ANY },
    [PERMISSIONS.NOTIFICATION_READ]: { ...ADMIN_ALL, COMPANY: ANY, EMPLOYER: ANY, CANDIDATE: ANY },
    [PERMISSIONS.CHAT]: { ...ADMIN_ALL, COMPANY: APPROVED, EMPLOYER: APPROVED, CANDIDATE: ANY },
  };
  const requestIn = (roleCode, state) => ({
    user: {
      id: 7,
      companyId: state === 'none' ? null : 8,
      userAccountData: { roleCode },
      userCompanyData: state === 'none' ? null
        : { id: 8, statusCode: 'S1', censorCode: state === 'approved' ? 'CS1' : 'CS3' }
    }
  });
  const cases = Object.entries(spec).flatMap(([permission, allowed]) => Object.values(ROLES).flatMap((role) =>
    STATES.map((state) => [permission, role, state, Boolean(allowed[role]?.includes(state))])));

  test('covers every permission of the matrix', () => {
    expect(Object.keys(spec).sort()).toEqual(Object.keys(permissionMatrix).sort());
  });

  test.each(cases)('%s for %s with company %s -> allowed=%s', (permission, role, state, expected) => {
    const req = requestIn(role, state);
    expect(isPermissionGranted(req, permission)).toBe(expected);
    const res = createResponse();
    const next = jest.fn();
    authorize(permission)(req, res, next);
    if (expected) {
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.authorization).toEqual({ permission, roleCode: role, companyId: state === 'none' ? null : 8 });
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ errCode: 3, errMessage: 'Bạn không có quyền thực hiện thao tác này' });
    }
  });

  test.each([
    ['company data of another tenant', { id: 9, statusCode: 'S1', censorCode: 'CS1' }],
    ['a locked company', { id: 8, statusCode: 'S2', censorCode: 'CS1' }],
    ['no company data', undefined],
  ])('treats %s as not approved', (_case, companyData) => {
    const req = { user: { id: 7, companyId: 8, userAccountData: { roleCode: 'EMPLOYER' }, userCompanyData: companyData } };
    expect(isPermissionGranted(req, PERMISSIONS.JOB_MANAGE)).toBe(false);
    expect(isPermissionGranted(req, PERMISSIONS.COMPANY_TEAM_EXIT)).toBe(true);
  });

  test('an empty-string company id counts as no company', () => {
    const req = { user: { id: 7, companyId: '', userAccountData: { roleCode: 'EMPLOYER' }, userCompanyData: null } };
    expect(isPermissionGranted(req, PERMISSIONS.COMPANY_CREATE)).toBe(true);
    expect(isPermissionGranted(req, PERMISSIONS.COMPANY_TEAM_EXIT)).toBe(false);
  });

  test('answers 401 with a refresh hint without a user and 500 for an unknown policy', () => {
    const anonymous = createResponse();
    authorize(PERMISSIONS.CHAT)({}, anonymous, jest.fn());
    expect(anonymous.status).toHaveBeenCalledWith(401);
    expect(anonymous.json).toHaveBeenCalledWith({ errCode: 401, errMessage: 'Authentication required', refresh: true });
    const unknown = createResponse();
    authorize('typo:permission')(requestIn('ADMIN', 'none'), unknown, jest.fn());
    expect(unknown.status).toHaveBeenCalledWith(500);
    expect(unknown.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Authorization policy is not configured' });
  });

  test('keeps the permission identifiers stable for the frontend and gateway', () => {
    expect(PERMISSIONS).toMatchObject({
      ADMINISTRATION: 'administration:manage', COMPANY_TEAM_EXIT: 'company:team:exit',
      JOB_MANAGE: 'job:manage', CANDIDATE_APPLY: 'candidate:apply', PACKAGE_PURCHASE: 'package:purchase', CHAT: 'chat:use'
    });
  });
});
