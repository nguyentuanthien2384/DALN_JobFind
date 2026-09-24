// Compose can return a map or KEY=value entries with --no-interpolate.
// Convert before assigning overrides, otherwise JSON drops array properties.
export const releaseMicroservices = ['api-gateway', 'identity-service', 'job-core-service', 'search-service',
    'application-service', 'notification-service', 'admin-service', 'ai-worker', 'support-chat-service'];

export function composeEnvironment(value = {}) {
    if (!Array.isArray(value)) return { ...value };
    return Object.fromEntries(value.map(entry => {
        const at = entry.indexOf('=');
        return at < 0 ? [entry, null] : [entry.slice(0, at), entry.slice(at + 1)];
    }));
}

export function bindClaudeWorkerEnvironment(environment, required) {
    return { ...environment,
        ANTHROPIC_BASE_URL: required('ANTHROPIC_BASE_URL'),
        ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
        CLAUDE_MODEL: required('CLAUDE_MODEL'),
        AI_CONCURRENCY: '2',
    };
}

export function bindClaudeChatEnvironment(environment, required) {
    return { ...environment,
        ANTHROPIC_BASE_URL: required('ANTHROPIC_BASE_URL'),
        ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
        SUPPORT_CLAUDE_MODEL: required('SUPPORT_CLAUDE_MODEL'),
        // Table changes belong to an explicit migration, not application boot.
        SUPPORT_AUTO_MIGRATE: 'false',
    };
}
