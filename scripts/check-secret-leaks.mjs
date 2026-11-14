// Blocks committing or pushing Anthropic API keys in tracked or non-ignored files.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretPattern = new RegExp(`${['sk', 'ant', 'api03'].join('-')}-[A-Za-z0-9_-]{20,}`);

const rawFiles = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
);
const files = rawFiles.split('\0').filter(Boolean);

const leakedFiles = [];
for (const relPath of files) {
    const absPath = path.join(root, relPath);
    let stat;
    try {
        stat = fs.statSync(absPath);
    } catch {
        continue;
    }
    if (!stat.isFile()) continue;
    const text = fs.readFileSync(absPath, 'utf8');
    if (secretPattern.test(text)) {
        leakedFiles.push(relPath.replaceAll('\\', '/'));
    }
}

if (leakedFiles.length) {
    for (const file of leakedFiles) {
        console.error(`[check-secret-leaks] Found forbidden Anthropic API key in ${file}`);
    }
    process.exit(1);
}

console.log(`Secret leak check passed (${files.length} files scanned)`);
