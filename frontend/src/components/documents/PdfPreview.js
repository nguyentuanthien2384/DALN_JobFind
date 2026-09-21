import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { boundedPdfPageSize } from './pdfPageSize';
import './PdfPreview.css';

const assetBase = `${process.env.PUBLIC_URL || ''}/pdfjs/${pdfjs.version}/`;
pdfjs.GlobalWorkerOptions.workerSrc = `${assetBase}pdf.worker.min.mjs`;
const options = { isEvalSupported: false, cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`, maxImageSize: 16000000 };

const SafePage = ({ pdf, page, requestedWidth, onError }) => {
    const [dimensions, setDimensions] = useState(null);
    useEffect(() => {
        let active = true;
        pdf.getPage(page).then(value => {
            if (active) setDimensions({ pdf, page, viewport: value.getViewport({ scale: 1 }) });
        }).catch(() => { if (active) onError(); });
        return () => { active = false; };
    }, [pdf, page, onError]);
    if (dimensions?.pdf !== pdf || dimensions.page !== page) return <p role="status" className="chat-pdf-status">Đang đọc trang…</p>;
    let size;
    try { size = boundedPdfPageSize(dimensions.viewport, requestedWidth, window.devicePixelRatio || 1); }
    catch { return <p role="alert" className="chat-pdf-status">Trang PDF có kích thước không được hỗ trợ. Bạn có thể tải bản gốc để đọc.</p>; }
    return <>
        {size.constrained && <p className="chat-pdf-size-note">Trang lớn được thu nhỏ để hiển thị ổn định.</p>}
        <Page pageNumber={page} width={size.width} devicePixelRatio={size.devicePixelRatio}
            renderAnnotationLayer={false} renderTextLayer onRenderError={onError}
            loading={<p role="status" className="chat-pdf-status">Đang hiển thị trang…</p>} />
    </>;
};

const PdfPreview = ({ file, fileName = 'Tài liệu.pdf', onClose, maxPages = 300 }) => {
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [error, setError] = useState('');
    const [width, setWidth] = useState(Math.min(window.innerWidth - 80, 720));
    const [url, setUrl] = useState('');
    const [document, setDocument] = useState(null);
    const viewport = useRef(null);
    const source = useMemo(() => file || null, [file]);
    useEffect(() => {
        setPage(1); setPages(0); setError(''); setZoom(1); setDocument(null);
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
    const fail = React.useCallback(() => setError('Không đọc được PDF này. Tệp có thể bị hỏng hoặc không được hỗ trợ.'), []);
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
                onLoadSuccess={pdf => { if (pdf.numPages > maxPages) setError(`PDF vượt quá giới hạn xem trước ${maxPages} trang. Bạn có thể tải bản gốc để đọc.`); else { setPages(pdf.numPages); setDocument({ file, pdf }); } }}
                onLoadError={fail} onSourceError={fail} onPassword={() => setError('PDF có mật khẩu. Vui lòng dùng bản PDF không có mật khẩu.')}
                loading={<p role="status" className="chat-pdf-status">Đang đọc PDF…</p>} error={<p role="alert">Không đọc được PDF.</p>}>
                {document?.file === file && <SafePage pdf={document.pdf} page={page} requestedWidth={width * zoom} onError={fail} />}
            </Document>}
        </div>
    </Modal></span>;
};

export default PdfPreview;
