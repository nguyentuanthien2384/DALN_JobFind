import React, { useEffect, useState } from 'react';
import DocumentPreviewModal from './DocumentPreviewModal';
import usePreviewSession from './usePreviewSession';
import './DocumentPreview.css';

export default function PdfPreviewButton({ source, fileName, label = 'Xem trước PDF', disabled = false, className = '' }) {
    const [opened, setOpened] = useState(null);
    const activeSession = usePreviewSession();
    useEffect(() => { setOpened(null); }, [source, fileName]);
    return <span className="document-preview-control">
        <button type="button" className={`document-preview-button ${className}`} disabled={disabled || !source || !activeSession}
            onClick={() => setOpened({ source, fileName })}>
            <svg width="17" height="18" viewBox="0 0 20 22" aria-hidden="true" fill="none"><path d="M4 1h8l5 5v15H4V1Z" stroke="currentColor" strokeWidth="1.4"/><path d="M12 1v6h5M7 11h7M7 15h7" stroke="currentColor" strokeWidth="1.4"/></svg>
            {label}
        </button>
        {opened && activeSession && opened.source === source && opened.fileName === fileName && <DocumentPreviewModal source={source}
            fileName={fileName} onClose={() => setOpened(null)} />}
    </span>;
}
