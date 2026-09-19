import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supportRequest } from '../../service/supportChatService';
import SupportMarkdown from './SupportMarkdown';
import './SupportChat.css';

export default function SupportInbox() {
    const [tickets, setTickets] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const refresh = async () => { try { setTickets(await supportRequest('/handoffs')); } catch (cause) { setError(cause.message); } };
    useEffect(() => { refresh(); }, []);
    const act = async (id, action) => {
        setBusy(true); setError('');
        try { setSelected(await supportRequest(`/handoffs/${id}/${action}`, { method: 'POST', body: {} })); await refresh(); }
        catch (cause) { setError(cause.message); } finally { setBusy(false); }
    };
    const label = status => ({ waiting: 'Chờ tiếp nhận', assigned: 'Đã tiếp nhận', resolved: 'Đã xử lý' }[status] || status);
    return <main className="jf-support-inbox"><h1>Yêu cầu hỗ trợ chatbot</h1><p>Chỉ hiển thị hội thoại người dùng đã đồng ý chuyển cho nhân viên. Tiếp nhận yêu cầu sẽ chuyển phần hội thoại gần nhất vào mục Tin nhắn.</p><button type="button" onClick={refresh} disabled={busy}>Làm mới</button>{error && <p role="alert">{error}</p>}
        <div className="jf-support-inbox__columns"><div>{tickets.length ? tickets.map(ticket => <article key={ticket.id}><h2>{ticket.title}</h2><p>{label(ticket.status)} · {new Date(Number(ticket.createdAt)).toLocaleString('vi-VN')}</p><small>Mã yêu cầu: {ticket.id}</small><button type="button" disabled={busy || ticket.status === 'resolved'} onClick={() => act(ticket.id, 'claim')}>{ticket.status === 'waiting' ? 'Tiếp nhận' : 'Mở / thử chuyển lại'}</button></article>) : <p>Chưa có yêu cầu hỗ trợ.</p>}</div>
        {selected && <section><h2>Hội thoại đã chuyển</h2><p>{label(selected.status)}</p>{selected.deliveryPending && <p role="alert">Yêu cầu đã được phân công nhưng chưa chuyển được tin nhắn. Nhấn “Mở / thử chuyển lại” để thử lại, không tạo tin nhắn trùng.</p>}<Link to={`/admin/chat/${selected.userId}`}>Mở tin nhắn với người dùng ↗</Link>{selected.messages.map(message => <article key={message.id}><strong>{message.role === 'user' ? 'Người dùng' : 'Trợ lý'}</strong><SupportMarkdown text={message.text}/></article>)}<button type="button" disabled={busy || selected.status === 'resolved'} onClick={() => act(selected.id, 'resolve')}>Đánh dấu đã xử lý</button></section>}</div>
    </main>;
}
