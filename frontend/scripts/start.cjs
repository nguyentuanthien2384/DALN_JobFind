process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';
require('react-scripts/config/env');

const { adaptDevServerConfig } = require('./dev-server-config.cjs');
const { createLauncherGate } = require('./launcher-gate.cjs');
// Started by the unified launcher (IPC channel): show its progress until the
// APIs are ready, and never outlive it while holding the web port.
const gate = process.send ? createLauncherGate() : undefined;
if (gate) {
    process.on('message', message => gate.update(message));
    process.on('disconnect', () => process.exit(0));
}
const configPath = require.resolve('react-scripts/config/webpackDevServer.config');
const createLegacyConfig = require(configPath);
require.cache[configPath].exports = (...args) => adaptDevServerConfig(createLegacyConfig(...args), { gate });

// CRA calls the former close() alias during SIGTERM/stdin shutdown.
const DevServer = require('webpack-dev-server');
if (!DevServer.prototype.close) {
    DevServer.prototype.close = function close(callback) { this.stopCallback(callback); };
}
require('react-scripts/scripts/start');
