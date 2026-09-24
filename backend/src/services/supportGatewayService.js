// Optional bridge for callers that still use the backend's direct support-chat URL.
// The Gateway owns the Claude credentials; only validated guest messages cross this boundary.
const SAFE_EVENTS = new Set(['mode', 'sources', 'tool', 'token']);
const MAX_FRAME_LENGTH = 256 * 1024;

const gatewayError = (status = 502) => Object.assign(
    new Error(status === 429 ? 'Chatbot đang bận. Vui lòng thử lại sau.' : 'Không kết nối được với chatbot. Vui lòng thử lại.'),
    { status }
);

const parseFrame = (frame) => {
    let event;
    const data = [];
    for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!event || !data.length) return null;
    try { return { event, payload: JSON.parse(data.join('\n')) }; }
    catch { throw gatewayError(); }
};

export const streamSupportGateway = async ({ messages, signal, onEvent }) => {
    let url;
    try {
        url = new URL((process.env.SUPPORT_CHAT_GATEWAY_URL || '').trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
        const localBackend = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === Number(process.env.PORT || 5000)
            && url.pathname === '/api/support-chat';
        if (localBackend) throw new Error('Bridge points back to backend');
    } catch { throw gatewayError(503); }

    const timeout = AbortSignal.timeout(70000);
    const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!response.ok) throw gatewayError(response.status === 429 ? 429 : response.status === 503 ? 503 : 502);
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body) throw gatewayError();

    const decoder = new TextDecoder();
    let pending = '';
    let completed = false;
    for await (const bytes of response.body) {
        pending += decoder.decode(bytes, { stream: true });
        if (pending.length > MAX_FRAME_LENGTH) throw gatewayError();
        let boundary;
        while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary).replace(/^\r?\n\r?\n/, '');
            const parsed = parseFrame(frame);
            if (!parsed) continue;
            if (parsed.event === 'done') { completed = true; break; }
            if (parsed.event === 'error') throw gatewayError();
            if (SAFE_EVENTS.has(parsed.event)) await onEvent(parsed.event, parsed.payload);
        }
        if (completed) break;
    }
    if (!completed) throw gatewayError();
};
