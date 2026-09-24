import { validateMessages, streamGemini } from '../services/supportChatService';
import { streamSupportGateway } from '../services/supportGatewayService';

let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 8;

const sendFrame = (res, event, payload) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
};

// Guest-safe: no account information is read or forwarded to the model.
export const handleSupportChat = async (req, res) => {
    let messages;
    try {
        messages = validateMessages(req.body && req.body.messages);
    } catch (error) {
        return res.status(error.status || 400).json({ errCode: 400, errMessage: error.message });
    }
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        return res.status(429).json({ errCode: 429, errMessage: 'Chatbot đang bận. Vui lòng thử lại sau.' });
    }
    const controller = new AbortController();
    let started = false;
    const abortOnDisconnect = () => {
        if (!res.writableEnded) controller.abort();
    };
    res.on('close', abortOnDisconnect);
    activeRequests++;
    try {
        const emit = (event, payload) => {
            if (controller.signal.aborted || res.destroyed) return;
            if (!started) {
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.flushHeaders();
                started = true;
            }
            sendFrame(res, event, payload);
        };
        if (process.env.SUPPORT_CHAT_GATEWAY_URL?.trim()) {
            await streamSupportGateway({ messages, signal: controller.signal, onEvent: emit });
        } else {
            await streamGemini({
                messages,
                signal: controller.signal,
                onTool: (result) => emit('tool', result),
                onText: (text) => emit('token', { text })
            });
        }
        if (controller.signal.aborted || res.destroyed) return;
        if (!started) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.flushHeaders();
        }
        sendFrame(res, 'done', {});
        res.end();
    } catch (error) {
        if (controller.signal.aborted || res.destroyed) return;
        const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        const status = timedOut ? 504 : (error.status || 502);
        const message = timedOut ? 'AI phản hồi quá lâu. Vui lòng thử lại.'
            : (error.status ? error.message : 'Không kết nối được với AI. Vui lòng thử lại.');
        if (!res.headersSent) return res.status(status).json({ errCode: status, errMessage: message });
        sendFrame(res, 'error', { message });
        res.end();
    } finally {
        activeRequests--;
        res.off('close', abortOnDisconnect);
    }
};
