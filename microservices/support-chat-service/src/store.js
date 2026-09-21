import { randomUUID } from 'node:crypto';
import { failure } from './policy.js';

export const ddl = [
    `CREATE TABLE IF NOT EXISTS support_conversations (
      id CHAR(36) PRIMARY KEY, owner_key VARCHAR(80) NOT NULL, title VARCHAR(140) NOT NULL,
      messages JSON NOT NULL, version INT NOT NULL DEFAULT 0, request_id CHAR(36), lease_until BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
      INDEX support_owner (owner_key, updated_at), INDEX support_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS support_handoffs (
      id CHAR(36) PRIMARY KEY, conversation_id CHAR(36) NOT NULL UNIQUE, user_id INT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'waiting', agent_id INT NULL, delivered_at BIGINT NULL, transcript JSON NOT NULL,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
      INDEX support_queue (status, created_at),
      FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];
const decode = row => row && ({ id: row.id, title: row.title, messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
    version: row.version, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), expiresAt: Number(row.expires_at) });
const MAX_CONVERSATION_MESSAGES = 200;
export function createStore(pool, retentionDays = 30) {
    const ttl = Math.max(1, Math.min(90, Number(retentionDays) || 30)) * 86400000;
    async function transaction(work) {
        const connection = await pool.getConnection();
        try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
        catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
    async function owned(db, owner, id, lock = false) {
        const [rows] = await db.query(`SELECT * FROM support_conversations WHERE id=? AND owner_key=? AND expires_at>?${lock ? ' FOR UPDATE' : ''}`, [id, owner, Date.now()]);
        if (!rows[0]) throw failure(404, 'Không tìm thấy hội thoại.');
        return rows[0];
    }
    return {
        async migrate() { for (const sql of ddl) await pool.query(sql); },
        async cleanup() { await pool.query('DELETE FROM support_conversations WHERE expires_at<? AND lease_until<? LIMIT 500', [Date.now(), Date.now()]); },
        async list(owner) {
            const [rows] = await pool.query('SELECT id,title,version,created_at,updated_at,expires_at FROM support_conversations WHERE owner_key=? AND expires_at>? ORDER BY updated_at DESC LIMIT 50', [owner, Date.now()]);
            return rows.map(row => ({ ...decode({ ...row, messages: [] }), messages: undefined }));
        },
        async get(owner, id) {
            const row = await owned(pool, owner, id);
            const result = decode(row);
            result.messages = result.messages.map(message => message.status === 'pending' && Number(row.lease_until) < Date.now() ? { ...message, status: 'failed' } : message);
            const [tickets] = await pool.query('SELECT id,status,agent_id AS agentId FROM support_handoffs WHERE conversation_id=?', [id]);
            return { ...result, handoff: tickets[0] || null };
        },
        async remove(owner, id) {
            return transaction(async db => {
                const row = await owned(db, owner, id, true);
                if (Number(row.lease_until) > Date.now()) throw failure(409, 'Hãy dừng câu trả lời và thử lại sau vài giây.');
                await db.query('DELETE FROM support_conversations WHERE id=? AND owner_key=?', [id, owner]);
            });
        },
        async begin(owner, input) {
            return transaction(async db => {
                const now = Date.now(), id = input.conversationId || input.requestId;
                let row;
                if (input.conversationId) row = await owned(db, owner, id, true);
                else {
                    await db.query('INSERT IGNORE INTO support_conversations (id,owner_key,title,messages,created_at,updated_at,expires_at) VALUES (?,?,?, ?,?,?,?)', [id, owner, input.text.slice(0, 55), '[]', now, now, now + ttl]);
                    row = await owned(db, owner, id, true);
                }
                let state = decode(row);
                if (row.request_id === input.requestId) {
                    if (state.messages.find(message => message.id === input.requestId)?.text !== input.text) throw failure(409, 'Mã yêu cầu đã được dùng cho câu hỏi khác.');
                    if (Number(row.lease_until) > now) throw failure(409, 'Câu hỏi đang được xử lý.');
                    return { ...state, replay: true };
                }
                if (Number(row.lease_until) > now) throw failure(409, 'Hội thoại đang trả lời ở cửa sổ khác.');
                if (input.conversationId && state.version !== input.version) throw failure(409, 'Hội thoại đã thay đổi. Hãy mở lại từ lịch sử.');
                let messages = state.messages;
                if (input.replaceFrom) {
                    const index = messages.findIndex(m => m.id === input.replaceFrom && m.role === 'user');
                    if (index < 0) throw failure(409, 'Câu hỏi cần sửa không còn trong lịch sử.');
                    messages = messages.slice(0, index);
                } else if (input.parentId) {
                    const index = messages.findIndex(m => m.id === input.parentId);
                    if (index < 0) throw failure(409, 'Lịch sử đã thay đổi.');
                    messages = messages.slice(0, index + 1);
                } else if (messages.length) throw failure(409, 'Thiếu mốc nối tiếp hội thoại.');
                // Bound each record without silently discarding earlier questions.
                // Explicit edits/regeneration above may shorten an existing branch.
                if (messages.length + 2 > MAX_CONVERSATION_MESSAGES)
                    throw failure(409, 'Hội thoại đã đạt giới hạn 100 lượt hỏi đáp. Hãy tạo cuộc trò chuyện mới; lịch sử hiện tại vẫn được giữ nguyên.');
                const answerId = randomUUID();
                messages = [...messages, { id: input.requestId, role: 'user', text: input.text, status: 'complete' },
                    { id: answerId, role: 'assistant', text: '', status: 'pending', cards: [], sources: [] }];
                await db.query('UPDATE support_conversations SET title=?,messages=?,version=version+1,request_id=?,lease_until=?,updated_at=?,expires_at=? WHERE id=?',
                    [messages.find(message => message.role === 'user').text.slice(0,55), JSON.stringify(messages), input.requestId, now + 90000, now, now + ttl, id]);
                return { ...state, messages, id, answerId, version: state.version + 1 };
            });
        },
        async finish(owner, state, answer) {
            const messages = state.messages.map(m => m.id === state.answerId ? { ...m, ...answer } : m);
            const [result] = await pool.query('UPDATE support_conversations SET messages=?,lease_until=0,updated_at=? WHERE id=? AND owner_key=? AND version=?',
                [JSON.stringify(messages), Date.now(), state.id, owner, state.version]);
            if (result.affectedRows !== 1) throw failure(409, 'Không thể lưu câu trả lời.');
        },
        async handoff(owner, id, userId) {
            return transaction(async db => {
                const row = await owned(db, owner, id, true);
                const now = Date.now();
                const transcript = decode(row).messages.filter(message => message.status === 'complete');
                await db.query('INSERT IGNORE INTO support_handoffs (id,conversation_id,user_id,transcript,created_at,updated_at) VALUES (?,?,?,?,?,?)', [randomUUID(), id, userId, JSON.stringify(transcript), now, now]);
                const [rows] = await db.query('SELECT id,status,agent_id AS agentId FROM support_handoffs WHERE conversation_id=?', [id]);
                return rows[0];
            });
        },
        async queue() {
            const [rows] = await pool.query("SELECT h.id,h.user_id AS userId,h.status,h.agent_id AS agentId,h.created_at AS createdAt,h.updated_at AS updatedAt,h.delivered_at AS deliveredAt,LEFT(JSON_UNQUOTE(JSON_EXTRACT(h.transcript,'$[0].text')),140) AS title FROM support_handoffs h JOIN support_conversations c ON c.id=h.conversation_id WHERE c.expires_at>? ORDER BY (h.status='waiting') DESC,(h.status='assigned') DESC,h.created_at ASC LIMIT 100", [Date.now()]);
            return rows.map(({ deliveredAt, ...row }) => ({ ...row, title: row.title || 'Yêu cầu hỗ trợ', delivered: !!deliveredAt }));
        },
        async ticket(id) {
            const [rows] = await pool.query('SELECT h.id,h.user_id AS userId,h.status,h.agent_id AS agentId,h.created_at AS createdAt,h.updated_at AS updatedAt,h.delivered_at AS deliveredAt,h.transcript FROM support_handoffs h JOIN support_conversations c ON c.id=h.conversation_id WHERE h.id=? AND c.expires_at>?', [id, Date.now()]);
            if (!rows[0]) throw failure(404, 'Yêu cầu không còn tồn tại hoặc đã hết thời gian lưu.');
            const { transcript, deliveredAt, ...row } = rows[0];
            const messages = typeof transcript === 'string' ? JSON.parse(transcript) : transcript;
            // Read only the snapshot explicitly shared with support. Viewing
            // details never claims the ticket or sends a chat message.
            return { ...row, title: messages.find(m => m.role === 'user')?.text.slice(0, 140) || 'Yêu cầu hỗ trợ', messages, delivered: !!deliveredAt };
        },
        async claim(id, agentId, resolve = false) {
            return transaction(async db => {
                const [rows] = await db.query('SELECT h.*,h.transcript AS messages FROM support_handoffs h JOIN support_conversations c ON c.id=h.conversation_id WHERE h.id=? AND c.expires_at>? FOR UPDATE', [id, Date.now()]);
                const row = rows[0];
                if (!row) throw failure(404, 'Yêu cầu không tồn tại.');
                if (row.user_id === agentId) throw failure(409, 'Bạn không thể tự tiếp nhận yêu cầu của mình.');
                if ((row.agent_id && row.agent_id !== agentId) || row.status === 'resolved') throw failure(409, 'Yêu cầu đã được nhân viên khác xử lý hoặc đã đóng.');
                if (resolve && row.agent_id !== agentId) throw failure(409, 'Hãy tiếp nhận yêu cầu trước.');
                if (resolve && !row.delivered_at) throw failure(409, 'Hãy chuyển hội thoại vào Tin nhắn trước khi đánh dấu đã xử lý.');
                await db.query('UPDATE support_handoffs SET agent_id=?,status=?,updated_at=? WHERE id=?', [agentId, resolve ? 'resolved' : 'assigned', Date.now(), id]);
                return { id, userId: row.user_id, agentId, delivered: !!row.delivered_at, status: resolve ? 'resolved' : 'assigned', messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages };
            });
        },
        async delivered(id) { await pool.query('UPDATE support_handoffs SET delivered_at=? WHERE id=?', [Date.now(), id]); }
    };
}
