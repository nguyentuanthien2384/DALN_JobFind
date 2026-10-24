// Builds the two Postman collections (automated API tests, hand-made actions) and their environments.
// Usage (from the repository root): node postman/generator/build.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { event, collectionPre, collectionTest } from './lib.mjs';
import { startup, gateway } from './folders/gateway.mjs';
import { register, auth, users } from './folders/accounts.mjs';
import { identity, jobCore, search, applications, admin, support, ai, cqrsWrite } from './folders/microservices.mjs';
import { catalog, companies, posts, cvs, packages, social, notifications } from './folders/legacy.mjs';
import { recruitment } from './folders/recruitment.mjs';
import { optionalWrites } from './folders/optional.mjs';
import { manualFolders } from './folders/manual.mjs';

const OUT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');

// Business order: accounts first, then catalog/jobs/applications, then reporting and opt-in writes.
const ordered = [
    startup, gateway, register, auth, users, identity, catalog, companies, posts, jobCore, search,
    cvs, applications, recruitment, packages, social, notifications, admin, support, ai, cqrsWrite, optionalWrites
];
const item = ordered.map((top, index) => {
    const number = String(index).padStart(2, '0');
    return {
        ...top,
        name: `${number} - ${top.name}`,
        item: top.item.map((child) => (child.item ? { ...child, name: child.name.replace(/^([a-z]) - /, `${number}$1 - `) } : child))
    };
});

