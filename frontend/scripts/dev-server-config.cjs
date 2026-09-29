const express = require('express');

// Keep CRA's compiler and middleware behavior while using the supported v5
// dev-server API. This adapter changes no files under node_modules.
function adaptDevServerConfig(legacy, { gate } = {}) {
    const { https, onBeforeSetupMiddleware, onAfterSetupMiddleware, ...config } = legacy;
    return {
        ...config,
        server: https ? { type: 'https', options: https === true ? {} : https } : 'http',
        setupMiddlewares(middlewares, devServer) {
            // CRA's source-map overlay and optional setupProxy.js run before
            // static assets/history fallback, exactly as with the old hooks.
            onBeforeSetupMiddleware?.(devServer);
            if (onAfterSetupMiddleware) {
                const after = express.Router();
                onAfterSetupMiddleware({ ...devServer, app: after });
                middlewares.push({ name: 'cra-after-middleware', middleware: after });
            }
            if (gate) {
                // After the host checks, before CRA's CORS headers and before
                // webpack-dev-middleware holds requests until the bundle compiles.
                const index = middlewares.findIndex(({ name }) => name === 'set-headers' || name === 'webpack-dev-middleware');
                middlewares.splice(Math.max(index, 0), 0, { name: 'jobfind-launcher-gate', middleware: gate.middleware });
            }
            return middlewares;
        }
    };
}

module.exports = { adaptDevServerConfig };
