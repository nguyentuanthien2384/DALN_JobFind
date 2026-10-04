// Jest config used only by Stryker (stryker.config.json). It reuses the normal config but runs
// just the suites that exercise the mutated security/payment modules: Stryker copies backend/
// into a sandbox, so suites that read ../microservices or start browsers cannot run there.
const { jest: base } = require('./package.json');

module.exports = {
  ...base,
  rootDir: __dirname,
  coverageThreshold: undefined,
  testMatch: [
    // Listed one by one: Stryker's sandbox lives under the dot-folder .stryker-tmp, where
    // wildcard globs silently match nothing (the first run lost every middleware suite).
    '<rootDir>/tests/middlewares/authorize.test.js',
    '<rootDir>/tests/middlewares/authResponseHeaders.test.js',
    '<rootDir>/tests/middlewares/jwtSession.test.js',
    '<rootDir>/tests/middlewares/jwtVerify.test.js',
    '<rootDir>/tests/middlewares/rateLimit.test.js',
    '<rootDir>/tests/routes/web.test.js',
    '<rootDir>/tests/utils/accountValidation.test.js',
    '<rootDir>/tests/utils/authorization.test.js',
    '<rootDir>/tests/utils/otpStore.test.js',
    '<rootDir>/tests/utils/postingQuota.test.js',
    '<rootDir>/tests/utils/jobModeration.test.js',
    '<rootDir>/tests/utils/legacyJobRequest.test.js',
    '<rootDir>/tests/services/paymentIntegrityService.test.js',
    '<rootDir>/tests/services/packageServices.test.js',
    '<rootDir>/tests/services/userService.test.js',
    '<rootDir>/tests/controllers/cvController.test.js',
    '<rootDir>/tests/controllers/postController.test.js',
    '<rootDir>/tests/controllers/userController.test.js'
  ]
};
