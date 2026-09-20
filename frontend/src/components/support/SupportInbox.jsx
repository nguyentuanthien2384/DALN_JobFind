import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SessionContext from '../../auth/SessionContext';
import { supportRequest } from '../../service/supportChatService';
import SupportMarkdown from './SupportMarkdown';
import './SupportInbox.css';

const labels = { waiting: 'Chờ tiếp nhận', assigned: 'Đang xử lý', resolved: 'Đã xử lý' };
const date = value => value ? new Date(Number(value)).toLocaleString('vi-VN') : '—';
const searchText = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const Icon = ({ name, size = 22 }) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === 'refresh' ? <path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>
        : name === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>
            : name === 'check' ? <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>
                : name === 'clock' ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>
                    : <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 9h8M8 13h5"/></>}
</svg>;

export default function SupportInbox() {
    const user = useContext(SessionContext);
    const [tickets, setTickets] = useState([]), [selected, setSelected] = useState(null);
    const [loaded, setLoaded] = useState(false), [refreshing, setRefreshing] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false), [busy, setBusy] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [updatedAt, setUpdatedAt] = useState(null);
    const [filter, setFilter] = useState('all'), [query, setQuery] = useState('');
    const queueRequest = useRef(null), detailRequest = useRef(null), actionRequest = useRef(null), selectedId = useRef(null), queuePending = useRef(false);
    const refresh = useCallback(async () => {
        queueRequest.current?.abort();
        const controller = new AbortController(); queueRequest.current = controller; queuePending.current = true;
        setRefreshing(true); setError('');
        try {
            const rows = await supportRequest('/handoffs', { signal: controller.signal });
            if (controller.signal.aborted) return;
            if (!Array.isArray(rows)) throw new Error('Không đọc được danh sách yêu cầu hỗ trợ.');
            setTickets(rows); setLoaded(true); setUpdatedAt(Date.now());
            if (selectedId.current && !rows.some(row => row.id === selectedId.current)) {
                detailRequest.current?.abort(); selectedId.current = null; setSelected(null); setDetailLoading(false);
            } else setSelected(current => current ? { ...current, ...rows.find(row => row.id === current.id) } : null);
        } catch (cause) { if (!controller.signal.aborted) setError(cause.message); }
        finally { if (!controller.signal.aborted) { queuePending.current = false; setRefreshing(false); } }
    }, []);
    useEffect(() => {
        refresh();
        const whenVisible = () => {
            if (document.visibilityState === 'visible' && navigator.onLine !== false && !actionRequest.current && !queuePending.current) refresh();
        };
        const timer = window.setInterval(whenVisible, 30000);
        document.addEventListener('visibilitychange', whenVisible); window.addEventListener('online', whenVisible);
        return () => {
            window.clearInterval(timer); document.removeEventListener('visibilitychange', whenVisible); window.removeEventListener('online', whenVisible);
            queueRequest.current?.abort(); detailRequest.current?.abort(); actionRequest.current?.abort();
        };
    }, [refresh]);
    const openTicket = async ticket => {
        detailRequest.current?.abort();
        const controller = new AbortController(); detailRequest.current = controller;
        selectedId.current = ticket.id; setSelected(null); setDetailLoading(true); setError(''); setNotice('');
        try {
            const detail = await supportRequest(`/handoffs/${encodeURIComponent(ticket.id)}`, { signal: controller.signal });
            if (!controller.signal.aborted) setSelected(detail);
        } catch (cause) { if (!controller.signal.aborted) setError(cause.message); }
        finally { if (!controller.signal.aborted) setDetailLoading(false); }
    };
    const act = async (ticket, action) => {
        if (actionRequest.current) return;
        if (action === 'resolve' && !window.confirm('Xác nhận bạn đã hỗ trợ xong người dùng và muốn đóng yêu cầu này?')) return;
        queueRequest.current?.abort(); detailRequest.current?.abort();
        const controller = new AbortController(); actionRequest.current = controller;
        setBusy(true); setRefreshing(false); setDetailLoading(false); setError(''); setNotice(''); selectedId.current = ticket.id;
        try {
            const result = await supportRequest(`/handoffs/${encodeURIComponent(ticket.id)}/${action}`, { method: 'POST', body: {}, signal: controller.signal });
            if (controller.signal.aborted) return;
            setSelected({ ...ticket, ...result });
            setNotice(action === 'resolve' ? 'Đã đánh dấu yêu cầu hoàn tất.' : result.deliveryPending ? 'Đã tiếp nhận yêu cầu. Cần thử chuyển lại hội thoại.' : 'Đã tiếp nhận và chuyển hội thoại vào Tin nhắn.');
            await refresh();
        } catch (cause) {
            if (!controller.signal.aborted) { await refresh(); setError(cause.message); }
        } finally { if (!controller.signal.aborted) { actionRequest.current = null; setBusy(false); } }
    };
    const mine = ticket => Number(ticket.agentId) === Number(user?.id);
    const canClaim = ticket => ticket.status !== 'resolved' && Number(ticket.userId) !== Number(user?.id) && (!ticket.agentId || mine(ticket));
    const counts = { all: tickets.length, waiting: tickets.filter(t => t.status === 'waiting').length, assigned: tickets.filter(t => t.status === 'assigned').length, resolved: tickets.filter(t => t.status === 'resolved').length };
    const term = searchText(query.trim());
    const filtered = tickets.filter(ticket => (filter === 'all' || (filter === 'mine' ? mine(ticket) && ticket.status === 'assigned' : ticket.status === filter))
        && (!term || searchText(`${ticket.title} ${ticket.id} ${ticket.userId}`).includes(term)));
    const deliveryPending = selected?.status === 'assigned' && !selected.delivered;
    return <main className="jf-support-inbox">
        <header className="jf-support-inbox__header">
            <div><span className="jf-support-inbox__eyebrow">TRUNG TÂM HỖ TRỢ</span><h1>Yêu cầu hỗ trợ chatbot</h1><p>Tiếp nhận hội thoại được chia sẻ và hỗ trợ người dùng đến khi hoàn tất.</p></div>
            <div className="jf-support-inbox__refresh-area"><button className="jf-support-inbox__button jf-support-inbox__button--refresh" type="button" onClick={refresh} disabled={refreshing || busy}><Icon name="refresh" size={18}/>{refreshing ? 'Đang làm mới...' : 'Làm mới'}</button><small>{updatedAt ? `Cập nhật lúc ${new Date(updatedAt).toLocaleTimeString('vi-VN')}` : 'Đang kết nối hàng đợi'}</small></div>
        </header>
        <div className="jf-support-inbox__stats" aria-label="Tổng quan yêu cầu trong danh sách">
            {[['all', 'Tổng yêu cầu', 'chat'], ['waiting', 'Chờ tiếp nhận', 'clock'], ['assigned', 'Đang xử lý', 'chat'], ['resolved', 'Đã xử lý', 'check']].map(([key, title, icon]) => <button key={key} type="button" className={`jf-support-inbox__stat jf-support-inbox__stat--${key}`} onClick={() => setFilter(key)} aria-pressed={filter === key}><span className="jf-support-inbox__stat-icon"><Icon name={icon}/></span><span><small>{title}</small><strong>{loaded ? counts[key] : '—'}</strong></span></button>)}
        </div>
        <div className="jf-support-inbox__privacy"><Icon name="check" size={18}/><span>Chỉ hiển thị nội dung người dùng đã đồng ý chia sẻ với nhân viên. Hội thoại riêng với chatbot không tự đưa vào hàng đợi.</span></div>
        {error && <div role="alert" className="jf-support-inbox__alert"><strong>Chưa hoàn tất thao tác.</strong> {error} <button type="button" onClick={refresh} disabled={busy || refreshing}>Tải lại danh sách</button></div>}
        {notice && <p role="status" className="jf-support-inbox__notice">{notice}</p>}
        <div className="jf-support-inbox__toolbar">
            <label className="jf-support-inbox__search"><Icon name="search" size={19}/><input type="search" aria-label="Tìm yêu cầu hỗ trợ" placeholder="Tìm nội dung, mã yêu cầu hoặc mã người dùng..." value={query} onChange={e => setQuery(e.target.value)}/></label>
            <label className="jf-support-inbox__filter">Trạng thái<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tất cả yêu cầu</option><option value="waiting">Chờ tiếp nhận</option><option value="assigned">Đang xử lý</option><option value="mine">Tôi đang xử lý</option><option value="resolved">Đã xử lý</option></select></label>
        </div>
        <div className="jf-support-inbox__columns">
            <section className="jf-support-inbox__list" aria-labelledby="support-list-title" aria-busy={refreshing}>
                <div className="jf-support-inbox__section-heading"><h2 id="support-list-title">Danh sách yêu cầu</h2><span>{loaded ? `${filtered.length} yêu cầu` : 'Đang tải'}</span></div>
                {!loaded ? <div className="jf-support-inbox__empty"><Icon name="chat" size={34}/><h3>{error ? 'Chưa tải được danh sách' : 'Đang tải yêu cầu...'}</h3><p>{error ? 'Hãy thử tải lại khi kết nối ổn định.' : 'Vui lòng chờ trong giây lát.'}</p></div>
                    : !tickets.length ? <div className="jf-support-inbox__empty"><span className="jf-support-inbox__empty-icon"><Icon name="chat" size={34}/></span><h3>Chưa có yêu cầu cần hỗ trợ</h3><p>Yêu cầu xuất hiện khi người dùng đăng nhập, trò chuyện với chatbot và chọn “Chuyển hội thoại cho hỗ trợ”.</p><span className="jf-support-inbox__auto">Tự cập nhật mỗi 30 giây khi mở trang</span></div>
                        : !filtered.length ? <div className="jf-support-inbox__empty"><Icon name="search" size={32}/><h3>Không tìm thấy yêu cầu phù hợp</h3><p>Thử từ khóa khác hoặc bỏ bộ lọc để xem lại danh sách.</p><button className="jf-support-inbox__button jf-support-inbox__button--secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Xóa bộ lọc</button></div>
                            : <ul>{filtered.map(ticket => <li key={ticket.id} className={selectedId.current === ticket.id ? 'is-selected' : ''}>
                                <button type="button" className="jf-support-inbox__ticket" disabled={busy} onClick={() => openTicket(ticket)} aria-pressed={selectedId.current === ticket.id}>
                                    <span className={`jf-support-inbox__badge jf-support-inbox__badge--${ticket.status}`}>{labels[ticket.status]}</span><h3>{ticket.title || 'Yêu cầu hỗ trợ'}</h3><span className="jf-support-inbox__ticket-meta">Người dùng #{ticket.userId} · {date(ticket.createdAt)}</span><small>{ticket.agentId ? mine(ticket) ? 'Bạn đang phụ trách' : `Nhân viên #${ticket.agentId}` : 'Chưa có nhân viên tiếp nhận'}</small>
                                </button>
                                <div className="jf-support-inbox__ticket-footer"><span>Mã: {ticket.id.slice(0, 8)}</span>{ticket.status === 'waiting' && canClaim(ticket) && <button className="jf-support-inbox__text-button" disabled={busy || refreshing} onClick={() => act(ticket, 'claim')}>Tiếp nhận</button>}</div>
                            </li>)}</ul>}
                {loaded && tickets.length > 0 && <p className="jf-support-inbox__list-note">Tối đa 100 yêu cầu còn lưu, ưu tiên yêu cầu chờ tiếp nhận. Tìm kiếm và thống kê áp dụng cho danh sách này.</p>}
            </section>
            <section className="jf-support-inbox__detail" aria-labelledby="support-detail-title" aria-busy={detailLoading}>
                <div className="jf-support-inbox__section-heading"><h2 id="support-detail-title">{selected ? 'Chi tiết yêu cầu' : 'Quy trình hỗ trợ'}</h2></div>
                {detailLoading ? <p role="status" className="jf-support-inbox__placeholder">Đang tải hội thoại đã chia sẻ...</p> : selected ? <>
                    <div className="jf-support-inbox__detail-heading"><span className={`jf-support-inbox__badge jf-support-inbox__badge--${selected.status}`}>{labels[selected.status]}</span><h3>{selected.title}</h3><p>Người dùng #{selected.userId} · {date(selected.createdAt)}</p><small>Mã yêu cầu: {selected.id}</small></div>
                    {deliveryPending && <p className="jf-support-inbox__warning" role="alert">Yêu cầu đã được tiếp nhận nhưng chưa chuyển được hội thoại vào Tin nhắn. Nhân viên phụ trách có thể thử lại mà không tạo tin nhắn trùng.</p>}
                    {selected.agentId && !mine(selected) && <p className="jf-support-inbox__info">Nhân viên #{selected.agentId} phụ trách yêu cầu này. Bạn có thể xem nội dung đã được chia sẻ.</p>}
                    {Number(selected.userId) === Number(user?.id) && <p className="jf-support-inbox__info">Yêu cầu do bạn gửi cần một nhân viên khác tiếp nhận.</p>}
                    <div className="jf-support-inbox__actions">
                        {canClaim(selected) && (selected.status === 'waiting' || deliveryPending) && <button className="jf-support-inbox__button jf-support-inbox__button--primary" disabled={busy || refreshing} onClick={() => act(selected, 'claim')}>{busy ? 'Đang xử lý...' : selected.status === 'waiting' ? 'Tiếp nhận yêu cầu' : 'Thử chuyển lại hội thoại'}</button>}
                        {mine(selected) && selected.delivered && <Link className="jf-support-inbox__button jf-support-inbox__button--primary" to={`/admin/chat/${selected.userId}`}>Mở tin nhắn với người dùng ↗</Link>}
                        {mine(selected) && selected.status === 'assigned' && selected.delivered && <button className="jf-support-inbox__button jf-support-inbox__button--secondary" disabled={busy || refreshing} onClick={() => act(selected, 'resolve')}>Đánh dấu đã xử lý</button>}
                    </div>
                    <h4 className="jf-support-inbox__transcript-title">Hội thoại được chia sẻ</h4>
                    <div className="jf-support-inbox__transcript">{(selected.messages || []).map(message => <article key={message.id} className={`jf-support-inbox__message jf-support-inbox__message--${message.role}`}><strong>{message.role === 'user' ? 'Người dùng' : 'Trợ lý JobFind'}</strong><SupportMarkdown text={message.text}/></article>)}</div>
                </> : <div className="jf-support-inbox__guide"><p>Theo dõi yêu cầu và tiếp tục trao đổi với người dùng trong mục Tin nhắn.</p><ol><li><span>1</span><div><strong>Người dùng gửi yêu cầu</strong><p>Trong chatbot, người dùng đồng ý chia sẻ hội thoại và chọn chuyển cho hỗ trợ.</p></div></li><li><span>2</span><div><strong>Xem nội dung và tiếp nhận</strong><p>Chọn yêu cầu để xem trước. Khi tiếp nhận, phần hội thoại gần nhất được chuyển vào Tin nhắn.</p></div></li><li><span>3</span><div><strong>Trả lời và hoàn tất</strong><p>Mở Tin nhắn để hỗ trợ trực tiếp, sau đó đánh dấu yêu cầu đã xử lý.</p></div></li></ol><Link to="/support/help" className="jf-support-inbox__help-link">Xem hướng dẫn sử dụng JobFind ↗</Link></div>}
            </section>
        </div>
    </main>;
}
