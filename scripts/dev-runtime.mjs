import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
// The OS owns this mutex. It disappears when a starter crashes, so concurrent
// starters never need to delete or recover a second stale lock file.
export async function withStartLock(workspace, operation, { timeout = 20000 } = {}) {
    const key = createHash('sha256').update(path.resolve(workspace).toLowerCase()).digest();
    const address = process.platform === 'win32'
        ? `\\\\.\\pipe\\jobfind-start-${key.toString('hex').slice(0, 24)}`
        : { host: '127.0.0.1', port: 40000 + key.readUInt16BE(0) % 20000, exclusive: true };
    const deadline = Date.now() + timeout;
    while (true) {
        const server = net.createServer(socket => socket.destroy());
        try {
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
        } catch (error) {
            if (error.code !== 'EADDRINUSE') throw error;
            if (Date.now() >= deadline) throw new Error('Một lệnh khởi chạy khác đang xử lý. Dùng npm run dev:status.');
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }
        try { return await operation(); }
        finally { await new Promise(resolve => server.close(resolve)); }
    }
}
export async function releaseOwnedLock(file, pid) {
    try {
        if (Number(await fs.readFile(file, 'utf8')) === pid) await fs.rm(file);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export const alive = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
};
export const stopChild = child => {
    if (child.pid && child.exitCode === null && child.signalCode === null && !child.killed) child.kill('SIGTERM');
};
export function matchesSupervisor(command, script) {
    const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)"?${escaped}"?\\s+serve(?:\\s|$)`, 'i').test(command || '');
}
export async function ownedSupervisor(pid, script) {
    if (!alive(pid)) return false;
    if (process.platform === 'win32') {
        const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress }`],
        { windowsHide: true, timeout: 10000 });
        if (!stdout.trim()) return false;
        const info = JSON.parse(stdout);
        return info.ExecutablePath?.toLowerCase() === process.execPath.toLowerCase() && matchesSupervisor(info.CommandLine, script);
    }
    try {
        const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
        return args[1] === script && args[2] === 'serve';
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        // An unverifiable live owner must not be replaced by a second launcher.
        throw new Error('Không xác minh được phiên khởi chạy hiện có.');
    }
}
export const effectiveState = (state, processAlive) => ({ ...state,
    status: !processAlive && ['starting', 'running', 'stopping'].includes(state.status) ? 'stopped' : state.status,
    ...(!processAlive && ['starting', 'running', 'stopping'].includes(state.status) ? { phase: 'Tiến trình đã dừng; dùng npm start để chạy lại.' } : {}),
    processAlive,
});
export async function waitFor(check, label, { timeout = 180000, interval = 1500, signal } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (await check().catch(() => false)) { signal?.throwIfAborted(); return; }
        await new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, interval);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        });
    }
    throw new Error(`Chưa sẵn sàng: ${label}. Xem nhật ký trong .local.`);
}
export async function runLoggedCommand(executable, args, { file, signal, timeout = 600000, ...options }) {
    signal?.throwIfAborted();
    const output = createWriteStream(file, { flags: 'a' });
    const child = spawn(executable, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let rejectExit;
    const exited = new Promise((resolve, reject) => {
        rejectExit = reject;
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error('Docker khởi chạy thất bại; xem .local/docker.log.')));
    });
    // Both pipes share the log; keep it open until the process has closed them.
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    const ioError = new Promise((resolve, reject) => output.once('error', reject));
    const abort = () => { stopChild(child); rejectExit(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { stopChild(child); rejectExit(new Error('Docker vượt quá thời gian khởi chạy; xem .local/docker.log.')); }, timeout);
    try {
        await Promise.race([exited, ioError]);
        await new Promise((resolve, reject) => { output.once('error', reject); output.end(resolve); });
    } catch (error) { stopChild(child); output.destroy(); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
