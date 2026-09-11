import express from "express";
import http from "http";
import bodyParser from "body-parser";
import viewEngine from "./config/viewEngine";
import initwebRoutes from "./routes/web";
import connectDB from "./config/connectDB";
import {sendJobMail,updateFreeViewCv} from "./utils/schedule"
import { initSocket } from "./config/socket";
import db from './models/index';
import schedule from 'node-schedule';
import { assertSecureJwtSecret, getJwtPolicy } from './utils/securityConfig';
require('dotenv').config();

// Fail at startup instead of silently accepting a public/default signing key.
assertSecureJwtSecret(process.env.JWT_SECRET);
getJwtPolicy();

let app = express();

app.use(function (req, res, next) {
    // URL_REACT co the chua nhieu origin, cach nhau boi dau phay. Dieu nay cho
    // phep frontend chay o cong 3001 khi cong 3000 dang duoc API Gateway su dung.
    const allowedOrigins = (process.env.URL_REACT || 'http://localhost:3000,http://localhost:3001')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const requestOrigin = req.headers.origin;

    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
    }

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization,Idempotency-Key');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Tra loi preflight ngay tai day de cac request POST/PUT co JSON khong bi
    // chan boi trinh duyet.
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))
viewEngine(app);
initwebRoutes(app);

const port = process.env.PORT || 5000;
let server;
let socketServer;
let shutdownPromise;

export const shutdown = () => {
    if (!shutdownPromise) {
        shutdownPromise = (async () => {
            await schedule.gracefulShutdown();
            if (socketServer) {
                // Socket.IO also closes its attached HTTP server.
                await new Promise((resolve) => socketServer.close(resolve));
            } else if (server && server.listening) {
                await new Promise((resolve) => server.close(resolve));
            }
            await db.sequelize.close();
        })();
    }
    return shutdownPromise;
};

const handleShutdown = () => {
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    shutdown().then(() => {
        clearTimeout(timeout);
        process.exit(0);
    }).catch((error) => {
        console.error('Backend shutdown failed:', error.message);
        process.exit(1);
    });
};

const startServer = async () => {
    // Never advertise a usable API before the configured database is reachable.
    await connectDB();
    server = http.createServer(app);
    socketServer = initSocket(server);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
            server.removeListener('error', reject);
            resolve();
        });
    });

    // Local startup can disable outbound recommendation mail and daily quota resets.
    // Preserve the existing production behavior when this option is unset.
    if (String(process.env.SCHEDULED_JOBS_ENABLED).toLowerCase() !== 'false') {
        sendJobMail();
        updateFreeViewCv();
    }

    process.once('SIGINT', handleShutdown);
    process.once('SIGTERM', handleShutdown);
    console.log('Backend Nodejs is running on the port : ' + port);
    return server;
};

export const startup = startServer().catch(async (error) => {
    console.error('Backend startup failed:', error.message);
    process.exitCode = 1;
    await shutdown().catch((shutdownError) => {
        console.error('Backend cleanup failed:', shutdownError.message);
    });
});
