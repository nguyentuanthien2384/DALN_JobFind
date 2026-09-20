import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { pdfFileName, resolvePdfSource } from './documentSource';
import usePreviewSession from './usePreviewSession';
import './DocumentPreview.css';

const PdfPreview = lazy(() => import('./PdfPreview'));
class PreviewBoundary extends React.Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <Modal open zIndex={1200} title="Không mở được trình xem PDF" footer={null} onCancel={this.props.onClose}>
        <p role="alert">Vui lòng đóng và thử lại. Nếu ứng dụng vừa được cập nhật, hãy tải lại trang.</p>
    </Modal> : this.props.children; }
}

export default function DocumentPreviewModal({ source, fileName, onClose }) {
    const [state, setState] = useState(null), [retry, setRetry] = useState(0);
    const activeSession = usePreviewSession();
    const name = pdfFileName(fileName || source?.name);
    useEffect(() => {
        if (!activeSession) return undefined;
        const controller = new AbortController();
        let active = true, timedOut = false;
        setState({ source, loading: true });
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
        resolvePdfSource(source, { signal: controller.signal }).then(blob => {
            if (active) setState({ source, blob });
        }).catch(error => {
            if (active) setState({ source, error: timedOut ? 'Tải tài liệu quá lâu. Vui lòng thử lại.' : error.message || 'Không đọc được tài liệu.' });
        }).finally(() => clearTimeout(timeout));
        return () => { active = false; clearTimeout(timeout); controller.abort(); };
    }, [source, retry, activeSession]);
    if (!activeSession) return null;
    const current = state?.source === source ? state : null;
    const loading = <Modal open zIndex={1200} title={name} footer={null} onCancel={onClose} centered>
        {current?.error ? <div role="alert"><p>{current.error}</p><button type="button" className="document-preview-button" onClick={() => setRetry(value => value + 1)}>Thử tải lại PDF</button></div>
            : <p role="status">Đang tải tài liệu PDF…</p>}
    </Modal>;
    return <span onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
        {current?.blob ? <PreviewBoundary onClose={onClose}><Suspense fallback={loading}>
            <PdfPreview file={current.blob} fileName={name} onClose={onClose} />
        </Suspense></PreviewBoundary> : loading}
    </span>;
}
