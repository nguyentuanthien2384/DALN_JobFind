process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';
require('react-scripts/config/env');

const { adaptDevServerConfig } = require('./dev-server-config.cjs');
const configPath = require.resolve('react-scripts/config/webpackDevServer.config');
const createLegacyConfig = require(configPath);
require.cache[configPath].exports = (...args) => adaptDevServerConfig(createLegacyConfig(...args));

// CRA calls the former close() alias during SIGTERM/stdin shutdown.
const DevServer = require('webpack-dev-server');
if (!DevServer.prototype.close) {
    DevServer.prototype.close = function close(callback) { this.stopCallback(callback); };
}
require('react-scripts/scripts/start');
