const { assertSecureJwtSecret } = require('../../src/utils/securityConfig');

describe('security configuration', () => {
  test.each([undefined, '', 'short-secret', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) (
    'rejects a missing, short or low-entropy JWT secret',
    (value) => expect(() => assertSecureJwtSecret(value)).toThrow(/JWT_SECRET/)
  );

  test('accepts a long high-entropy JWT secret', () => {
    const value = 'Correct-Horse_Battery-Staple_2026!Jwt';
    expect(assertSecureJwtSecret(value)).toBe(value);
  });
});
