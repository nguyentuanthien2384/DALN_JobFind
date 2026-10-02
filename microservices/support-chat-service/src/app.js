import dotenv from 'dotenv';
import express from 'express';
import { createStore } from './store.js';
import { createTools } from './tools.js';
import { createResponder } from './providers.js';
import { createAnswerCache } from './answerCache.js';
import { registerSupportRoutes } from './http.js';
import { createServiceRuntime, periodicTask } from '../../shared/serviceRuntime.js';
import { createLogger } from '../../shared/logger.js';

dotenv.config({ path: new URL('../../.env', import.meta.url) });
const { pool } = await import('../../job-core-service/src/libs/db.js');

const app = express(), logger = createLogger('support-chat-service');
const store = createStore(pool, process.env.SUPPORT_RETENTION_DAYS);
const runtime = createServiceRuntime(app, { service: 'support-chat-service', logger, checks: { mysql: () => pool.query('SELECT id FROM support_conversations LIMIT 1') } });
if (process.env.SUPPORT_AUTO_MIGRATE === 'true') await store.migrate();
const tools = createTools({ pool });
const audit = event => logger.info('support event', event);
// SUPPORT_ANSWER_CACHE_TTL_MS=0 turns the replay of recent opening answers off.
const ttl = Number(process.env.SUPPORT_ANSWER_CACHE_TTL_MS || 600000);
const answerCache = createAnswerCache({ ttlMs: Number.isFinite(ttl) ? ttl : 600000 });
registerSupportRoutes(app, { store, tools, audit, respond: createResponder({ executePublicTool: tools.publicTool, audit, answerCache }) });
runtime.onClose(periodicTask(() => store.cleanup(), 3600000, () => logger.warn('support retention cleanup failed')));
runtime.onClose(() => pool.end());
runtime.attach(app.listen(Number(process.env.PORT || 4008), '0.0.0.0'));
