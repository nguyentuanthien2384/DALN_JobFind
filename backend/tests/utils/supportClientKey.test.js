const { createHmac } = require('node:crypto');
const { supportClientKey } = require('../../src/utils/supportClientKey');

test('trusts only correctly signed gateway visitor addresses', () => {
    const previous = process.env.INTERNAL_SECRET;
    process.env.INTERNAL_SECRET = 'test-only-secret';
    try {
        const req = { ip: '127.0.0.1', headers: { 'x-support-ip': '192.0.2.1', 'x-support-signature': '0'.repeat(64) } };
        expect(supportClientKey(req)).toBe('127.0.0.1');
        req.headers['x-support-signature'] = createHmac('sha256', process.env.INTERNAL_SECRET).update('192.0.2.1').digest('hex');
        expect(supportClientKey(req)).toBe('192.0.2.1');
        req.headers['x-support-ip'] = 'not-an-ip';
        expect(supportClientKey(req)).toBe('127.0.0.1');
    } finally { if (previous === undefined) delete process.env.INTERNAL_SECRET; else process.env.INTERNAL_SECRET = previous; }
});
