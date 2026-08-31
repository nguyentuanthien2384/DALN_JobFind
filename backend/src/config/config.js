'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const base = require('./config.json');

const withEnvironmentOverrides = (config) => ({
    ...config,
    database: process.env.DB_NAME || config.database,
    username: process.env.DB_USER || config.username,
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : config.password,
    host: process.env.DB_HOST || config.host,
    port: Number(process.env.DB_PORT || config.port || 3306)
});

module.exports = {
    development: withEnvironmentOverrides(base.development),
    test: withEnvironmentOverrides(base.test),
    production: withEnvironmentOverrides(base.production)
};
