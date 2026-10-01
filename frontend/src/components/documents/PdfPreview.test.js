import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfPreview from './PdfPreview';

// react-pdf needs a real PDF.js worker; the mock hands the test control over the
// document lifecycle callbacks the preview reacts to.
let mockLoad;
jest.mock('react-pdf', () => {
    const React = require('react');
    return {
        pdfjs: { version: '9.9.9', GlobalWorkerOptions: {} },
        Document: ({ file, options, onLoadSuccess, onLoadError, onSourceError, onPassword, children }) => {
            // Like PDF.js, report the outcome asynchronously, after the preview reset its state for this file.
            React.useEffect(() => {
                if (!file) return undefined;
                let active = true;
                Promise.resolve().then(() => active && mockLoad?.({ file, options, onLoadSuccess, onLoadError, onSourceError, onPassword }));
                return () => { active = false; };
            }, [file]);
            return <div data-testid="pdf-document">{children}</div>;
        },
        Page: ({ pageNumber, width, devicePixelRatio, onRenderError }) => <div data-testid="pdf-page" data-page={pageNumber}
            data-width={Math.round(width)} data-dpr={devicePixelRatio}><button type="button" onClick={onRenderError}>render-error</button></div>
    };
});
jest.mock('antd', () => ({
    Modal: ({ open, title, onCancel, children }) => open
        ? <div role="dialog" aria-label={title}><button type="button" onClick={onCancel}>Đóng cửa sổ</button>{children}</div> : null
}));

const viewport = (width = 600, height = 800) => ({ getViewport: () => ({ width, height }) });
const pdfDocument = (numPages, page = async () => viewport()) => ({ numPages, getPage: jest.fn(page) });
const pdfFile = (name = 'cv.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' });
const loadWith = (pdf) => { mockLoad = ({ onLoadSuccess }) => onLoadSuccess(pdf); };

beforeEach(() => {
    mockLoad = undefined;
    URL.createObjectURL = jest.fn(() => 'blob:preview-1');
    URL.revokeObjectURL = jest.fn();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});

test('configures PDF.js from local assets with eval disabled', async () => {
    const { pdfjs } = require('react-pdf');
    let options;
    mockLoad = (props) => { options = props.options; };
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('/pdfjs/9.9.9/pdf.worker.min.mjs');
    await waitFor(() => expect(options).toBeDefined());
    expect(options).toMatchObject({ isEvalSupported: false, cMapUrl: '/pdfjs/9.9.9/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/pdfjs/9.9.9/standard_fonts/', wasmUrl: '/pdfjs/9.9.9/wasm/' });
});

test('shows the first page, pages through the document and offers the original for download', async () => {
    const pdf = pdfDocument(3);
    loadWith(pdf);
    render(<PdfPreview file={pdfFile()} fileName="CV ứng viên.pdf" onClose={jest.fn()} />);
    expect(screen.getByRole('dialog', { name: 'CV ứng viên.pdf' })).toBeInTheDocument();
    expect(await screen.findByTestId('pdf-page')).toHaveAttribute('data-page', '1');
    expect(screen.getByText('Trang 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tải PDF' })).toHaveAttribute('href', 'blob:preview-1');
    expect(screen.getByRole('link', { name: 'Tải PDF' })).toHaveAttribute('download', 'CV ứng viên.pdf');

    const previous = screen.getByRole('button', { name: 'Trang PDF trước' });
    const next = screen.getByRole('button', { name: 'Trang PDF sau' });
    expect(previous).toBeDisabled();
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '3'));
    expect(next).toBeDisabled();
    fireEvent.click(previous);
    await waitFor(() => expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2'));
    expect(pdf.getPage).toHaveBeenCalledWith(3);
});

