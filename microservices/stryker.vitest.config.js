// Vitest config used only by Stryker (stryker.config.json). Stryker runs the tests from a copy of
// microservices/ in .stryker-tmp/, where relative imports such as '../../frontend/...' no longer
// reach the repository, so they are aliased back to the real frontend folder.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './vitest.config.js';

const findRepoRoot = (start) => {
    for (let dir = start; dir !== dirname(dir); dir = dirname(dir)) {
        if (existsSync(join(dir, 'frontend', 'src', 'service', 'apiError.js'))) return dir;
    }
    throw new Error('Cannot locate the JobFind repository root from ' + start);
};
const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

export default {
    ...base,
    resolve: {
        alias: [{ find: /^(\.\.\/)+frontend\//, replacement: resolve(repoRoot, 'frontend') + '/' }]
    },
    test: {
        ...base.test,
        coverage: { enabled: false },
        include: [
            'tests/access-control.test.js',
            'tests/security-config.test.js',
            'tests/gateway.test.js',
            'tests/http-contracts.test.js',
            'tests/posting-quota.test.js',
            'tests/job-request.test.js',
            'tests/job-repost.test.js',
            'tests/offer.test.js',
            'tests/interview.test.js'
        ]
    }
};
