import React, { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SessionContext from '../../auth/SessionContext';
import { streamSupportReply } from '../../service/supportChatService';
import {
    addSupportThread, deleteSupportThread, loadSupportStore,
    saveSupportStore, updateSupportMessages, normalizeSupportCards
} from './supportChatStorage';
import { AssistantRuntimeProvider, useExternalStoreRuntime, ThreadPrimitive, ComposerPrimitive, MessagePrimitive, ActionBarPrimitive } from '@assistant-ui/react';
import SupportMarkdown from './SupportMarkdown';
import './SupportChat.css';

const convertMessage = (item) => ({
    id: item.id, role: item.role, content: [{ type: 'text', text: item.text }],
    ...(item.role === 'assistant' ? { status: item.status === 'pending' ? { type: 'running' }
        : item.status === 'cancelled' ? { type: 'incomplete', reason: 'cancelled' }
        : item.status === 'failed' ? { type: 'incomplete', reason: 'error' } : { type: 'complete', reason: 'stop' } } : {}),
    metadata: { custom: item }
});

const QUICK_QUESTIONS = [
    'Tìm việc React đang tuyển tại Hà Nội',
    'Tôi muốn tạo CV và ứng tuyển',
    'Làm sao nhắn tin với nhà tuyển dụng?'
];

const Icon = ({ name, size = 20 }) => {
    const paths = {
        chat: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-4 3v-10A8.5 8.5 0 0 1 10.5 3h2A7.5 7.5 0 0 1 20 11.5Z"/><path d="M7 10h9M7 14h6"/></>,
        close: <path d="M5 5l14 14M19 5 5 19"/>,
        history: <><path d="M3 11a9 9 0 1 1 2.6 6.4M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
        plus: <path d="M12 4v16M4 12h16"/>,
        send: <><path d="M12 19V5M5 12l7-7 7 7"/></>,
        stop: <rect x="7" y="7" width="10" height="10" rx="1"/>,
        back: <path d="M15 18 9 12l6-6"/>,
        trash: <><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v5m4-5v5"/></>,
        sparkles: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 18l.7 2.3L22 21l-2.3.7L19 24l-.7-2.3L16 21l2.3-.7L19 18Z"/></>,
        retry: <><path d="M3 11a9 9 0 1 1 2.7 6.4M3 4v7h7"/></>,
        mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></>
    };
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

const SupportChat = () => {
    const user = useContext(SessionContext);
    const ownerKey = `jobfind-support-v1:${user?.id || 'guest'}`;
    const [store, setStore] = useState(() => loadSupportStore(ownerKey));
    const [isOpen, setOpen] = useState(false);
    const [view, setView] = useState('chat');
    const [editing, setEditing] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [copiedId, setCopiedId] = useState(null);
    const [listening, setListening] = useState(false);
    const speechRef = useRef(null);
    const activeRequest = useRef(null);
    const generation = useRef(0);
    const inputRef = useRef(null);

    const thread = store.threads.find((item) => item.id === store.activeId) || store.threads[0];
    const messages = thread?.messages || [];

    useEffect(() => { saveSupportStore(store); }, [store]);
    useEffect(() => {
        if (isOpen && view === 'chat') inputRef.current?.focus();
    }, [isOpen, view]);
    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);
    useEffect(() => () => { generation.current += 1; activeRequest.current?.abort(); speechRef.current?.abort(); }, []);
    useEffect(() => { if (!isOpen) speechRef.current?.abort(); }, [isOpen]);
    useEffect(() => {
        generation.current += 1;
        activeRequest.current?.abort();
        activeRequest.current = null;
        speechRef.current?.abort();
        setBusy(false);
        setListening(false);
        setOpen(false);
        setStore(loadSupportStore(ownerKey));
    }, [ownerKey]);

    const startSpeech = () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return;
        if (listening) { speechRef.current?.stop(); return; }
        const recognition = new Recognition();
        speechRef.current = recognition;
        recognition.lang = 'vi-VN';
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.onresult = (event) => {
            const transcript = event.results?.[0]?.[0]?.transcript;
            if (typeof transcript === 'string') runtime.thread.composer.setText(`${runtime.thread.composer.getState().text} ${transcript}`.trim().slice(0, 1400));
        };
        recognition.onerror = (event) => { if (event.error !== 'aborted') setError('Không nhận được giọng nói. Kiểm tra quyền micro hoặc nhập bằng bàn phím.'); };
        recognition.onend = () => { speechRef.current = null; setListening(false); };
        try { recognition.start(); setListening(true); } catch { setListening(false); }
    };

    const cancelRequest = () => {
        speechRef.current?.abort();
        setEditing(null);
        generation.current += 1;
        activeRequest.current?.abort();
        activeRequest.current = null;
        setBusy(false);
        // Preserve any partial answer but exclude it from future model context.
        setStore((current) => updateSupportMessages(current, current.activeId,
            (items) => items.filter((item) => item.status !== 'pending' || item.text)
                .map((item) => item.status === 'pending' ? { ...item, status: 'cancelled' } : item)));
    };

    const startNewChat = () => {
        cancelRequest();
        setStore((current) => addSupportThread(current));
        setView('chat');
        setError('');
        runtime.thread.composer.setText('');
        setEditing(null);
    };

    const sendMessage = async (raw, retry = false, history) => {
        if (activeRequest.current) return;
        const question = String(raw || '').trim();
        if (!retry && (!question || question.length > 1400)) return;
        const base = retry ? (history || messages) : [...(history || messages), { role: 'user', text: question, status: 'complete' }];
        const threadId = thread.id;
        const replyId = `${Date.now()}-${Math.random()}`;
        const controller = new AbortController();
        const requestGeneration = ++generation.current;
        activeRequest.current = controller;
        setBusy(true);
        setError('');
        setView('chat');
        runtime.thread.composer.setText('');
        setEditing(null);
        setStore((current) => updateSupportMessages(current, threadId, () =>
            [...base, { id: replyId, role: 'assistant', text: '', cards: [], status: 'pending' }]));
        try {
            const answer = await streamSupportReply(base, {
                signal: controller.signal,
                onTool: (result) => {
                    if (requestGeneration !== generation.current) return;
                    const cards = normalizeSupportCards(result);
                    if (!cards.length) return;
                    setStore((current) => updateSupportMessages(current, threadId,
                        (items) => items.map((item) => item.id === replyId
                            ? { ...item, cards: Array.from(new Map([...(item.cards || []), ...cards].map((job) => [job.id, job])).values()).slice(0, 5) } : item)));
                },
                onText: (text) => {
                    if (requestGeneration !== generation.current) return;
                    setStore((current) => updateSupportMessages(current, threadId,
                        (items) => items.map((item) => item.id === replyId ? { ...item, text } : item)));
                }
            });
            if (requestGeneration !== generation.current) return;
            setStore((current) => updateSupportMessages(current, threadId,
                (items) => items.map((item) => item.id === replyId
                    ? { ...item, text: answer, status: 'complete' } : item)));
        } catch (cause) {
            if (requestGeneration !== generation.current) return;
            if (cause.name === 'AbortError') {
                setStore((current) => updateSupportMessages(current, threadId,
                    (items) => items.filter((item) => item.id !== replyId || item.text)
                        .map((item) => item.id === replyId ? { ...item, status: 'cancelled' } : item)));
            } else {
                setStore((current) => updateSupportMessages(current, threadId,
                    (items) => items.filter((item) => item.id !== replyId || item.text || item.cards?.length)
                        .map((item) => item.id === replyId ? { ...item, status: 'failed' } : item)));
                setError(cause.message || 'Không thể kết nối chatbot. Vui lòng thử lại.');
            }
        } finally {
            if (requestGeneration === generation.current) {
                activeRequest.current = null;
                setBusy(false);
            }
        }
    };

    const retryLast = () => {
        const lastUser = [...messages].reverse().find((item) => item.role === 'user');
        if (lastUser) sendMessage(lastUser.text, true, messages.slice(0, messages.lastIndexOf(lastUser) + 1));
    };

    const copyAnswer = async (text, itemId) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(itemId);
        } catch { setCopiedId(null); }
    };

    const runtime = useExternalStoreRuntime({
        isRunning: busy, messages, convertMessage,
        onNew: (message) => sendMessage(message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')),
        onCancel: async () => cancelRequest(),
        onReload: async (parentId) => {
            const index = messages.findIndex((item) => item.id === parentId);
            if (index >= 0) await sendMessage('', true, messages.slice(0, index + 1));
        }
    });

    return (
        <AssistantRuntimeProvider runtime={runtime}>
        <div className={`jf-support${expanded ? ' jf-support--expanded' : ''}`}>
            {isOpen ? (
                <ThreadPrimitive.Root className="jf-support__panel" role="dialog" aria-label="Trợ lý hỗ trợ JobFind" aria-modal="false">
                    <div className="jf-support__topbar">
                        <div className="jf-support__brand">
                            <span className="jf-support__logo"><Icon name="sparkles" size={19}/></span>
                            <div><strong>Hỗ trợ JobFind</strong><small>Trợ lý AI · Trả lời tự động</small></div>
                        </div>
                        <div className="jf-support__tools">
                            <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Thu nhỏ chatbot' : 'Mở rộng chatbot'} title={expanded ? 'Thu nhỏ' : 'Mở rộng'}>{expanded ? '↙' : '↗'}</button>
                            <button type="button" onClick={startNewChat} aria-label="Cuộc trò chuyện mới" title="Cuộc trò chuyện mới"><Icon name="plus"/></button>
                            <button type="button" onClick={() => { cancelRequest(); setView(view === 'history' ? 'chat' : 'history'); setError(''); }} aria-label="Lịch sử trò chuyện" title="Lịch sử"><Icon name="history"/></button>
                            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng chatbot" title="Đóng"><Icon name="close"/></button>
                        </div>
                    </div>
                    {view === 'history' ? (
                        <div className="jf-support__history">
                            <div className="jf-support__history-heading">
                                <button type="button" onClick={() => setView('chat')} aria-label="Quay lại"><Icon name="back"/></button>
                                <h2>Lịch sử trong phiên này</h2>
                            </div>
                            <p>Chỉ lưu trên trình duyệt của bạn trong phiên hiện tại.</p>
                            {store.threads.map((item) => (
                                <div className="jf-support__thread" key={item.id}>
                                    <button type="button" className="jf-support__thread-open" onClick={() => { runtime.thread.composer.setText(''); setEditing(null); setStore((current) => ({ ...current, activeId: item.id })); setView('chat'); setError(''); }}>
                                        <span>{item.title}</span>
                                        <small>{new Date(item.createdAt).toLocaleString('vi-VN')}</small>
                                    </button>
                                    <button type="button" className="jf-support__thread-delete" title="Xóa cuộc trò chuyện" aria-label={`Xóa ${item.title}`} onClick={() => setStore((current) => deleteSupportThread(current, item.id))}><Icon name="trash" size={18}/></button>
                                </div>
                            ))}
                            <button className="jf-support__history-new" type="button" onClick={startNewChat}><Icon name="plus" size={16}/> Cuộc trò chuyện mới</button>
                        </div>
                    ) : (
                        <>
                            {!user?.id && <div className="jf-support__login">Đăng nhập để sử dụng các chức năng cá nhân của JobFind. <Link to="/login" onClick={() => setOpen(false)}>Đăng nhập</Link></div>}
                            <ThreadPrimitive.Viewport className="jf-support__messages" role="log" aria-live="polite" aria-label="Nội dung trò chuyện">
                                {!messages.length ? (
                                    <div className="jf-support__welcome">
                                        <div className="jf-support__welcome-icon"><Icon name="sparkles" size={30}/></div>
                                        <h2>Bạn cần hỗ trợ gì?</h2>
                                        <p>Hỏi về tìm việc, tạo CV và cách sử dụng JobFind.</p>
                                        <div className="jf-support__suggestions">
                                            {QUICK_QUESTIONS.map((question) => <button key={question} type="button" onClick={() => sendMessage(question)} disabled={busy}>{question}<span aria-hidden="true">↗</span></button>)}
                                        </div>
                                    </div>
                                ) : <ThreadPrimitive.Messages>{({ message }) => { const item = message.metadata.custom; const index = messages.findIndex((entry) => entry.id === message.id); return (
                                    <MessagePrimitive.Root className={`jf-support__message jf-support__message--${item.role}`}>
                                        {item.role === 'assistant' && <span className="jf-support__avatar" aria-hidden="true"><Icon name="sparkles" size={15}/></span>}
                                        <div className="jf-support__message-body">
                                            <div className="jf-support__bubble">{item.text ? (item.role === 'assistant' ? <SupportMarkdown text={item.text}/> : item.text) : (item.cards?.length ? 'Đang tổng hợp kết quả...' : <span className="jf-support__dots" aria-label="Đang trả lời"><i/><i/><i/></span>)}</div>
                                            {item.role === 'assistant' && item.cards?.length > 0 && <div className="jf-support__results" aria-label="Tin tuyển dụng từ JobFind">
                                                {item.cards.map((job) => <Link key={job.id} to={`/detail-job/${job.id}`} className="jf-support__result" onClick={() => setOpen(false)}>
                                                    <strong>{job.name}</strong><span>{job.company || 'Công ty tuyển dụng'}{job.location ? ` · ${job.location}` : ''}</span>
                                                    <small>{job.salary || 'Chưa công bố lương'}{job.workType ? ` · ${job.workType}` : ''} · Xem tin #{job.id} ↗</small>
                                                </Link>)}
                                            </div>}
                                            {item.status === 'cancelled'  && <small className="jf-support__interrupted">Đã dừng · câu trả lời chưa hoàn chỉnh</small>}
                                            {item.status === 'failed' && <small className="jf-support__interrupted">Phản hồi bị gián đoạn · cần thử lại</small>}
                                            {item.role === 'user' && !busy && <button className="jf-support__copy" type="button" onClick={() => setEditing({ id: item.id, text: item.text })}>Sửa câu hỏi</button>}
                                            {item.role === 'assistant' && !busy && <ActionBarPrimitive.Reload className="jf-support__copy">Tạo lại</ActionBarPrimitive.Reload>}
                                            {item.role === 'assistant' && item.text && item.status === 'complete' && <button className="jf-support__copy" type="button" onClick={() => copyAnswer(item.text, `${thread.id}-${index}`)}>{copiedId === `${thread.id}-${index}` ? 'Đã sao chép' : 'Sao chép'}</button>}
                                        </div>
                                    </MessagePrimitive.Root>
                                ); }}</ThreadPrimitive.Messages>}
                            </ThreadPrimitive.Viewport>
                            <ThreadPrimitive.ScrollToBottom className="jf-support__scroll" aria-label="Đến tin nhắn mới nhất">↓ Tin mới nhất</ThreadPrimitive.ScrollToBottom>
                            {error && <div className="jf-support__error" role="alert">{error}<button type="button" onClick={retryLast} disabled={busy}><Icon name="retry" size={15}/> Thử lại</button></div>}
                            <div className="jf-support__compose-area">
                                {editing && <form className="jf-support__edit" onSubmit={(event) => {
                                    event.preventDefault();
                                    const index = messages.findIndex((item) => item.id === editing.id);
                                    if (index >= 0) sendMessage(editing.text, false, messages.slice(0, index));
                                }}>
                                    <label htmlFor="jf-support-edit">Sửa câu hỏi và tạo câu trả lời mới</label>
                                    <textarea id="jf-support-edit" value={editing.text} maxLength={1400} onChange={(event) => setEditing({ ...editing, text: event.target.value })}/>
                                    <button type="submit" disabled={!editing.text.trim() || busy}>Gửi lại</button>
                                    <button type="button" onClick={() => setEditing(null)}>Hủy</button>
                                </form>}
                                <ComposerPrimitive.Root className="jf-support__composer">
                                    <label htmlFor="jf-support-input" className="jf-support__sr-only">Nhập câu hỏi cho trợ lý</label>
                                    <ComposerPrimitive.Input id="jf-support-input" ref={inputRef} rows={1} maxLength={1400}
                                        placeholder="Đặt câu hỏi hỗ trợ..." aria-label="Đặt câu hỏi hỗ trợ"/>
                                    <button type="button" className={`jf-support__mic${listening ? ' jf-support__mic--active' : ''}`}
                                        onClick={startSpeech} disabled={busy || !(window.SpeechRecognition || window.webkitSpeechRecognition)}
                                        aria-label={listening ? 'Dừng nhập giọng nói' : 'Nhập bằng giọng nói'}
                                        title={(window.SpeechRecognition || window.webkitSpeechRecognition) ? 'Nhập giọng nói (trình duyệt có thể xử lý âm thanh)' : 'Trình duyệt chưa hỗ trợ nhập giọng nói'}>
                                        <Icon name="mic" size={17}/>
                                    </button>
                                    {busy ? <ComposerPrimitive.Cancel className="jf-support__send" aria-label="Dừng trả lời" title="Dừng trả lời"><Icon name="stop" size={18}/></ComposerPrimitive.Cancel>
                                        : <ComposerPrimitive.Send className="jf-support__send" aria-label="Gửi tin nhắn" title="Gửi"><Icon name="send" size={18}/></ComposerPrimitive.Send>}
                                </ComposerPrimitive.Root>
                                <p>AI có thể mắc lỗi. Kết quả tuyển dụng đọc từ JobFind. Không nhập CV hoặc thông tin riêng tư. <Link to="/contact" onClick={() => setOpen(false)}>Liên hệ</Link></p>
                            </div>
                        </>
                    )}
                </ThreadPrimitive.Root>
            ) : (
                <button type="button" className="jf-support__launcher" aria-label="Mở chatbot hỗ trợ JobFind" onClick={() => setOpen(true)}>
                    <Icon name="chat" size={25}/><span>Hỗ trợ</span>
                </button>
            )}
        </div>
        </AssistantRuntimeProvider>
    );
};

export default SupportChat;
