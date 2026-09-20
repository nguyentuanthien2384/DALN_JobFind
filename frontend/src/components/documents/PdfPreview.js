import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import './PdfPreview.css';

const assetBase = `${process.env.PUBLIC_URL || ''}/pdfjs/${pdfjs.version}/`;
pdfjs.GlobalWorkerOptions.workerSrc = `${assetBase}pdf.worker.min.mjs`;
const options = { isEvalSupported: false, cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`, maxImageSize: 16000000 };

const PdfPreview = ({ file, fileName = 'Tài liệu.pdf', onClose, maxPages = 300 }) => {
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [error, setError] = useState('');
    const [width, setWidth] = useState(Math.min(window.innerWidth - 80, 720));
    const [url, setUrl] = useState('');
    const viewport = useRef(null);
    const source = useMemo(() => file || null, [file]);
    useEffect(() => {
        setPage(1); setPages(0); setError(''); setZoom(1);
        if (!file) return;
        const value = URL.createObjectURL(file);
        setUrl(value);
        return () => URL.revokeObjectURL(value);
    }, [file]);
    useEffect(() => {
        const resize = () => setWidth(Math.max(200, Math.min((viewport.current?.clientWidth || window.innerWidth - 48) - 28, 780)));
        resize();
        window.addEventListener('resize', resize);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
        if (viewport.current) observer?.observe(viewport.current);
        return () => { window.removeEventListener('resize', resize); observer?.disconnect(); };
    }, []);
    const fail = () => setError('Không đọc được PDF này. Tệp có thể bị hỏng hoặc không được hỗ trợ.');
    return <span onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
        <Modal open title={fileName} onCancel={onClose} footer={null} width="min(1000px, 96vw)" className="chat-pdf-modal"
        centered keyboard maskClosable={false} zIndex={1200}>
        <div className="chat-pdf-toolbar">
            <div><button type="button" aria-label="Trang PDF trước" disabled={page <= 1 || !pages} onClick={() => setPage(value => value - 1)}>‹</button>
                <span aria-live="polite">Trang {page} / {pages || '…'}</span>
                <button type="button" aria-label="Trang PDF sau" disabled={page >= pages || !pages} onClick={() => setPage(value => value + 1)}>›</button></div>
            <div><button type="button" aria-label="Thu nhỏ PDF" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}>−</button>
                <span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Phóng to PDF" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}>+</button>
                <button type="button" onClick={() => setZoom(1)}>Vừa khung</button></div>
            {url && <a href={url} download={fileName}>Tải PDF</a>}
        </div>
        <div ref={viewport} className="chat-pdf-viewport">
            {error ? <p role="alert" className="chat-pdf-status">{error}</p> : <Document file={source} options={options}
                onLoadSuccess={({ numPages }) => { if (numPages > maxPages) setError(`PDF vượt quá giới hạn xem trước ${maxPages} trang. Bạn có thể tải bản gốc để đọc.`); else setPages(numPages); }}
                onLoadError={fail} onSourceError={fail} onPassword={() => setError('PDF có mật khẩu. Vui lòng dùng bản PDF không có mật khẩu.')}
                loading={<p role="status" className="chat-pdf-status">Đang đọc PDF…</p>} error={<p role="alert">Không đọc được PDF.</p>}>
                <Page pageNumber={page} width={width} scale={zoom} devicePixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
                    renderAnnotationLayer={false} renderTextLayer onRenderError={fail}
                    loading={<p role="status" className="chat-pdf-status">Đang hiển thị trang…</p>} />
            </Document>}
        </div>
    </Modal></span>;
};

export default PdfPreview;
