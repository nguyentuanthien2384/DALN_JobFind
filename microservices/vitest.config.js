import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./tests/setup-env.js'],
        clearMocks: true,
        restoreMocks: true,
        mockReset: true,
        include: ['tests/**/*.test.js'],
        // Some tests compile every AJV event schema; with v8 coverage and all workers busy they
        // exceed vitest's 5s default on CI runners although they take ~0.3s alone.
        testTimeout: 20000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: 'coverage',
            include: [
                'shared/*.js',
                '*/src/controllers/*.js',
                '*/src/consumers/*.js',
                '*/src/jobs/*.js',
                '*/src/libs/*.js',
                '*/src/middlewares/*.js',
                '*/src/models/*.js',
                'notification-service/src/templates.js'
            ],
            exclude: ['**/node_modules/**'],
            thresholds: {
                lines: 80,
                statements: 80,
                functions: 80,
                branches: 75
            }
        }
    }
});
