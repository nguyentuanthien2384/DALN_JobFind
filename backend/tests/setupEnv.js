process.env.JWT_SECRET ||= 'backend-unit-test-secret-2026-unique-value';

// Unit tests must never inherit enabled delivery from the developer machine.
process.env.WEB_PUSH_ENABLED = "false";
