import express from 'express';
import { contractRoute } from '../../shared/requestContract.js';
import { jsonBodies, safeHttpError } from '../../shared/httpBoundary.js';
import { createServiceRuntime } from '../../shared/serviceRuntime.js';
import { closeConnection } from '../../shared/rabbitmq.js';
import mongoose from 'mongoose';
import { createLogger } from '../../shared/logger.js';
import {
    PERMISSIONS, requireServicePermission, requireTrustedGateway
} from '../../shared/accessControl.js';
import {
    getMyProfile, updateMyProfile,
    listCvs, createCv, updateCv, deleteCv, importParsedCv
} from './controllers/profileController.js';

const logger = createLogger('identity-service');
const app = express();
const PORT = Number(process.env.PORT || 4001);
const runtime = createServiceRuntime(app, { service: 'identity-service', logger,
    checks: { mongo: () => mongoose.connection.readyState === 1 && mongoose.connection.db.command({ ping: 1 }) } });
runtime.onClose(() => mongoose.disconnect());
runtime.onClose(() => closeConnection());

app.use(jsonBodies(express));


app.use(requireTrustedGateway);

// --- Ho so ---
const canUseOwnProfile = requireServicePermission(PERMISSIONS.PROFILE_SELF);
contractRoute(app, 'profileGet', canUseOwnProfile, getMyProfile);
contractRoute(app, 'profileUpdate', canUseOwnProfile, updateMyProfile);

// --- CV Builder ---
const canManageOwnCv = requireServicePermission(PERMISSIONS.CV_SELF_MANAGE);
contractRoute(app, 'cvList', canManageOwnCv, listCvs);
contractRoute(app, 'cvCreate', canManageOwnCv, createCv);
contractRoute(app, 'cvUpdate', canManageOwnCv, updateCv);
contractRoute(app, 'cvDelete', canManageOwnCv, deleteCv);
contractRoute(app, 'cvImport', canManageOwnCv, importParsedCv);

// eslint-disable-next-line no-unused-vars
app.use(safeHttpError);

const connectMongo = async (attempt = 1) => {
    try {
        await mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:27017/identity_db', {
            serverSelectionTimeoutMS: 5000
        });
        logger.info('da ket noi MongoDB');
    } catch (error) {
        if (attempt > 10) throw error;
        logger.warn(`chua ket noi duoc MongoDB (${error.message}), thu lai lan ${attempt}`);
        await new Promise((r) => setTimeout(r, 3000));
        return connectMongo(attempt + 1);
    }
};

const start = async () => {
    await connectMongo();
    runtime.attach(app.listen(PORT, () => logger.info(`Identity Service dang chay tren cong ${PORT}`)));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
