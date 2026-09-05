import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const directory = new URL('../.secrets/', import.meta.url);
const file = new URL('metrics-token', directory);
await mkdir(directory, { recursive: true });
try {
    await writeFile(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Created local metrics credential (not printed). Restrict this directory to your Windows account.');
} catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length < 32) throw new Error('Existing metrics credential is too short; not overwritten.');
    console.log('Kept the existing metrics credential unchanged.');
}
