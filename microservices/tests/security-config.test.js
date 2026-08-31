import { describe, expect, it } from 'vitest';
import { assertSecureJwtSecret, requireEnvironment } from '../shared/securityConfig.js';

describe('security configuration', () => {
    it.each([undefined, '', 'short-secret', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])(
        'rejects missing, short and low-entropy JWT secrets',
        (value) => expect(() => assertSecureJwtSecret(value)).toThrow(/JWT_SECRET/)
    );

    it('accepts a long high-entropy JWT secret', () => {
        const value = 'Correct-Horse_Battery-Staple_2026!Jwt';
        expect(assertSecureJwtSecret(value)).toBe(value);
    });

    it('requires non-empty service configuration', () => {
        const old = process.env.REQUIRED_TEST_SETTING;
        delete process.env.REQUIRED_TEST_SETTING;
        expect(() => requireEnvironment('REQUIRED_TEST_SETTING')).toThrow(/required/);
        process.env.REQUIRED_TEST_SETTING = ' configured ';
        expect(requireEnvironment('REQUIRED_TEST_SETTING')).toBe('configured');
        if (old === undefined) delete process.env.REQUIRED_TEST_SETTING;
        else process.env.REQUIRED_TEST_SETTING = old;
    });
});
