import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfPreviewButton from './PdfPreviewButton';
import { resolvePdfSource } from './documentSource';

jest.mock('./documentSource', () => ({...jest.requireActual('./documentSource'),resolvePdfSource:jest.fn(),pdfFileName:name=>name || 'Tài liệu.pdf'}));
jest.mock('../../auth/sessionExpiry', () => ({SESSION_ENDED_EVENT:'jobfind:session-ended'}));
jest.mock('./PdfPreview', () => ({__esModule:true,default:({file,fileName,onClose})=><div role="dialog" aria-label={fileName} data-size={file.size}><button onClick={onClose}>Đóng PDF</button></div>}));

beforeEach(() => { localStorage.clear(); localStorage.setItem('token_user','owner'); localStorage.setItem('userData','{"id":1}'); resolvePdfSource.mockReset(); });

test('loads only when requested, displays original data and closes independently', async () => {
    const file=new Blob(['pdf']);resolvePdfSource.mockResolvedValue(file);
    render(<PdfPreviewButton source="exact-authorized-source" fileName="CV.pdf" label="Xem CV"/>);
    expect(resolvePdfSource).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Xem CV'}));
    await screen.findByRole('button',{name:'Đóng PDF'});
    expect(screen.getByRole('dialog',{name:'CV.pdf'})).toHaveAttribute('data-size','3');
    expect(resolvePdfSource).toHaveBeenCalledWith('exact-authorized-source',expect.objectContaining({signal:expect.anything()}));
    fireEvent.click(screen.getByRole('button',{name:'Đóng PDF'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('changing selected document aborts loading and cannot expose or reopen the previous file', async () => {
    let finish;resolvePdfSource.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const view=render(<PdfPreviewButton source="A" fileName="CV.pdf"/>);
    fireEvent.click(screen.getByRole('button',{name:'Xem trước PDF'}));
    const signal=resolvePdfSource.mock.calls[0][1].signal;
    view.rerender(<PdfPreviewButton source="B" fileName="CV.pdf"/>);expect(signal.aborted).toBe(true);
    await act(async()=>{finish(new Blob(['old']));});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(<PdfPreviewButton source="A" fileName="CV.pdf"/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.each(['jobfind:session-ended','storage'])('hides sensitive preview on %s, cancels reading and disables stale sources', async eventName => {
    resolvePdfSource.mockResolvedValue(new Blob(['cv']));
    render(<PdfPreviewButton source="private" fileName="CV.pdf"/>);fireEvent.click(screen.getByRole('button',{name:'Xem trước PDF'}));
    await screen.findByRole('dialog',{name:'CV.pdf'});
    act(()=>{
        if (eventName==='storage') localStorage.setItem('token_user','another-session');
        window.dispatchEvent(eventName==='storage'?new StorageEvent('storage',{key:'token_user'}):new Event(eventName));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Xem trước PDF'})).toBeDisabled();
    expect(resolvePdfSource.mock.calls[0][1].signal.aborted).toBe(true);
});

test('keeps the current PDF usable when a refresh updates only the same account name or avatar', async () => {
    resolvePdfSource.mockResolvedValue(new Blob(['cv']));
    render(<PdfPreviewButton source="private" fileName="CV.pdf"/>);fireEvent.click(screen.getByRole('button',{name:'Xem trước PDF'}));
    await screen.findByRole('button',{name:'Đóng PDF'});
    act(()=>{
        localStorage.setItem('userData',JSON.stringify({id:1,firstName:'New name',image:'avatar.png'}));
        window.dispatchEvent(new StorageEvent('storage',{key:'userData'}));
    });
    expect(screen.getByRole('button',{name:'Đóng PDF'})).toBeVisible();
    expect(screen.getByRole('button',{name:'Xem trước PDF'})).not.toBeDisabled();
});

test.each([{id:2},{id:1,roleCode:'ADMIN'},{id:1,companyId:40},{id:1,statusCode:'S2'}])('closes the PDF when current identity or permissions change to %j',async user=>{
    resolvePdfSource.mockResolvedValue(new Blob(['cv']));
    render(<PdfPreviewButton source="private" fileName="CV.pdf"/>);fireEvent.click(screen.getByRole('button',{name:'Xem trước PDF'}));
    await screen.findByRole('button',{name:'Đóng PDF'});
    act(()=>{localStorage.setItem('userData',JSON.stringify(user));window.dispatchEvent(new StorageEvent('storage',{key:'userData'}));});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Xem trước PDF'})).toBeDisabled();
});

test('shows an actionable loading error and permits a new read without changing the selected source', async () => {
    resolvePdfSource.mockRejectedValueOnce(new Error('Không có quyền đọc PDF')).mockResolvedValueOnce(new Blob(['cv']));
    render(<PdfPreviewButton source="private" fileName="CV.pdf"/>);fireEvent.click(screen.getByRole('button',{name:'Xem trước PDF'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền đọc PDF');
    fireEvent.click(screen.getByRole('button',{name:'Thử tải lại PDF'}));
    await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('button',{name:'Đóng PDF'})).toBeVisible();
});

test('retains an explicit safe original link when an external document host blocks inline preview', async () => {
    resolvePdfSource.mockRejectedValue(new Error('Máy chủ không cho phép xem trực tiếp.'));
    render(<PdfPreviewButton source="https://documents.example.com/cv.pdf" fileName="CV.pdf"/>);
    fireEvent.click(screen.getByRole('button',{name:'Xem trước PDF'}));await screen.findByRole('alert');
    const link=screen.getByRole('link',{name:'Mở tài liệu gốc ↗'});
    expect(link).toHaveAttribute('href','https://documents.example.com/cv.pdf');expect(link).toHaveAttribute('rel','noopener noreferrer');
});
