import React, { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { getChatJobs, readChatPdf, uploadChatPdf } from '../../service/chatMediaService';
import { ChatJobCard } from './ChatMessageContent';
import useListQuery, { clampListPage } from '../../util/useListQuery';
import StableList from '../common/StableList';

const JobPicker = ({ partnerId, onSelect, onClose }) => {
    const [{ search, page }, setQuery] = useListQuery({ search: '', page: 0 }, { prefix: 'sharedJob.' });
    const [result, setResult] = useState({ data: [], count: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [settledRequest, setSettledRequest] = useState('');
    const requestKey = JSON.stringify([partnerId, search, page, retry]);
    const busy = loading || settledRequest !== requestKey;
    useEffect(() => {
        let active = true;
        setLoading(true); setError('');
        const timer = setTimeout(async () => {
            try {
                const response = await getChatJobs({ partnerId: Number(partnerId), search, limit: 10, offset: page * 10 });
                if (!active) return;
                if (response?.errCode !== 0 || !Array.isArray(response.data)) throw new Error(response?.errMessage || 'Không tải được tin tuyển dụng.');
                const validPage = clampListPage(page, response.count, 10);
                if (validPage !== page) { setQuery({ page: validPage }, { replace: true }); return; }
                setResult(response);
            } catch (failure) { if (active) { setResult({ data: [], count: 0 }); setError(failure.message || 'Không tải được tin tuyển dụng.'); } }
            finally { if (active) { setLoading(false); setSettledRequest(requestKey); } }
        }, 250);
        return () => { active = false; clearTimeout(timer); };
    }, [partnerId, search, page, retry, requestKey, setQuery]);
    return <Modal open title="Chia sẻ công việc" footer={null} onCancel={onClose} width={700}>
        <div className="chat-job-picker">
            <p>Chọn tin đang tuyển của công ty trong cuộc trò chuyện. Bạn sẽ xem lại trước khi gửi.</p>
            <label htmlFor="chat-job-search">Tìm theo tên công việc</label>
            <input id="chat-job-search" type="search" value={search} maxLength={120} placeholder="Ví dụ: Frontend Developer"
                onChange={event => setQuery({ search: event.target.value, page: 0 }, { replace: true })} />
            <StableList busy={busy} resetKey={JSON.stringify([partnerId, search])} label="Đang tải tin tuyển dụng…">
            {!busy && error && <div role="alert"><p>{error}</p><button className="chat-media-action" type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>}
            {!busy && !error && !result.data.length && <p>Chưa có tin đang tuyển phù hợp. Thử thay đổi từ khóa tìm kiếm.</p>}
            {!error && result.data.map(job => <article className="chat-job-option" key={job.id}>
                <ChatJobCard job={job} draft />
                <button type="button" className="chat-media-primary" onClick={() => onSelect(job)}>Chọn công việc này</button>
            </article>)}
            </StableList>
            {!error && result.count > 10 && <div className="chat-job-pages">
                <button type="button" className="chat-media-action" disabled={page === 0} onClick={() => setQuery({ page: page - 1 })}>Trang trước</button>
                <span>Trang {page + 1} / {Math.ceil(result.count / 10)}</span>
                <button type="button" className="chat-media-action" disabled={(page + 1) * 10 >= result.count} onClick={() => setQuery({ page: page + 1 })}>Trang sau</button>
            </div>}
        </div>
    </Modal>;
};

const ChatShareTools = ({ partnerId, disabled, onSelect, onBusy }) => {
    const inputRef = useRef(null);
    const active = useRef(true);
    const busy = useRef(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [{ open: showJobs }, setPickerQuery] = useListQuery({ open: false }, { prefix: 'sharedJob.' });
    const setShowJobs = open => setPickerQuery({ open });
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const chooseFile = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || disabled || busy.current) return;
        busy.current = true; setUploading(true); setError(''); onBusy(true);
        try {
            const payload = await readChatPdf(file);
            if (!active.current) return;
            const response = await uploadChatPdf({ receiverId: Number(partnerId), ...payload });
            if (!active.current) return;
            if (response?.errCode !== 0 || !response.data?.id) throw new Error(response?.errMessage || 'Không tải được PDF. Vui lòng thử lại.');
            onSelect({ attachment: response.data });
        } catch (failure) { if (active.current) setError(failure.message || 'Không tải được PDF. Vui lòng thử lại.'); }
        finally { busy.current = false; if (active.current) { setUploading(false); onBusy(false); } }
    };
    return <div className="chat-share-tools">
        <div className="chat-share-toolbar">
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" aria-label="Chọn CV hoặc tài liệu PDF" hidden onChange={chooseFile} />
            <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
                <i className="fas fa-paperclip" aria-hidden="true" /> {uploading ? 'Đang tải PDF…' : 'Đính kèm CV/PDF'}</button>
            <button type="button" disabled={disabled || uploading} onClick={() => { setError(''); setShowJobs(true); }}>
                <i className="fas fa-briefcase" aria-hidden="true" /> Chia sẻ công việc</button>
            <span>PDF · tối đa 5 MB / 100 trang</span>
        </div>
        {uploading && <p role="status" className="chat-media-status">Đang kiểm tra và tải tài liệu. Chưa gửi cho người nhận.</p>}
        {error && <p role="alert" className="chat-media-error">{error}</p>}
        {showJobs && <JobPicker partnerId={partnerId} onClose={() => setShowJobs(false)} onSelect={job => {
            onSelect({ job }); setShowJobs(false);
        }} />}
    </div>;
};

export default ChatShareTools;
