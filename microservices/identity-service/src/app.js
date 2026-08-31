import express from 'express';
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

app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.json({
        status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
        service: 'identity-service',
        mongo: states[mongoose.connection.readyState]
    });
});

app.use(requireTrustedGateway);

// --- Ho so ---
const canUseOwnProfile = requireServicePermission(PERMISSIONS.PROFILE_SELF);
app.get('/profile', canUseOwnProfile, getMyProfile);
app.put('/profile', canUseOwnProfile, updateMyProfile);

// --- CV Builder ---
const canManageOwnCv = requireServicePermission(PERMISSIONS.CV_SELF_MANAGE);
app.get('/profile/cvs', canManageOwnCv, listCvs);
app.post('/profile/cvs', canManageOwnCv, createCv);
app.put('/profile/cvs/:cvId', canManageOwnCv, updateCv);
app.delete('/profile/cvs/:cvId', canManageOwnCv, deleteCv);
app.post('/profile/cvs/import', canManageOwnCv, importParsedCv);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    logger.error('loi khong bat duoc', { error: err.message, url: req.originalUrl });
    res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
});

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
    app.listen(PORT, () => logger.info(`Identity Service dang chay tren cong ${PORT}`));
};

start().catch((error) => {
    logger.error('khong khoi dong duoc', { error: error.message });
    process.exit(1);
});
