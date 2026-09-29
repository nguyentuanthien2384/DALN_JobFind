// Under the unified launcher (scripts/dev.mjs) the dev server owns the web port
// from the first seconds, long before the APIs are ready. Until the launcher
// reports "running", page loads get this progress page instead of the browser's
// "connection refused"; the page opens the app by itself once everything is up.
const STATUS_PATH = '/__jobfind/status';

const page = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JobFind đang khởi động</title>
<style>
:root { color-scheme: light dark; --bg: #f4f6fb; --card: #ffffff; --text: #1d2433; --muted: #5f6b7d; --line: #e3e7ef; --accent: #2563eb; --ok: #15803d; --bad: #b91c1c; --bad-bg: #fdecec; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e1320; --card: #161c2b; --text: #e6e9f0; --muted: #9aa5b8; --line: #263049; --accent: #7aa7ff; --ok: #4ade80; --bad: #fca5a5; --bad-bg: #3a1a1f; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 560px; padding: 28px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
h1 { margin: 0 0 6px; font-size: 20px; }
p { margin: 0; color: var(--muted); }
ol { margin: 20px 0; padding: 0; list-style: none; }
li { display: flex; gap: 10px; padding: 3px 0; overflow-wrap: anywhere; }
li::before { content: "✓"; flex: none; width: 18px; text-align: center; color: var(--ok); }
li.current { font-weight: 600; }
li.current::before { content: ""; width: 14px; height: 14px; margin: 4px 2px 0; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .9s linear infinite; }
body.idle li.current::before { animation: none; }
body.failed li.current::before { content: "✕"; width: 18px; height: auto; margin: 0; border: 0; animation: none; color: var(--bad); }
.error { display: none; margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; background: var(--bad-bg); color: var(--bad); white-space: pre-wrap; overflow-wrap: anywhere; }
body.failed .error { display: block; }
code { font: 13px ui-monospace, Consolas, monospace; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { li.current::before { animation-duration: 3s; } }
</style>
</head>
<body>
<main>
<h1 id="title">JobFind đang khởi động</h1>
<p id="summary">Trang sẽ tự mở ứng dụng khi mọi dịch vụ sẵn sàng.</p>
<ol id="steps" aria-live="polite"></ol>
<div class="error" id="error" role="alert"></div>
<p>Tiến độ cũng hiện trong cửa sổ đang chạy <code>npm start</code>; nhật ký ở <code>.local/runtime.log</code>.</p>
</main>
<script>
(() => {
    const byId = id => document.getElementById(id);
    const clock = from => {
        const seconds = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000)) || 0;
        return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    };
    let last = null;
    const render = (state, offline) => {
        state = state || { status: 'starting', phases: [] };
        const failed = state.status === 'failed' || Boolean(state.error);
        const stopping = state.status === 'stopping' || state.status === 'stopped';
        document.body.className = failed ? 'failed' : offline || stopping ? 'idle' : '';
        document.title = byId('title').textContent = failed ? 'JobFind chưa khởi động được'
            : offline ? 'Mất kết nối với trình khởi chạy'
            : stopping ? 'JobFind đang dừng' : 'JobFind đang khởi động';
        byId('summary').textContent = failed ? 'Khắc phục lỗi bên dưới rồi chạy lại npm start; trang sẽ tự tải lại.'
            : offline || stopping ? 'Chạy lại npm start; trang sẽ tự tải lại khi JobFind sẵn sàng.'
            : 'Đã chạy ' + clock(state.startedAt) + '. Trang sẽ tự mở ứng dụng khi mọi dịch vụ sẵn sàng.';
        const steps = byId('steps');
        steps.textContent = '';
        (state.phases || []).forEach((item, index, all) => {
            const step = document.createElement('li');
            step.textContent = item.phase;
            if (index === all.length - 1) step.className = 'current';
            steps.appendChild(step);
        });
        byId('error').textContent = failed ? state.error : '';
    };
    const poll = async () => {
        let response;
        try { response = await fetch('${STATUS_PATH}', { cache: 'no-store', headers: { accept: 'application/json' } }); }
        catch { render(last, true); setTimeout(poll, 2000); return; }
        const state = await response.json().catch(() => null);
        // Anything other than this launcher's status means the app itself is being served now.
        if (!state || state.launcher !== 'jobfind' || state.status === 'running') { location.reload(); return; }
        last = state; render(state, false); setTimeout(poll, 1000);
    };
    poll();
})();
</script>
</body>
</html>
`;

function createLauncherGate() {
    let state = { status: 'starting', phase: '', phases: [], error: '', startedAt: new Date().toISOString() };
    const send = (res, status, type, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
        res.end(body);
    };
    const text = value => typeof value === 'string' ? value : '';
    return {
        update(message) {
            if (message?.type !== 'jobfind:launcher') return;
            state = { status: text(message.status) || 'starting', phase: text(message.phase), error: text(message.error),
                startedAt: text(message.startedAt) || state.startedAt,
                phases: Array.isArray(message.phases) ? message.phases.map(item => ({ phase: text(item?.phase), at: text(item?.at) })) : [] };
        },
        middleware(req, res, next) {
            if ((req.url || '').split('?')[0] === STATUS_PATH) {
                send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ launcher: 'jobfind', ...state }));
                return;
            }
            // Assets, API proxies and HMR pass through; only page loads wait for the launcher.
            const pageLoad = (req.method === 'GET' || req.method === 'HEAD') && /text\/html/.test(req.headers.accept || '');
            if (state.status === 'running' || !pageLoad) { next(); return; }
            send(res, 503, 'text/html; charset=utf-8', req.method === 'HEAD' ? undefined : page, { 'Retry-After': '2' });
        },
    };
}

module.exports = { createLauncherGate, STATUS_PATH };
