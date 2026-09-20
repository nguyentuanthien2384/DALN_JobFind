import express from 'express';
import { requireTrustedGateway, requireServicePermission, PERMISSIONS } from '../../shared/accessControl.js';
import { failure, guestIdentity, validateTurn } from './policy.js';
import { articles } from './knowledge.js';
import { privateIntent } from './tools.js';
import { contractRoute } from '../../shared/requestContract.js';

export function registerSupportRoutes(app, { store, respond, tools, env = process.env }) {
    app.use(express.json({ limit: '16kb' }));
    app.use(requireTrustedGateway);
    app.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
    const owner = (req, res, next) => {
        try {
            if (req.user) req.supportOwner = `user:${req.user.id}`;
            else {
                const guest = guestIdentity(req.headers['x-support-guest'], env.INTERNAL_SECRET);
                req.supportOwner = guest.owner; res.setHeader('X-Support-Guest', guest.token);
            }
            next();
        } catch (error) { next(error); }
    };
    const use = requireServicePermission(PERMISSIONS.SUPPORT_USE);
    const manage = requireServicePermission(PERMISSIONS.SUPPORT_MANAGE);
    const data = (res, value) => res.json({ errCode: 0, data: value });
    contractRoute(app, 'supportKnowledge', (_req, res) => data(res, articles.map(({ keywords, ...article }) => article)));
    contractRoute(app, 'supportList', owner, async (req, res) => data(res, await store.list(req.supportOwner)));
    contractRoute(app, 'supportGet', owner, async (req, res) => data(res, await store.get(req.supportOwner, req.params.id)));
    contractRoute(app, 'supportDelete', owner, async (req, res) => { await store.remove(req.supportOwner, req.params.id); return data(res, { deleted: true }); });
    contractRoute(app, 'supportPrivate', use, async (req, res) => data(res, await tools.privateTool(req.params.name, req.user)));
    contractRoute(app, 'supportHandoff', use, owner, async (req, res) => {
        if (req.body.consent !== true) throw failure(400, 'Cần đồng ý chia sẻ hội thoại với nhân viên.');
        return data(res, await store.handoff(req.supportOwner, req.params.id, req.user.id));
    });
    contractRoute(app, 'supportQueue', manage, async (_req, res) => data(res, await store.queue()));
    contractRoute(app, 'supportTicket', manage, async (req, res) => data(res, await store.ticket(req.params.id)));
    contractRoute(app, 'supportClaim', manage, async (req, res) => {
        const ticket = await store.claim(req.params.id, req.user.id);
        if (!ticket.delivered) {
            try { await tools.deliver(ticket, req.user); await store.delivered(ticket.id); ticket.delivered = true; }
            catch { ticket.deliveryPending = true; }
        }
        return data(res, ticket);
    });
    contractRoute(app, 'supportResolve', manage, async (req, res) => data(res, await store.claim(req.params.id, req.user.id, true)));
    let active = 0;
    contractRoute(app, 'supportTurn', owner, async (req, res) => {
        const input = validateTurn(req.body);
        if (active >= 8) throw failure(429, 'Chatbot đang bận. Vui lòng thử lại sau.');
        active += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        const close = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', close);
        let state, partial = '', sources = [], cards = [], answer;
        const emit = (event, payload) => {
            if (event === 'token') partial += payload.text;
            if (event === 'sources') sources = payload.sources;
            if (event === 'tool') cards = [...new Map([...cards, ...(payload.jobs || (payload.job ? [payload.job] : []))].map(job => [job.id, job])).values()].slice(0,5);
            if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        try {
            state = await store.begin(req.supportOwner, input);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
            emit('state', { id: state.id, version: state.version, answerId: state.answerId, userId: input.requestId });
            if (state.replay) {
                const existing = state.messages.at(-1);
                if (existing?.status !== 'complete') throw failure(409, 'Lần trả lời trước bị gián đoạn. Hãy gửi lại câu hỏi.');
                emit('sources', { sources: existing.sources || [] });
                if (existing.cards?.length) emit('tool', { name: 'search_jobs', jobs: existing.cards });
                emit('token', { text: existing.text }); emit('done', {}); return;
            }
            const intent = privateIntent(input.text);
            if (intent) {
                let text;
                try {
                    const result = await tools.privateTool(intent, req.user);
                    text = `${result.title}\n\n${result.lines.length ? result.lines.map(line => `• ${line}`).join('\n') : 'Chưa có dữ liệu.'}\n\nTra cứu trực tiếp từ tài khoản, không gửi kết quả cho AI.`;
                } catch (error) { text = error.status === 401 || error.status === 403 ? error.message : 'Chưa đọc được dữ liệu cá nhân hiện tại. Bạn hãy thử lại hoặc chuyển cho nhân viên hỗ trợ.'; }
                emit('token', { text });
                answer = { text, status: 'complete', private: true, mode: 'account', cards: [], sources: [] };
            } else answer = await respond({ messages: state.messages, signal: controller.signal, emit });
            await store.finish(req.supportOwner, state, answer);
            if (answer.status !== 'complete') emit('error', { message: 'Câu trả lời bị gián đoạn. Bạn có thể tạo lại hoặc chuyển cho nhân viên.' });
            else emit('done', {});
        } catch (error) {
            if (state && !state.replay) await store.finish(req.supportOwner, state, { text: partial, sources, cards, status: controller.signal.aborted ? 'cancelled' : 'failed' }).catch(() => {});
            if (!res.headersSent) throw error;
            emit('error', { message: 'Chưa hoàn tất câu trả lời. Vui lòng thử lại hoặc chuyển cho nhân viên.' });
        } finally {
            clearTimeout(timer); res.off('close', close); active -= 1;
            if (res.headersSent) res.end();
        }
    });
    app.use((_req, res) => res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy API.' }));
    app.use((error, _req, res, _next) => {
        const status = error.status >= 400 && error.status < 600 ? error.status : 503;
        return res.status(status).json({ errCode: status, errMessage: status === 503 ? 'Dịch vụ hỗ trợ tạm thời chưa sẵn sàng.' : error.type === 'entity.too.large' ? 'Yêu cầu quá lớn.' : error.message });
    });
}
