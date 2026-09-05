import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { eventCatalog, eventExamples } from '../shared/contracts/eventCatalog.js';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/event-contracts.mjs [--check]');
const artifacts = new Map();
const bundle = { payloadVersion: 1, events: eventCatalog };
for (const [key, value] of Object.entries(eventCatalog)) artifacts.set(`../contracts/events/${key}.payload.v1.schema.json`, { ...value.schema, title: `${key} payload v1`, examples: [eventExamples[key]] });
artifacts.set('../contracts/events/catalog.v1.json', bundle);
artifacts.set('../../backend/src/contracts/events.v1.json', bundle);
for (const [path, data] of artifacts) artifacts.set(path, `${JSON.stringify(data, null, 2)}\n`);
artifacts.set('../../backend/src/contracts/eventValidator.cjs', await readFile(new URL('../shared/contracts/eventValidator.cjs', import.meta.url), 'utf8'));
for (const [path, expected] of artifacts) {
    const file = new URL(path, import.meta.url);
    if (check) {
        const actual = await readFile(file, 'utf8').catch(() => '');
        if (actual.replaceAll('\r\n', '\n') !== expected.replaceAll('\r\n', '\n')) throw new Error(`Stale event contract ${path}; run npm run contracts:generate`);
    } else {
        await mkdir(new URL('.', file), { recursive: true });
        await writeFile(file, expected);
    }
}
console.log(`Event contracts ${check ? 'verified' : 'generated'}: ${Object.keys(eventCatalog).length} payloads and standalone backend validator`);
