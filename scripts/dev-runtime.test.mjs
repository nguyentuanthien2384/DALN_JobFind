import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { alive, stopChild, ownedSupervisor, matchesSupervisor, effectiveState, waitFor, runLoggedCommand, withStartLock, releaseOwnedLock } from './dev-runtime.mjs';

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
