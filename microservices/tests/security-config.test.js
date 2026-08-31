import { describe, expect, it } from 'vitest';
import { assertSecureJwtSecret } from '../shared/securityConfig.js';

describe('security configuration', () => {
    it.each([undefined, '', 'short-secret', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])(
        'rejects missing, short and low-entropy JWT secrets',
        (value) => expect(() => assertSecureJwtSecret(value)).toThrow(/JWT_SECRET/)
    );

    it('accepts a long high-entropy JWT secret', () => {
        const value = 'Correct-Horse_Battery-Staple_2026!Jwt';
        expect(assertSecureJwtSecret(value)).toBe(value);
    });
});
