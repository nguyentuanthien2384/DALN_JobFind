import { getAccessToken } from '../auth/authClient';
// Dedicated fetch client: the shared Axios client buffers JSON and cannot read SSE.
const API_BASE = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const GUEST_KEY = 'jobfind-support-guest';
const supportHeaders = async () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    else { const guest = sessionStorage.getItem(GUEST_KEY); if (guest) headers['X-Support-Guest'] = guest; }
    return headers;
};
const rememberGuest = response => {
    const token = response.headers?.get('X-Support-Guest');
    if (token) sessionStorage.setItem(GUEST_KEY, token);
};
export const supportRequest = async (path, { method = 'GET', body, signal } = {}) => {
    const response = await fetch(`${API_BASE}/api/support${path}`, { method, headers: await supportHeaders(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal });
    rememberGuest(response);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errCode) throw new Error(payload.errMessage || 'Không kết nối được dịch vụ hỗ trợ.');
    return payload.data;
};
export const supportApi = {
    list: signal => supportRequest('/conversations', { signal }),
    get: (id, signal) => supportRequest(`/conversations/${encodeURIComponent(id)}`, { signal }),
    remove: id => supportRequest(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    privateTool: name => supportRequest(`/private/${encodeURIComponent(name)}`),
    handoff: id => supportRequest(`/conversations/${encodeURIComponent(id)}/handoff`, { method: 'POST', body: { consent: true } }),
    resetGuest: () => sessionStorage.removeItem(GUEST_KEY)
};

export const prepareSupportHistory = (messages) => {
    const clean = messages.filter((message) =>
        ['user', 'assistant'].includes(message.role)
        && (message.status === undefined || message.status === 'complete')
        && typeof message.text === 'string' && message.text.trim()
    ).map(({ role, text, cards }) => ({ role, text: (text.trim().slice(0, role === 'user' ? 1400 : 6000)
        + (role === 'assistant' && cards?.length ? '\nMã tin đã hiển thị: ' + cards.filter((job) => Number.isSafeInteger(job.id) && job.id > 0).map((job) => `#${job.id}`).join(', ') : '')) }));
    // Keep only consecutive, alternating turns, always ending in the new user message.
    const recent = [];
    for (const message of clean.slice(-12)) {
        if (recent.length && recent[recent.length - 1].role === message.role) {
            recent[recent.length - 1] = message;
        } else recent.push(message);
    }
    while (recent.length && recent[0].role !== 'user') recent.shift();
    while (recent.length > 1 && recent.reduce((size, item) => size + item.text.length, 0) > 8500) recent.splice(0, 2);
    return recent;
};

export const streamSupportReply = async (messages, { signal, onText, onTool = () => {}, onState = () => {}, onSources = () => {}, onMode = () => {}, turn }) => {
    const response = await fetch(`${API_BASE}${turn ? '/api/support/turn' : '/api/support-chat'}`, {
        method: 'POST',
        headers: { ...(turn ? await supportHeaders() : { 'Content-Type': 'application/json' }), Accept: 'text/event-stream' },
        body: JSON.stringify(turn || { messages: prepareSupportHistory(messages) }),
        signal
    });
    if (turn) rememberGuest(response);
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.errMessage || `Máy chủ trả về lỗi ${response.status}.`);
    }
    if (!response.body) throw new Error('Trình duyệt không hỗ trợ nhận câu trả lời trực tiếp.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let completed = false;
    const consumeFrame = (frame) => {
        const lines = frame.split('\n');
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart()).join('\n');
        if (!event || !data) return;
        let payload;
        try { payload = JSON.parse(data); } catch { throw new Error('Dữ liệu phản hồi từ chatbot không hợp lệ.'); }
        if (event === 'token' && typeof payload.text === 'string') {
            answer += payload.text;
            if (answer.length > 12000) throw new Error('Câu trả lời vượt quá giới hạn cho phép.');
            onText(answer);
        } else if (event === 'state') onState(payload);
        else if (event === 'sources') onSources(payload.sources || []);
        else if (event === 'mode') onMode(payload.mode);
        else if (event === 'tool' && payload && typeof payload.name === 'string') onTool(payload);
        else if (event === 'error') throw new Error(payload.message || 'AI không thể hoàn tất câu trả lời.');
        else if (event === 'done') completed = true;
    };
    try {
        while (!completed) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            if (buffer.length > 128 * 1024) throw new Error('Phản hồi chatbot quá lớn.');
            buffer = buffer.replace(/\r\n/g, '\n');
            let end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                consumeFrame(frame);
                if (completed) break;
            }
            if (done) break;
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    if (!completed || !answer.trim()) throw new Error('Kết nối bị ngắt trước khi chatbot trả lời xong.');
    return answer;
};
