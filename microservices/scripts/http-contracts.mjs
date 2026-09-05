import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildOpenApi, serviceNames } from '../shared/contracts/openapi.js';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/http-contracts.mjs [--check]');
const directory = new URL('../contracts/http/', import.meta.url);
if (!check) await mkdir(directory, { recursive: true });
for (const service of ['gateway', ...serviceNames]) {
    const target = new URL(`${service}.openapi.json`, directory);
    const expected = `${JSON.stringify(buildOpenApi(service), null, 2)}\n`;
    if (check) {
        const actual = await readFile(target, 'utf8').catch(() => '');
        if (actual.replaceAll('\r\n', '\n') !== expected) throw new Error(`Stale contract: ${fileURLToPath(target)}. Run npm run contracts:generate.`);
    } else await writeFile(target, expected);
}
console.log(`HTTP contracts ${check ? 'verified' : 'generated'}: gateway + ${serviceNames.length} services`);
