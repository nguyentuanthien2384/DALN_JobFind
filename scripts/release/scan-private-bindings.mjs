import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inventory } from './verify.mjs';

// Local preparation check only. Do not copy environment contents or secret hashes
// into the report; matching values are never printed, including on failure.
export async function scanPrivateBindings(root, kit) {
    const require = createRequire(path.join(root, 'backend/package.json'));
    const dotenv = require('dotenv');
    const values = new Set();
    const names = new Set();
    for (const name of ['backend/.env', 'microservices/.env']) {
        let source;
        try { source = await readFile(path.join(root, name), 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const [key, value] of Object.entries(dotenv.parse(source))) {
            // Example sender addresses are fixtures, not private credentials.
            if (key === 'EMAIL_APP' && /^(?:youremail@gmail\.com|sender@gmail\.com|[^@]+@example\.(?:com|invalid))$/i.test(value)) continue;
            if (/(?:SECRET|PASSWORD|API_KEY|CLIENT_ID|EMAIL_APP)$/.test(key) && value.length >= 12) {
                values.add(value); names.add(key);
            }
        }
    }
    const needles = [...values].map(v => Buffer.from(v));
    const carryLength = Math.max(1, ...needles.map(v => v.length)) - 1;
    for (const name of await inventory(kit)) {
        let carry = Buffer.alloc(0);
        for await (const part of createReadStream(path.join(kit, name))) {
            const chunk = Buffer.concat([carry, part]);
            if (needles.some(needle => chunk.includes(needle))) throw new Error('Private binding detected in release artifact: ' + name);
            carry = chunk.subarray(Math.max(0, chunk.length - carryLength));
        }
    }
    return { checkedBindingNames: [...names].sort(), longPrivateValuesFound: false, limitation: 'Scans raw artifact bytes against local private bindings of at least 12 characters; does not certify unknown secrets or compressed layer contents.' };
}
