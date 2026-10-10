// npm audit skips the prerelease version of a vendored patch, so check the upstream
// release it was built from: fail on any other high/critical advisory, and say when
// upstream ships its own fix so the vendored copy can be dropped (vendor/README.md).
const registry = 'https://registry.npmjs.org';
const vendored = [{ name: 'braces', base: '3.0.3', patched: ['GHSA-vfj7-8cjw-p6xm'] }];

const advisories = async (name, version) => {
    const response = await fetch(`${registry}/-/npm/v1/security/advisories/bulk`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [name]: [version] }),
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Advisory lookup for ${name}@${version} failed: HTTP ${response.status}`);
    return (await response.json())[name] || [];
};
const advisoryId = advisory => advisory.url.split('/').pop();

let failed = false;
for (const { name, base, patched } of vendored) {
    const open = (await advisories(name, base)).filter(advisory => !patched.includes(advisoryId(advisory)));
    for (const advisory of open) {
        const blocking = ['high', 'critical'].includes(advisory.severity);
        failed ||= blocking;
        console.log(`${blocking ? 'LỖI' : 'Cảnh báo'}: ${name}@${base} (bản gốc của vendor/${name}) còn ${advisory.severity} ${advisoryId(advisory)} chưa được vá: ${advisory.title}`);
    }
    const response = await fetch(`${registry}/${name}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Registry lookup for ${name} failed: HTTP ${response.status}`);
    const latest = (await response.json())['dist-tags'].latest;
    const stillOpen = latest === base ? patched : (await advisories(name, latest)).map(advisoryId).filter(id => patched.includes(id));
    if (stillOpen.length < patched.length) {
        console.log(`Lưu ý: ${name}@${latest} đã sửa ${patched.filter(id => !stillOpen.includes(id)).join(', ')}; hãy bỏ bản vá vendor/${name} và dùng bản chính thức (xem vendor/README.md).`);
    } else if (!open.length) {
        console.log(`${name}: bản vá vendor vẫn cần thiết (bản mới nhất ${latest} chưa sửa ${patched.join(', ')}); không có advisory nào khác cho ${base}.`);
    }
}
if (failed) process.exitCode = 1;
