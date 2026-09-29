const express = require('express');

// Keep CRA's compiler and middleware behavior while using the supported v5
// dev-server API. This adapter changes no files under node_modules.
function adaptDevServerConfig(legacy) {
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
            return middlewares;
        }
    };
}

module.exports = { adaptDevServerConfig };