const collection = {
    info: {
        _postman_id: '6b1f0c52-3c8e-4a0e-9a57-5d2f7e1c9a01',
        name: 'JobFind - API Tests',
        description: [
            'Bộ kiểm thử API toàn dự án JobFind (backend cũ + microservices), gọi qua API Gateway (:4000).',
            'Chọn environment "JobFind API Tests - Local" (máy của bạn) hoặc "... - Production" (https://thiennt.id.vn), rồi Run collection.',
            'Các phần gửi email thật, gọi AI hoặc để lại dữ liệu mặc định bị bỏ qua (allowEmails, allowAiCalls,',
            'allowSideEffects). Xem postman/README.md. Collection được sinh bởi postman/generator/build.mjs.'
        ].join('\n'),
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    event: [event('prerequest', collectionPre), event('test', collectionTest)],
    item
};

// Same environments and token handling; nothing here runs unless you send it on purpose.
const manualCollection = {
    info: {
        _postman_id: '0b9d3c74-5e1a-4f6b-8a2d-93c7e5f1a6d8',
        name: 'JobFind - Thao tác thủ công (kiểm tra trước rồi mới làm thật)',
        description: [
            'Tự đăng ký tài khoản, mời phỏng vấn, gửi thư trúng tuyển/từ chối, chuyển giai đoạn hồ sơ bằng dữ liệu của bạn.',
            'Mỗi việc có 2 bước: "Bước 1 - Kiểm tra trước" gọi API thật với ?dryRun=true (server kiểm tra như làm thật, trả bản xem',
            'trước email ở tab Visualize, KHÔNG lưu và KHÔNG gửi gì); "Bước 2 - Gửi thật" chỉ gửi đúng dữ liệu vừa kiểm tra đạt',
            '(trong 15 phút, mỗi lần kiểm tra chỉ gửi được một lần). Dùng chung environment với bộ test API.',
            'Không bấm Run cả collection: hãy Send từng bước. Xem postman/README.md.'
        ].join('\n'),
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    event: [event('prerequest', collectionPre), event('test', collectionTest)],
    item: manualFolders
};

const v = (key, value, type = 'default') => ({ key, value, type, enabled: true });
// Same accounts and fixtures on both targets: the VPS data was exported from local.
const environment = ({ id, name, baseUrl, origin, opsEndpoints, maxResponseMs, refreshCookieName }) => ({
    id,
    name,
    values: [
        v('baseUrl', baseUrl),
        v('origin', origin),
        // true: requests reach the gateway directly (/status, /metrics, /readyz exist).
        // false: through Caddy on the VPS, where only /api and /socket.io are proxied.
        v('opsEndpoints', String(opsEndpoints)),
        v('adminPhone', '0795095049'), v('adminPassword', '123456', 'secret'),
        v('employerPhone', '0795095042'), v('employerPassword', '123456', 'secret'),
        v('employer2Phone', '0918800001'), v('employer2Password', 'Demo@123456', 'secret'),
        v('candidatePhone', '0764188123'), v('candidatePassword', '123456', 'secret'),
        v('testCandidatePhone', '0987650001'), v('testCandidatePassword', 'KiemThu@2026', 'secret'),
        v('testInboxEmail', ''),
        v('hrContactEmail', 'postman-hr@thiennt.id.vn'),
        v('pmPhone', '0999990001'), v('pmEmail', 'postman-test@thiennt.id.vn'),
        v('pmPassword', 'Postman@2026', 'secret'), v('pmPasswordAlt', 'Postman@2026-doi', 'secret'),
        v('pmFirstName', 'Kiểm Thử'), v('pmLastName', 'Postman'),
        v('jobId', '22'),
        v('testOfferJobId', '232'), v('testRejectJobId', '233'), v('testNewApplyJobId', '234'),
        v('employerCvId', '9100'), v('viewedCandidateId', '9067'),
        v('maxResponseMs', String(maxResponseMs)),
        v('allowEmails', 'false'),
        v('allowAiCalls', 'false'),
        v('allowSideEffects', 'false'),
        // Hand-made actions: recruiter account that sends, selected application, search text.
        v('recruiterPhone', '0918800001'), v('recruiterPassword', 'Demo@123456', 'secret'),
        v('manualApplicationId', ''), v('manualSearch', ''),
        // Filled by the login requests and renewed automatically; never type them by hand.
        v('refreshCookieName', refreshCookieName),
        ...['admin', 'employer', 'employer2', 'candidate', 'testCandidate', 'pm', 'recruiter']
            .flatMap((account) => [v(account + 'AccessToken', '', 'secret'), v(account + 'RefreshToken', '', 'secret')])
    ],
    _postman_variable_scope: 'environment'
});
const environments = {
    'JobFind-API-Tests-Local.postman_environment.json': environment({
        id: '2f0d7a3e-8c41-4b6a-9d55-0a6c3e9b7f12', name: 'JobFind API Tests - Local',
        baseUrl: 'http://localhost:4000', origin: 'http://localhost:3000', opsEndpoints: true, maxResponseMs: 5000, refreshCookieName: 'jobfind_rt'
    }),
    'JobFind-API-Tests-Production.postman_environment.json': environment({
        id: '8c3b5e1d-4f27-4a90-b6d2-71e0f9a4c5b3', name: 'JobFind API Tests - Production (thiennt.id.vn)',
        baseUrl: 'https://thiennt.id.vn', origin: 'https://thiennt.id.vn', opsEndpoints: false, maxResponseMs: 8000, refreshCookieName: '__Host-jobfind_rt'
    })
};

// Compile every script the way the Postman sandbox wraps it (legacy globals are parameters).
const LEGACY = ['data', 'CryptoJS', 'request', 'environment', 'globals', 'iteration', 'responseBody', 'responseCode',
    'responseCookies', 'responseHeaders', 'responseTime', 'tests', 'postman', '_', 'atob', 'btoa', 'tv4', 'xml2Json', 'cheerio'];
const names = new Set();
const checkNode = (node, trail) => {
    for (const ev of node.event || []) {
        const source = ev.script.exec.join('\n');
        const leftover = source.match(/__[A-Z]+__/);
        if (leftover) throw new Error(`${trail} [${ev.listen}]: unreplaced ${leftover[0]}`);
        try { new Function(...LEGACY, source); } catch (error) { throw new Error(`${trail} [${ev.listen}]: ${error.message}`); }
    }
    if (node.request) {
        if (names.has(trail)) throw new Error(`Duplicate request name: ${trail}`);
        names.add(trail);
    }
    for (const child of node.item || []) checkNode(child, `${trail} / ${child.name}`);
};
checkNode(collection, 'collection');
names.clear();
checkNode(manualCollection, 'manual');

writeFileSync(join(OUT, 'JobFind-API-Tests.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
writeFileSync(join(OUT, 'JobFind-Thao-Tac-Thu-Cong.postman_collection.json'), JSON.stringify(manualCollection, null, 2) + '\n');
for (const [file, env] of Object.entries(environments)) writeFileSync(join(OUT, file), JSON.stringify(env, null, 2) + '\n');
const count = (items) => items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
console.log(`requests: ${count(collection.item)}`);
for (const top of collection.item) console.log(`  ${String(count(top.item)).padStart(3)}  ${top.name}`);
console.log(`manual requests: ${count(manualCollection.item)}`);
