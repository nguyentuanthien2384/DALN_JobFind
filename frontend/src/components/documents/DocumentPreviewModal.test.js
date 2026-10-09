import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DocumentPreviewModal from './DocumentPreviewModal';
import { resolvePdfSource } from './documentSource';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';

jest.mock('./documentSource', () => ({ ...jest.requireActual('./documentSource'), resolvePdfSource: jest.fn() }));
jest.mock('./PdfPreview', () => ({ __esModule: true, default: ({ file, fileName }) =>
    <div role="dialog" aria-label={fileName}>PDF size {file.size}</div> }));
jest.mock('antd', () => ({ Modal: ({ title, children, onCancel }) =>
    <div role="dialog" aria-label={title}><button type="button" onClick={onCancel}>Đóng</button>{children}</div> }));

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

beforeEach(() => {
    jest.useFakeTimers();
    resolvePdfSource.mockReset();
    localStorage.clear();
    localStorage.setItem('token_user', 'preview-owner');
    localStorage.setItem('userData', JSON.stringify({ id: 1, roleCode: 'CANDIDATE' }));
});
afterEach(() => { jest.useRealTimers(); });

test('aborts a slow PDF read, explains the timeout and retries with a fresh request', async () => {
    resolvePdfSource.mockImplementationOnce((_source, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })).mockResolvedValueOnce(new Blob(['current']));
    const view = render(<DocumentPreviewModal source="/cv.pdf" fileName="CV.pdf" onClose={jest.fn()} />);
    const firstSignal = resolvePdfSource.mock.calls[0][1].signal;
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải tài liệu PDF');
    await act(async () => { jest.advanceTimersByTime(29999); await flush(); });
    expect(firstSignal.aborted).toBe(false);
    await act(async () => { jest.advanceTimersByTime(1); await flush(); });
    expect(firstSignal.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Tải tài liệu quá lâu. Vui lòng thử lại.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại PDF' })); await flush(); });
    expect(resolvePdfSource).toHaveBeenCalledTimes(2);
    expect(resolvePdfSource.mock.calls[1][1].signal).not.toBe(firstSignal);
    expect(screen.getByRole('dialog', { name: 'CV.pdf' })).toHaveTextContent('PDF size 7');
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
});

test('does not replace the selected document with an earlier read that completes out of order', async () => {
    const old = deferred();
    resolvePdfSource.mockReturnValueOnce(old.promise).mockResolvedValueOnce(new Blob(['new']));
    const view = render(<DocumentPreviewModal source="/first.pdf" fileName="First.pdf" onClose={jest.fn()} />);
    const firstSignal = resolvePdfSource.mock.calls[0][1].signal;
    view.rerender(<DocumentPreviewModal source="/second.pdf" fileName="Second.pdf" onClose={jest.fn()} />);
    await act(flush);
    expect(firstSignal.aborted).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Second.pdf' })).toHaveTextContent('PDF size 3');
    await act(async () => { old.resolve(new Blob(['private previous document'])); await flush(); });
    expect(screen.getByRole('dialog', { name: 'Second.pdf' })).toHaveTextContent('PDF size 3');
    expect(screen.queryByRole('dialog', { name: 'First.pdf' })).not.toBeInTheDocument();
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
});

test('a late private document cannot reopen a preview after the session has ended', async () => {
    const pending = deferred();
    resolvePdfSource.mockReturnValueOnce(pending.promise);
    const view = render(<DocumentPreviewModal source="/private.pdf" onClose={jest.fn()} />);
    const signal = resolvePdfSource.mock.calls[0][1].signal;
    act(() => window.dispatchEvent(new Event(SESSION_ENDED_EVENT)));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { pending.resolve(new Blob(['private'])); await flush(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(resolvePdfSource).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
});

test('closing a pending preview aborts its read and clears the deadline', async () => {
    resolvePdfSource.mockReturnValueOnce(new Promise(() => {}));
    const onClose = jest.fn();
    const view = render(<DocumentPreviewModal source="/cv.pdf" onClose={onClose} />);
    const signal = resolvePdfSource.mock.calls[0][1].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
});
