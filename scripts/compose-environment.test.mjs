import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeEnvironment } from './release/compose-environment.mjs';

test('release overrides survive JSON serialization for both Compose environment formats', () => {
    for (const input of [['MYSQL_PASSWORD=old', 'LEGACY_URL=http://old:5000', 'TOKEN=a=b=c', 'INHERITED'],
        { MYSQL_PASSWORD: 'old', LEGACY_URL: 'http://old:5000', TOKEN: 'a=b=c', INHERITED: null }]) {
        const environment = composeEnvironment(input);
        Object.assign(environment, { MYSQL_PASSWORD: '${MYSQL_PASSWORD:?required}', LEGACY_URL: 'http://backend:5000', EMAIL_APP: '' });
        const restored = JSON.parse(JSON.stringify({ environment })).environment;
        assert.equal(restored.MYSQL_PASSWORD, '${MYSQL_PASSWORD:?required}');
        assert.equal(restored.LEGACY_URL, 'http://backend:5000');
        assert.equal(restored.EMAIL_APP, '');
        assert.equal(restored.TOKEN, 'a=b=c');
        assert.equal(restored.INHERITED, null);
        assert.equal(Array.isArray(restored), false);
    }
});
