// Prevent unit tests (including jest.isolateModules) from loading developer local .env secrets.
jest.mock('dotenv', () => {
    const actual = jest.requireActual('dotenv');
    return {
        ...actual,
        config: jest.fn(() => ({ parsed: {} }))
    };
});

process.env.JWT_SECRET ||= 'backend-unit-test-secret-2026-unique-value';

// Unit tests must never inherit enabled delivery from the developer machine.
process.env.WEB_PUSH_ENABLED = 'false';
// Existing policy tests use pre-migration JWT fixtures. Session tests override this.
process.env.AUTH_ALLOW_LEGACY_TOKENS = 'true';
