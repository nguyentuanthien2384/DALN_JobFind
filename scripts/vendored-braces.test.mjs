import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// npm audit cannot see this patch (it skips prerelease versions), so these checks are
// what tie the installed tarballs to the reviewed source in vendor/braces.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'vendor/braces');
const { version } = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
const tarball = `braces-${version}.tgz`;
const spec = `file:vendor/${tarball}`;
const consumers = { frontend: 'devDependencies', microservices: 'dependencies' };

const readTar = buffer => {
    const files = new Map();
    const data = gunzipSync(buffer);
    for (let offset = 0; offset + 512 <= data.length;) {
        const header = data.subarray(offset, offset + 512);
        const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
        const name = field(0, 100);
        if (!name) break;
        const size = parseInt(field(124, 12).trim() || '0', 8);
        const prefix = field(345, 155);
        const type = field(156, 1) || '0';
        if (type === '0') files.set((prefix ? prefix + '/' : '') + name, data.subarray(offset + 512, offset + 512 + size));
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
};

const sourceFiles = (dir = source, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(path.join(dir, entry.name), prefix + entry.name + '/')
    : [prefix + entry.name]);

test('each consumer installs the one vendored braces tarball through an override', () => {
    for (const [consumer, field] of Object.entries(consumers)) {
        const manifest = JSON.parse(readFileSync(path.join(root, consumer, 'package.json'), 'utf8'));
        assert.equal(manifest[field].braces, spec, consumer);
        assert.equal(manifest.overrides.braces, '$braces', consumer);
        const lock = JSON.parse(readFileSync(path.join(root, consumer, 'package-lock.json'), 'utf8'));
        const entries = Object.entries(lock.packages).filter(([key]) => /(^|\/)node_modules\/braces$/.test(key));
        assert.deepEqual(entries.map(([key]) => key), ['node_modules/braces'], consumer);
        const [[, locked]] = entries;
        assert.equal(locked.version, version, consumer);
        assert.equal(locked.resolved, spec, consumer);
        const bytes = readFileSync(path.join(root, consumer, 'vendor', tarball));
        assert.equal(locked.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'), consumer);
    }
});

test('git tracks the tarballs despite the *.tgz ignore rule, so CI checkouts can install them', () => {
    for (const consumer of Object.keys(consumers)) {
        const ignored = spawnSync('git', ['check-ignore', '-q', `${consumer}/vendor/${tarball}`], { cwd: root });
        assert.equal(ignored.status, 1, `${consumer}/vendor/${tarball} is ignored by .gitignore`);
    }
});

test('the vendored tarballs contain exactly the reviewed vendor/braces source', () => {
    const tarballs = Object.keys(consumers).map(consumer => readFileSync(path.join(root, consumer, 'vendor', tarball)));
    assert.ok(tarballs.every(bytes => bytes.equals(tarballs[0])), 'consumer tarballs differ');
    const packed = readTar(tarballs[0]);
    assert.deepEqual([...packed.keys()].map(name => name.replace(/^package\//, '')).sort(), sourceFiles().sort());
    for (const file of sourceFiles()) {
        assert.ok(packed.get('package/' + file).equals(readFileSync(path.join(source, file))), file);
    }
});

test('the patch bounds nesting in the parser before the recursive walkers run', () => {
    const parse = readFileSync(path.join(source, 'lib/parse.js'), 'utf8');
    assert.match(readFileSync(path.join(source, 'lib/constants.js'), 'utf8'), /MAX_DEPTH: 100,/);
    assert.equal(parse.match(/^\s*enterGroup\(\);$/gm)?.length, 2);
    assert.match(parse, /Number\.isFinite\(opts\.maxDepth\) \? Math\.min\(MAX_DEPTH, opts\.maxDepth\) : MAX_DEPTH/);
});