test('zooms between 50% and 200% and resets to the frame width', async () => {
    loadWith(pdfDocument(1));
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    const page = await screen.findByTestId('pdf-page');
    const initial = Number(page.dataset.width);
    const zoomIn = screen.getByRole('button', { name: 'Phóng to PDF' });
    const zoomOut = screen.getByRole('button', { name: 'Thu nhỏ PDF' });
    for (let i = 0; i < 6; i += 1) fireEvent.click(zoomIn);
    expect(screen.getByText('200%')).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
    await waitFor(() => expect(Number(screen.getByTestId('pdf-page').dataset.width)).toBe(initial * 2));
    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung' }));
    for (let i = 0; i < 4; i += 1) fireEvent.click(zoomOut);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(zoomOut).toBeDisabled();
});

test('refuses documents over the page limit instead of rendering them', async () => {
    loadWith(pdfDocument(301));
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF vượt quá giới hạn xem trước 300 trang');
    expect(screen.queryByTestId('pdf-page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trang PDF sau' })).toBeDisabled();
});

test('honours a custom page limit', async () => {
    loadWith(pdfDocument(11));
    render(<PdfPreview file={pdfFile()} maxPages={10} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('giới hạn xem trước 10 trang');
});

test.each([
    ['load', 'onLoadError'],
    ['source', 'onSourceError']
])('explains a %s failure without crashing', async (_label, callback) => {
    mockLoad = (props) => props[callback](new Error('broken'));
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được PDF này');
});

test('asks for a PDF without a password', async () => {
    mockLoad = ({ onPassword }) => onPassword(jest.fn(), 1);
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF có mật khẩu');
});

test('reports a page that cannot be read or rendered', async () => {
    loadWith(pdfDocument(1, async () => { throw new Error('bad page'); }));
    const { unmount } = render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được PDF này');
    unmount();

    loadWith(pdfDocument(1));
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'render-error' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được PDF này');
});

test('rejects unsupported page sizes and notes when a huge page is scaled down', async () => {
    loadWith(pdfDocument(1, async () => viewport(0, 800)));
    const { unmount } = render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('kích thước không được hỗ trợ');
    unmount();

    loadWith(pdfDocument(1, async () => viewport(100, 100000)));
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByText('Trang lớn được thu nhỏ để hiển thị ổn định.')).toBeInTheDocument();
});

test('caps the device pixel ratio used for the canvas', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    loadWith(pdfDocument(1));
    render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByTestId('pdf-page')).toHaveAttribute('data-dpr', '2');
});

test('starts a new file on page one and revokes the previous object URL', async () => {
    loadWith(pdfDocument(3));
    URL.createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const { rerender } = render(<PdfPreview file={pdfFile('a.pdf')} onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trang PDF sau' }));
    await waitFor(() => expect(screen.getByText('Trang 2 / 3')).toBeInTheDocument());
    rerender(<PdfPreview file={pdfFile('b.pdf')} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Trang 1 / 3')).toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(screen.getByRole('link', { name: 'Tải PDF' })).toHaveAttribute('href', 'blob:second');
});

test('removes the download link once the file is cleared', async () => {
    loadWith(pdfDocument(1));
    const { rerender } = render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    expect(await screen.findByRole('link', { name: 'Tải PDF' })).toBeInTheDocument();
    rerender(<PdfPreview file={null} onClose={jest.fn()} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(screen.queryByRole('link', { name: 'Tải PDF' })).not.toBeInTheDocument();
});

test('closes from the dialog and keeps keyboard shortcuts inside the preview', async () => {
    const onClose = jest.fn();
    const outer = jest.fn();
    render(<div onKeyDown={outer}><PdfPreview file={pdfFile()} onClose={onClose} /></div>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(outer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
});

test('stops observing size changes when closed', () => {
    const disconnect = jest.spyOn(global.ResizeObserver.prototype, 'disconnect');
    const removeListener = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<PdfPreview file={pdfFile()} onClose={jest.fn()} />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    disconnect.mockRestore();
    removeListener.mockRestore();
});
