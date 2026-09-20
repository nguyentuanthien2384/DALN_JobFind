import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { chatPdfBlob, getChatPdf } from '../../service/chatMediaService';

const PdfPreview = lazy(() => import('./PdfPreview'));

class PreviewBoundary extends React.Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        return this.state.failed ? <Modal open title="Không mở được trình xem PDF" footer={null} onCancel={this.props.onClose}>
            <p role="alert">Vui lòng đóng và thử lại. Nếu vừa cập nhật ứng dụng, hãy tải lại trang.</p>
        </Modal> : this.props.children;
    }
}

const ChatDocumentPreview = ({ attachment, onClose }) => {
    const [file, setFile] = useState(null);
    const [name, setName] = useState(attachment.name || 'Tài liệu.pdf');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true;
        setFile(null); setError('');
        (async () => {
            try {
                const response = await getChatPdf(attachment.id);
                if (!active) return;
                if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Không tải được tài liệu.');
                if (response.data?.id !== attachment.id) throw new Error('Tài liệu trả về không đúng yêu cầu.');
                setFile(chatPdfBlob(response.data)); setName(response.data.name);
            } catch (failure) { if (active) setError(failure.message || 'Không tải được tài liệu.'); }
        })();
        return () => { active = false; };
    }, [attachment.id, retry]);
    const loading = <Modal open title={name} footer={null} onCancel={onClose}>
        {error ? <><p role="alert">{error}</p><button className="chat-media-action" type="button" onClick={() => setRetry(value => value + 1)}>Thử tải lại PDF</button></>
            : <p role="status">Đang tải tài liệu PDF…</p>}
    </Modal>;
    return file ? <PreviewBoundary onClose={onClose}><Suspense fallback={loading}>
        <PdfPreview file={file} fileName={name} onClose={onClose} />
    </Suspense></PreviewBoundary> : loading;
};

export default ChatDocumentPreview;
