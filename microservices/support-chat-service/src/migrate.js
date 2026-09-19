import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url) });
import { createStore } from './store.js';
const { pool } = await import('../../job-core-service/src/libs/db.js');
try { await createStore(pool).migrate(); console.log('Support schema ready'); } finally { await pool.end(); }
