import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { chatPdfBlob, getChatPdf } from '../../service/chatMediaService';
import ChatDocumentPreview from './ChatDocumentPreview';

jest.mock('antd', () => {
    const React = require('react');
    return { Modal: ({ open, title, onCancel, children }) => open ?
        <div role="dialog" aria-label={title}><button type="button" onClick={onCancel}>Đóng cửa sổ</button>{children}</div> : null };
});
jest.mock('../../service/chatMediaService', () => ({ chatPdfBlob: jest.fn(), getChatPdf: jest.fn() }));
jest.mock('../documents/PdfPreview', () => ({
    __esModule: true,
    default: ({ file, fileName, maxPages, onClose }) => {
        if (file.failRender) throw new Error('PDF renderer failed');
        return <div role="region" aria-label="Nội dung PDF" data-filename={fileName}
            data-size={file.size} data-max-pages={maxPages}>
            <button type="button" onClick={onClose}>Đóng PDF</button>
        </div>;
    }
}));

const attachment = (id = 'document-1', name = 'CV.pdf') => ({ id, name });
const response = (id = 'document-1', name = 'CV.pdf') => ({
    errCode: 0, data: { id, name, mimeType: 'application/pdf', size: 8, fileBase64: 'JVBERi0=' }
});
const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

beforeEach(() => {
    jest.resetAllMocks();
    localStorage.clear();
    localStorage.setItem('token_user', 'session-1');
    localStorage.setItem('userData', JSON.stringify({ id: 7, roleCode: 'CANDIDATE' }));
    chatPdfBlob.mockReturnValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
});
afterEach(() => jest.restoreAllMocks());

test('loads only the requested document and gives the preview its server filename and page limit', async () => {
    const pending = deferred();
    getChatPdf.mockReturnValue(pending.promise);
    const onClose = jest.fn();
    render(<ChatDocumentPreview attachment={attachment()} onClose={onClose} />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải tài liệu PDF');
    expect(getChatPdf).toHaveBeenCalledTimes(1);
    expect(getChatPdf).toHaveBeenCalledWith('document-1', expect.any(AbortSignal));
    expect(chatPdfBlob).not.toHaveBeenCalled();
    await act(async () => pending.resolve(response('document-1', 'CV đã gửi.pdf')));
    const preview = await screen.findByRole('region', { name: 'Nội dung PDF' });
    expect(preview).toHaveAttribute('data-filename', 'CV đã gửi.pdf');
    expect(preview).toHaveAttribute('data-size', '8');
    expect(preview).toHaveAttribute('data-max-pages', '100');
    expect(chatPdfBlob).toHaveBeenCalledWith(response('document-1', 'CV đã gửi.pdf').data);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng PDF' }));
    expect(onClose).toHaveBeenCalledTimes(1);
});

test('an access error stays visible and an explicit retry can load the same document', async () => {
    getChatPdf.mockResolvedValueOnce({ errCode: 1, errMessage: 'Không có quyền xem PDF' })
        .mockResolvedValueOnce(response());
    render(<ChatDocumentPreview attachment={attachment()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền xem PDF');
    expect(screen.queryByRole('region', { name: 'Nội dung PDF' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại PDF' }));
    expect(await screen.findByRole('region', { name: 'Nội dung PDF' })).toBeInTheDocument();
    expect(getChatPdf).toHaveBeenCalledTimes(2);
});

test('rejects a mismatched response ID and malformed PDF bytes without rendering either', async () => {
    getChatPdf.mockResolvedValueOnce(response('someone-else'))
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response());
    chatPdfBlob.mockImplementationOnce(() => { throw new Error('Tài liệu trả về không hợp lệ.'); });
    render(<ChatDocumentPreview attachment={attachment()} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tài liệu trả về không đúng yêu cầu');
    expect(chatPdfBlob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tài liệu trả về không hợp lệ.');
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại PDF' }));
    expect(await screen.findByRole('region', { name: 'Nội dung PDF' })).toBeInTheDocument();
});

test('changing attachment cancels the old request and never shows its late PDF', async () => {
    const old = deferred();
    const next = deferred();
    getChatPdf.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const view = render(<ChatDocumentPreview attachment={attachment('old', 'Old.pdf')} onClose={jest.fn()} />);
    const oldSignal = getChatPdf.mock.calls[0][1];
    view.rerender(<ChatDocumentPreview attachment={attachment('new', 'New.pdf')} onClose={jest.fn()} />);
    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('New.pdf');
    await act(async () => next.resolve(response('new', 'New.pdf')));
    expect(await screen.findByRole('region', { name: 'Nội dung PDF' })).toHaveAttribute('data-filename', 'New.pdf');
    await act(async () => old.resolve(response('old', 'Old.pdf')));
    expect(screen.getByRole('region', { name: 'Nội dung PDF' })).toHaveAttribute('data-filename', 'New.pdf');
    expect(chatPdfBlob).toHaveBeenCalledTimes(1);
});

test.each(['jobfind:session-ended', 'storage'])('ending the session with %s cancels loading and hides sensitive content', async eventName => {
    const pending = deferred();
    getChatPdf.mockReturnValue(pending.promise);
    render(<ChatDocumentPreview attachment={attachment()} onClose={jest.fn()} />);
    const signal = getChatPdf.mock.calls[0][1];
    act(() => {
        if (eventName === 'storage') localStorage.setItem('token_user', 'session-2');
        window.dispatchEvent(eventName === 'storage'
            ? new StorageEvent('storage', { key: 'token_user' }) : new Event(eventName));
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => pending.resolve(response()));
    expect(chatPdfBlob).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Nội dung PDF' })).not.toBeInTheDocument();
});

test('same-account profile refresh leaves an opened PDF visible', async () => {
    getChatPdf.mockResolvedValue(response());
    render(<ChatDocumentPreview attachment={attachment()} onClose={jest.fn()} />);
    await screen.findByRole('region', { name: 'Nội dung PDF' });
    act(() => {
        localStorage.setItem('userData', JSON.stringify({ id: 7, roleCode: 'CANDIDATE', firstName: 'Changed' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'userData' }));
    });
    expect(screen.getByRole('region', { name: 'Nội dung PDF' })).toBeInTheDocument();
    expect(getChatPdf).toHaveBeenCalledTimes(1);
});

test('invalid session data never requests a private document', () => {
    localStorage.setItem('userData', '{bad json');
    render(<ChatDocumentPreview attachment={attachment()} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getChatPdf).not.toHaveBeenCalled();
});

test('a PDF renderer failure stays inside a recoverable modal', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    chatPdfBlob.mockReturnValue({ failRender: true });
    getChatPdf.mockResolvedValue(response());
    const onClose = jest.fn();
    render(<ChatDocumentPreview attachment={attachment()} onClose={onClose} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng đóng và thử lại');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
});
