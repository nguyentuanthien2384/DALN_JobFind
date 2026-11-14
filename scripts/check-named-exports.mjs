// Fails when frontend/src imports a named binding that the local target module does not export.
// CRA builds only warn about this; at runtime the import is silently undefined.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'frontend', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [file] : [];
});

const problems = [];
for (const file of walk(srcDir)) {
    const code = fs.readFileSync(file, 'utf8');
    const importRe = /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = importRe.exec(code))) {
        const base = path.resolve(path.dirname(file), match[2]);
        const target = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')]
            .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) continue;
        const targetCode = fs.readFileSync(target, 'utf8');
        if (/module\.exports|export\s+\*/.test(targetCode)) continue;
        const names = match[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const name of names) {
            const declared = new RegExp(`export\\s+(const|let|var|function|class|async\\s+function)\\s+${name}\\b`).test(targetCode);
            const listed = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(targetCode);
            if (!declared && !listed) {
                problems.push(`Missing named export "${name}" in ${path.relative(root, target)} (imported by ${path.relative(root, file)})`);
            }
        }
    }
}

if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
}
console.log('Named exports verified in frontend/src');
