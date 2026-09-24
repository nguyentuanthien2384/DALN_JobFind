import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseMicroservices, composeEnvironment, bindClaudeWorkerEnvironment, bindClaudeChatEnvironment } from './release/compose-environment.mjs';

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

test('release worker binds the gateway URL with its key and model', () => {
    const required = name => '${' + name + ':?required}';
    const environment = bindClaudeWorkerEnvironment({ ANTHROPIC_BASE_URL: '', PORT: '4007' }, required);
    assert.equal(environment.ANTHROPIC_BASE_URL, '${ANTHROPIC_BASE_URL:?required}');
    assert.equal(environment.ANTHROPIC_API_KEY, '${ANTHROPIC_API_KEY:?required}');
    assert.equal(environment.CLAUDE_MODEL, '${CLAUDE_MODEL:?required}');
    assert.equal(environment.PORT, '4007');
    assert.equal(environment.AI_CONCURRENCY, '2');
});

test('release support chat binds the same gateway and requires an explicit schema migration', () => {
    const required = name => '${' + name + ':?required}';
    const environment = bindClaudeChatEnvironment({ ANTHROPIC_BASE_URL: '', SUPPORT_AUTO_MIGRATE: 'true', PORT: '4008' }, required);
    assert.equal(environment.ANTHROPIC_BASE_URL, '${ANTHROPIC_BASE_URL:?required}');
    assert.equal(environment.ANTHROPIC_API_KEY, '${ANTHROPIC_API_KEY:?required}');
    assert.equal(environment.SUPPORT_CLAUDE_MODEL, '${SUPPORT_CLAUDE_MODEL:?required}');
    assert.equal(environment.SUPPORT_AUTO_MIGRATE, 'false');
    assert.equal(environment.PORT, '4008');
});

test('release includes both Claude consumers', () => {
    assert.ok(releaseMicroservices.includes('ai-worker'));
    assert.ok(releaseMicroservices.includes('support-chat-service'));
    assert.equal(new Set(releaseMicroservices).size, releaseMicroservices.length);
});
