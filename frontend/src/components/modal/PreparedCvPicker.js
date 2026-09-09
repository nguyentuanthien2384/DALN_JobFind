import React, { useEffect, useRef, useState } from 'react';
import { listMyCvs } from '../../service/aiSearchService';
import { validateCvList } from '../../service/candidateWorkspace';

export default function PreparedCvPicker({ token, disabled, onPrepared }) {
    const [cvs, setCvs] = useState([]), [selected, setSelected] = useState('');
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
    const [error, setError] = useState(''), [preview, setPreview] = useState(null), [refresh, setRefresh] = useState(0);
    const generation = useRef(0), preparing = useRef(false);
    useEffect(() => {
        let active = true;
        setLoading(true); setCvs([]); setSelected(''); setPreview(null); setError(''); onPrepared(null);
        const version = ++generation.current;
        (async () => {
            try {
                const rows = validateCvList(await listMyCvs());
                if (active && localStorage.getItem('token_user') === token && version === generation.current) setCvs(rows);
            } catch (failure) { if (active) setError(failure.message || 'Không tải được CV đã chuẩn bị.'); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; generation.current += 1; };
    }, [token, refresh, onPrepared]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

    const prepare = async () => {
        if (disabled || preparing.current || !selected || localStorage.getItem('token_user') !== token) return;
        const cv = cvs.find(row => row._id === selected);
        if (!cv) return;
        preparing.current = true; setBusy(true); setError(''); setPreview(null); onPrepared(null);
        const version = ++generation.current;
        try {
            const { renderPreparedCv } = await import('../../service/preparedCvPdf');
            const result = await renderPreparedCv(cv);
            if (version !== generation.current || localStorage.getItem('token_user') !== token) return;
            setPreview({ url: URL.createObjectURL(result.blob), title: cv.title, pages: result.pages });
            onPrepared({ file: result.file, title: cv.title, cvId: cv._id });
        } catch (failure) {
            if (version === generation.current) setError(failure.message || 'Không tạo được PDF. Hãy thử lại.');
        } finally {
            preparing.current = false;
            if (version === generation.current) setBusy(false);
        }
    };

    return <section className="prepared-cv-picker" aria-label="Chọn CV đã chuẩn bị">
        <p>Chọn bản đã lưu tại CV và trợ lý AI. Bản PDF sẽ giữ nội dung tại lúc bạn tạo bản xem lại.</p>
        <button type="button" disabled={disabled || loading || busy} onClick={() => setRefresh(value => value + 1)}>Tải lại CV đã chuẩn bị</button>
        {loading && <p role="status">Đang tải CV đã chuẩn bị…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && cvs.length === 0 && <p>Bạn chưa có CV đã lưu. Hãy lưu CV trong mục CV và trợ lý AI trước khi chọn tại đây.</p>}
        <label>CV đã lưu<select aria-label="CV đã lưu" value={selected} disabled={disabled || loading || busy} onChange={event => {
            generation.current += 1; setSelected(event.target.value); setPreview(null); setError(''); onPrepared(null);
        }}><option value="">Chọn một CV</option>{cvs.map(cv => <option key={cv._id} value={cv._id}>{cv.title || 'CV chưa đặt tên'}</option>)}</select></label>
        <button type="button" disabled={disabled || loading || busy || !selected} onClick={prepare}>{busy ? 'Đang tạo PDF…' : 'Tạo bản PDF để xem lại'}</button>
        {preview && <div className="prepared-cv-preview">
            <p><strong>{preview.title || 'CV ứng tuyển'}</strong> · {preview.pages} trang</p>
            <a href={preview.url} target="_blank" rel="noreferrer">Mở bản PDF sẽ gửi</a>{' · '}
            <a href={preview.url} download="CV-ung-tuyen.pdf">Tải bản PDF</a>
            <p className="prepared-cv-mobile-note">Mở bản PDF để xem đầy đủ nội dung trước khi chọn gửi.</p>
            <iframe title="Bản PDF sẽ gửi" src={preview.url} />
        </div>}
    </section>;
}
