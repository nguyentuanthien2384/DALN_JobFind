import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { alive, stopChild, ownedSupervisor, matchesSupervisor, effectiveState, waitFor, runLoggedCommand, withStartLock, releaseOwnedLock, reconcileAiWorker, localComposeEnvironment, localEmailDeliveryEnabled, claudeRuntimeMatches, canConnect, awaitService, followLaunch, awaitSupervisorPublication } from './dev-runtime.mjs';

test('concurrent starters cannot reclaim or replace each others runtime lock', async () => {
    const workspace = path.join(os.tmpdir(), `jobfind-starter-${process.pid}-${Date.now()}`);
    let owners = 0;
    let maximumOwners = 0;
    await Promise.all(Array.from({ length: 4 }, () => withStartLock(workspace, async () => {
        maximumOwners = Math.max(maximumOwners, ++owners);
        await new Promise(resolve => setTimeout(resolve, 30));
        owners--;
    })));
    assert.equal(maximumOwners, 1);
    await assert.rejects(withStartLock(workspace, async () => { throw new Error('preflight failed'); }), /preflight failed/);
    assert.equal(await withStartLock(workspace, async () => 'recovered'), 'recovered');
});

test('concurrent starters follow one supervisor even when state publication is delayed', { timeout: 15000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfind-publication-'));
    const file = path.join(directory, 'runtime.json');
    const children = [];
    const readState = async () => {
        try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
    };
    const start = () => withStartLock(directory, async () => {
        const existing = await readState();
        if (existing && alive(existing.pid)) return existing.pid;
        const instance = 'delayed-child-' + children.length;
        const code = `const fs = require('node:fs');
            setTimeout(() => fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, instance: process.argv[2], status: 'starting' })), 300);
            setInterval(() => {}, 1000);`;
        const child = spawn(process.execPath, ['-e', code, file, instance], { stdio: 'ignore', windowsHide: true });
        children.push(child);
        await awaitSupervisorPublication({ pid: child.pid, instance, readState, timeout: 10000, interval: 10 });
        return child.pid;
    });
    try {
        const pids = await Promise.all([start(), start(), start()]);
        assert.equal(children.length, 1, 'the publication gap must not create a second supervisor');
        assert.deepEqual(pids, Array(3).fill(children[0].pid));
    } finally {
        await Promise.all(children.map(async child => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const closed = once(child, 'close');
            child.kill();
            await closed;
        }));
        assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('jobfind-publication-'));
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('supervisor publication rejects stale instances and reports a child that exits before publishing', async () => {
    await assert.rejects(awaitSupervisorPublication({ pid: 7, instance: 'new', isAlive: () => false,
        readState: async () => ({ pid: 7, instance: 'old', status: 'running' }) }), /đã dừng trước khi ghi tiến độ/);
    await assert.rejects(awaitSupervisorPublication({ pid: 7, instance: 'new', isAlive: () => true, timeout: 20, interval: 5,
        readState: async () => ({ pid: 7, instance: 'old', status: 'running' }) }), /Chưa nhận được tiến độ/);
    const failed = { pid: 7, instance: 'new', status: 'failed', error: 'prerequisite failed' };
    assert.equal(await awaitSupervisorPublication({ pid: 7, instance: 'new', isAlive: () => false, readState: async () => failed }), failed);
});

test('shutdown preserves a runtime lock belonging to a different supervisor', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfind-lock-'));
    const file = path.join(directory, 'runtime.lock');
    try {
        await fs.writeFile(file, '1234');
        await releaseOwnedLock(file, 5678);
        assert.equal(await fs.readFile(file, 'utf8'), '1234');
        await releaseOwnedLock(file, 1234);
        await assert.rejects(fs.access(file), { code: 'ENOENT' });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('PID validation never probes process groups or an unrelated Node process', async () => {
    for (const pid of [undefined, 0, -1, NaN, '123']) assert.equal(alive(pid), false);
    assert.equal(await ownedSupervisor(process.pid, path.resolve('missing-launcher.mjs')), false);
});

test('Windows supervisor identity requires an exact script and serve argument', () => {
    const script = 'D:\\Job Find\\scripts\\dev.mjs';
    assert.equal(matchesSupervisor(`"C:\\Program Files\\node.exe" "${script}" serve`, script), true);
    assert.equal(matchesSupervisor(`node "${script}" start`, script), false);
    assert.equal(matchesSupervisor(`node "${script}.other" serve`, script), false);
});

test('Windows ownership check recovers from one transient inspection timeout', async () => {
    const script = 'D:\\Job Find\\scripts\\dev.mjs';
    let attempts = 0;
    const execute = async () => {
        if (++attempts === 1) throw Object.assign(new Error('slow CIM'), { killed: true, signal: 'SIGTERM' });
        return { stdout: JSON.stringify({ ExecutablePath: process.execPath, CommandLine: `node "${script}" serve` }) };
    };
    assert.equal(await ownedSupervisor(process.pid, script, { platform: 'win32', execute }), true);
    assert.equal(attempts, 2);
});

test('unverifiable Windows owner is never treated as dead or safe to replace', async () => {
    for (const [failure, expectedAttempts] of [
        [Object.assign(new Error('CIM timed out'), { killed: true, signal: 'SIGTERM' }), 2],
        [Object.assign(new Error('access denied'), { code: 'EACCES' }), 1]
    ]) {
        let attempts = 0;
        await assert.rejects(ownedSupervisor(process.pid, 'launcher.mjs', {
            platform: 'win32', execute: async () => { attempts++; throw failure; }
        }), /Không xác minh được phiên khởi chạy hiện có/);
        assert.equal(attempts, expectedAttempts);
    }
    for (const stdout of ['invalid process information', '{}', JSON.stringify({ ExecutablePath: null, CommandLine: null })]) {
        await assert.rejects(ownedSupervisor(process.pid, 'launcher.mjs', {
            platform: 'win32', execute: async () => ({ stdout })
        }), /Không xác minh được phiên khởi chạy hiện có/);
    }
});

test('dead launcher cannot continue to report running', () => {
    assert.equal(effectiveState({ status: 'running' }, false).status, 'stopped');
    assert.equal(effectiveState({ status: 'failed' }, false).status, 'failed');
    assert.equal(effectiveState({ status: 'starting' }, true).status, 'starting');
});

test('cleanup does not signal an exited or already killed process', () => {
    let calls = 0;
    const child = { pid: 12, exitCode: 0, signalCode: null, killed: false, kill() { calls++; } };
    stopChild(child);
    child.exitCode = null; child.signalCode = 'SIGTERM'; stopChild(child);
    child.signalCode = null; child.killed = true; stopChild(child);
    assert.equal(calls, 0);
    child.killed = false; stopChild(child);
    assert.equal(calls, 1);
});

test('AI worker is stopped when its key is removed from a previous run', async () => {
    const calls = [];
    const findContainer = async service => { calls.push(['find', service]); return 'existing-container'; };
    const stopContainer = async service => { calls.push(['stop', service]); };
    assert.equal(await reconcileAiWorker('  ', findContainer, stopContainer), false);
    assert.deepEqual(calls, [['find', 'ai-worker'], ['stop', 'ai-worker']]);
    calls.length = 0;
    assert.equal(await reconcileAiWorker('configured-key', findContainer, stopContainer), true);
    assert.deepEqual(calls, []);
    assert.equal(await reconcileAiWorker('', async () => '', stopContainer), false);
    assert.deepEqual(calls, []);
});

test('local Compose uses Claude settings from project env, not stale host settings', () => {
    const host = { ANTHROPIC_API_KEY: 'other-account', ANTHROPIC_BASE_URL: 'https://other.example',
        CLAUDE_MODEL: 'other-worker', SUPPORT_CLAUDE_MODEL: 'other-chat', PATH: 'unchanged' };
    const project = { ANTHROPIC_API_KEY: 'project-key', ANTHROPIC_BASE_URL: 'https://gateway.example',
        CLAUDE_MODEL: 'claude-opus-5', SUPPORT_CLAUDE_MODEL: 'claude-sonnet-5' };
    const env = localComposeEnvironment(host, project, { JOBFIND_WEB_PORT: '3001' });
    for (const name of Object.keys(project)) assert.equal(env[name], project[name]);
    assert.equal(env.PATH, 'unchanged');
    assert.equal(env.JOBFIND_WEB_PORT, '3001');
    const withoutKey = localComposeEnvironment(host, { ANTHROPIC_API_KEY: '' });
    assert.equal(withoutKey.ANTHROPIC_API_KEY, '');
    for (const name of ['ANTHROPIC_BASE_URL', 'CLAUDE_MODEL', 'SUPPORT_CLAUDE_MODEL']) {
        assert.equal(Object.hasOwn(withoutKey, name), false);
    }
});

test('local Compose passes the project mail sender only when real email is explicitly enabled', () => {
    const host = { JOBFIND_EMAIL_APP: 'stale@host.example', JOBFIND_EMAIL_APP_PASSWORD: 'stale' };
    const project = { EMAIL_APP: 'sender@gmail.com', EMAIL_APP_PASSWORD: 'app $pass', EMAIL_DEMO_RECIPIENT: '' };
    const off = localComposeEnvironment(host, project);
    for (const name of ['JOBFIND_EMAIL_APP', 'JOBFIND_EMAIL_APP_PASSWORD', 'JOBFIND_EMAIL_DEMO_RECIPIENT']) assert.equal(Object.hasOwn(off, name), false);
    assert.equal(localEmailDeliveryEnabled(project), false);
    const enabled = { ...project, LOCAL_EMAIL_DELIVERY: ' TRUE ' };
    const on = localComposeEnvironment(host, enabled);
    assert.equal(localEmailDeliveryEnabled(enabled), true);
    assert.equal(on.JOBFIND_EMAIL_APP, 'sender@gmail.com');
    assert.equal(on.JOBFIND_EMAIL_APP_PASSWORD, 'app $pass');
    assert.equal(Object.hasOwn(on, 'JOBFIND_EMAIL_DEMO_RECIPIENT'), false);
    assert.equal(localEmailDeliveryEnabled({ LOCAL_EMAIL_DELIVERY: 'yes' }), false);
});

test('Claude runtime comparison detects stale provider settings without storing secrets', () => {
    const config = { ANTHROPIC_API_KEY: 'configured-key', ANTHROPIC_BASE_URL: 'https://gateway.example',
        CLAUDE_MODEL: 'claude-opus-5', SUPPORT_CLAUDE_MODEL: 'claude-sonnet-5' };
    const shared = { ANTHROPIC_API_KEY: 'configured-key', ANTHROPIC_BASE_URL: 'https://gateway.example' };
    const worker = { ...shared, CLAUDE_MODEL: 'claude-opus-5' };
    const chat = { ...shared, SUPPORT_CLAUDE_MODEL: 'claude-sonnet-5' };
    assert.equal(claudeRuntimeMatches(config, worker, chat), true);
    assert.equal(claudeRuntimeMatches(config, { ...worker, ANTHROPIC_API_KEY: 'old-key' }, chat), false);
    assert.equal(claudeRuntimeMatches(config, worker, { ...chat, SUPPORT_CLAUDE_MODEL: 'old-model' }), false);
    assert.equal(claudeRuntimeMatches(config, null, chat), false);
    assert.equal(claudeRuntimeMatches({ ...config, ANTHROPIC_API_KEY: '' }, null, { ...chat, ANTHROPIC_API_KEY: '' }), true);
    assert.equal(claudeRuntimeMatches({ ...config, ANTHROPIC_API_KEY: '' }, worker, chat), false);
});

test('stop cancels readiness polling immediately and never accepts readiness after abort', async () => {
    const controller = new AbortController();
    await assert.rejects(waitFor(async () => { controller.abort(new Error('stop')); return true; }, 'fixture',
        { interval: 10000, signal: controller.signal }), /stop/);
});

test('logged commands report spawn, timeout and output file failures', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfind-runtime-'));
    try {
        await assert.rejects(runLoggedCommand(path.join(directory, 'absent.exe'), [], { file: path.join(directory, 'spawn.log') }));
        await assert.rejects(runLoggedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
            { file: path.join(directory, 'timeout.log'), timeout: 100 }), /thời gian/);
        await assert.rejects(runLoggedCommand(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("data"),10)'],
            { file: directory, timeout: 5000 }));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('TCP probe tells a listening service from a closed port', async () => {
    const server = net.createServer(socket => socket.destroy());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try { assert.equal(await canConnect('127.0.0.1', port), true); }
    finally { await new Promise(resolve => server.close(resolve)); }
    assert.equal(await canConnect('127.0.0.1', port, 3000), false);
});

test('a missing prerequisite is named once and the launch continues when it starts', async () => {
    const phases = [];
    const onWaiting = phase => phases.push(phase);
    assert.equal(await awaitService(async () => true, { waiting: 'không hiện', failed: 'x', timeout: 1000, onWaiting }), false);
    let checks = 0;
    const probe = async () => { if (++checks === 1) throw new Error('refused'); return checks >= 3; };
    assert.equal(await awaitService(probe, { waiting: 'Đang chờ MySQL', failed: 'x', timeout: 5000, interval: 5, onWaiting }), true);
    assert.deepEqual(phases, ['Đang chờ MySQL']);
    await assert.rejects(awaitService(async () => false, { waiting: 'w', failed: 'Không kết nối được MySQL', timeout: 30, interval: 5 }),
        { message: 'Không kết nối được MySQL' });
    const controller = new AbortController();
    const waiting = awaitService(async () => false, { waiting: 'w', failed: 'hết giờ', timeout: 10000, interval: 5, signal: controller.signal });
    controller.abort(new Error('stop requested'));
    await assert.rejects(waiting, /stop requested/);
});

test('npm start follows the launcher to readiness and prints each step once', async () => {
    const pid = 4242;
    const steps = names => names.map(phase => ({ phase, at: '2026-09-29T13:00:00.000Z' }));
    const snapshots = [
        null,
        { pid: 1, status: 'failed', phases: steps(['phiên trước']) },
        { pid, status: 'starting', phases: steps(['A']) },
        { pid, status: 'starting', phases: steps(['A', 'B', 'C']) },
        { pid, status: 'running', webUrl: 'http://localhost:3001', phases: steps(['A', 'B', 'C', 'D']) },
    ];
    const seen = [];
    const final = await followLaunch({ pid, interval: 1, isAlive: () => true, readState: async () => snapshots.shift(),
        onPhase: ({ phase }) => seen.push(phase) });
    assert.equal(final.status, 'running');
    assert.deepEqual(seen, ['A', 'B', 'C', 'D']);
    // A launcher from before phases were recorded still reports its changes.
    const legacy = [{ pid, status: 'starting', phase: 'X' }, { pid, status: 'starting', phase: 'X' }, { pid, status: 'running', phase: 'Y' }];
    seen.length = 0;
    await followLaunch({ pid, interval: 1, isAlive: () => true, readState: async () => legacy.shift(), onPhase: ({ phase }) => seen.push(phase) });
    assert.deepEqual(seen, ['X', 'Y']);
});

test('npm start reports a failed or vanished launcher, and Ctrl+C only stops following', async () => {
    const failed = await followLaunch({ pid: 7, interval: 1, isAlive: () => true,
        readState: async () => ({ pid: 7, status: 'failed', error: 'Không kết nối được MySQL', phases: [] }) });
    assert.equal(failed.error, 'Không kết nối được MySQL');
    const vanished = await followLaunch({ pid: 7, interval: 1, isAlive: () => false,
        readState: async () => ({ pid: 7, status: 'starting', phases: [] }) });
    assert.equal(vanished.status, 'failed');
    assert.match(vanished.error, /đã dừng đột ngột/);
    // The final state written just before exiting wins over the exited process.
    const stopped = await followLaunch({ pid: 7, interval: 1, isAlive: () => false,
        readState: async () => ({ pid: 7, status: 'stopped', phases: [] }) });
    assert.equal(stopped.status, 'stopped');
    const controller = new AbortController();
    const following = followLaunch({ pid: 7, interval: 60000, isAlive: () => true, signal: controller.signal,
        readState: async () => ({ pid: 7, status: 'starting', phases: [] }) });
    controller.abort();
    assert.equal(await following, null);
});

test('stop aborts an in-flight command', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfind-runtime-'));
    const controller = new AbortController();
    try {
        const task = runLoggedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
            { file: path.join(directory, 'abort.log'), signal: controller.signal });
        controller.abort(new Error('stop requested'));
        await assert.rejects(task, /stop requested/);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
