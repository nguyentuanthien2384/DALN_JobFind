import React, { useEffect, useRef, useState } from 'react';
import { chatAssistAi } from '../../service/aiSearchService';
import { requestAiDraft, aiErrorMessage, chatHistoryForAi } from '../../service/aiAssist';
import './ChatAiAssist.css';

// Tro ly AI trong chat ung vien - nha tuyen dung: goi y cau tra loi cho tin moi
// nhat cua doi phuong hoac viet lai ban nhap cho lich su. Chon goi y chi dien vao
// o soan tin; nguoi dung van tu bam Gui.
export default function ChatAiAssist({ messages, userId, draft, disabled, onUse }) {
    const [busy, setBusy] = useState(''), [error, setError] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const operation = useRef(null), mounted = useRef(true);
    const history = chatHistoryForAi(messages, userId);
    const canSuggest = history.length > 0 && history[history.length - 1].from === 'partner';
    const text = (draft || '').trim();

    // StrictMode mounts twice in development: re-arm on every mount.
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);

    const run = async (mode) => {
        if (operation.current) return;
        const controller = new AbortController();
        operation.current = controller;
        setBusy(mode); setError(''); setSuggestions([]);
        try {
            const result = await requestAiDraft(options => chatAssistAi(mode === 'suggest'
                ? { mode, messages: history }
                : { mode, draft: text.slice(0, 2000), messages: history.slice(-6) }, options), mode === 'suggest' ? 500 : 2000, { signal: controller.signal });
            if (mounted.current && !controller.signal.aborted) setSuggestions(result);
        } catch (failure) {
            if (mounted.current && !controller.signal.aborted) setError(aiErrorMessage(failure));
        } finally {
            if (operation.current === controller) operation.current = null;
            if (mounted.current && !controller.signal.aborted) setBusy('');
        }
    };
    const stop = () => { operation.current?.abort(); operation.current = null; setBusy(''); };
    const use = (value) => { onUse(value); setSuggestions([]); };

    return <div className="chat-ai" aria-label="Trợ lý AI soạn tin">
        <div className="chat-ai-row">
            <span className="chat-ai-badge" aria-hidden="true">AI</span>
            <button type="button" disabled={disabled || Boolean(busy) || !canSuggest} onClick={() => run('suggest')}
                title={canSuggest ? 'Gợi ý câu trả lời cho tin nhắn mới nhất' : 'Chưa có tin nhắn mới của đối phương'}>
                {busy === 'suggest' ? 'Đang gợi ý…' : 'Gợi ý trả lời'}</button>
            <button type="button" disabled={disabled || Boolean(busy) || !text} onClick={() => run('polish')}
                title={text ? 'Viết lại tin nhắn đang soạn cho rõ ràng, lịch sự' : 'Nhập tin nhắn để AI viết lại'}>
                {busy === 'polish' ? 'Đang viết lại…' : 'Viết lại lịch sự hơn'}</button>
            {busy && <button type="button" className="chat-ai-stop" onClick={stop}>Dừng</button>}
            <small>Khi bấm, các tin nhắn gần đây được gửi tới dịch vụ AI để gợi ý.</small>
        </div>
        {error && <p role="alert" className="chat-ai-error">{error}</p>}
        {suggestions.length > 0 && <div className="chat-ai-suggestions" aria-label="Gợi ý của AI">
            {suggestions.map((value, index) => <button type="button" key={index} disabled={disabled} onClick={() => use(value)}
                title="Điền vào ô soạn tin">{value}</button>)}
            <button type="button" className="chat-ai-dismiss" onClick={() => setSuggestions([])}>Bỏ qua gợi ý</button>
        </div>}
    </div>;
}
