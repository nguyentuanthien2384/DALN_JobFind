import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url) });
import { articles, normalize } from './knowledge.js';
const base = process.env.ELASTICSEARCH_URL;
if (!base) throw new Error('ELASTICSEARCH_URL is required');
const body = articles.flatMap(article => [JSON.stringify({ index: { _index: 'support_kb_v1', _id: article.id } }), JSON.stringify({ title: normalize(article.title), keywords: article.keywords, text: normalize(article.text), version: article.version })]).join('\n') + '\n';
const response = await fetch(`${base.replace(/\/$/, '')}/_bulk?refresh=wait_for`, { method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body, signal: AbortSignal.timeout(15000) });
if (!response.ok || (await response.json()).errors) throw new Error('Knowledge indexing failed');
console.log(`Indexed ${articles.length} reviewed public articles`);
