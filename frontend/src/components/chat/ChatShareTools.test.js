import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ChatShareTools from './ChatShareTools';
import { getChatJobs } from '../../service/chatMediaService';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('antd', () => ({ Modal: ({ children, onCancel }) => <div role="dialog">{children}<button onClick={onCancel}>Đóng</button></div> }));
jest.mock('./ChatMessageContent', () => ({ ChatJobCard: ({ job }) => <h2>{job.name}</h2> }));
jest.mock('../../service/chatMediaService', () => ({ getChatJobs: jest.fn(), readChatPdf: jest.fn(), uploadChatPdf: jest.fn() }));
const mount = (onSelect = jest.fn()) => render(<BrowserRouter><ChatShareTools partnerId={12} onSelect={onSelect} onBusy={jest.fn()} /></BrowserRouter>);
const settled = () => waitFor(() => expect(document.querySelector('.stable-list')).toHaveAttribute('aria-busy', 'false'));
beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/chat/12');
    getChatJobs.mockResolvedValue({ errCode: 0, count: 25, data: [{ id: 7, name: 'React Developer' }] });
});
test('reload restores the open job picker, search and selected page', async () => {
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ công việc' }));
    await screen.findByText('React Developer'); await settled();
    fireEvent.change(screen.getByLabelText('Tìm theo tên công việc'), { target: { value: 'React' } });
    await screen.findByText('React Developer'); await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await screen.findByText('Trang 2 / 3'); await settled();
    first.unmount(); getChatJobs.mockClear(); mount();
    await screen.findByText('Trang 2 / 3'); await settled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Tìm theo tên công việc')).toHaveValue('React');
    expect(getChatJobs).toHaveBeenCalledTimes(1);
    expect(getChatJobs).toHaveBeenCalledWith({ partnerId: 12, search: 'React', offset: 10, limit: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('sharedJob.page')).toBe('2');
});
test('clamps a removed last page and resets page only when the search changes', async () => {
    window.history.replaceState({}, '', '/chat/12?sharedJob.open=true&sharedJob.page=9');
    mount(); await screen.findByText('Trang 3 / 3');
    expect(new URLSearchParams(window.location.search).get('sharedJob.page')).toBe('3');
    fireEvent.change(screen.getByLabelText('Tìm theo tên công việc'), { target: { value: 'Backend' } });
    await screen.findByText('Trang 1 / 3'); await settled();
    expect(getChatJobs).toHaveBeenLastCalledWith({ partnerId: 12, search: 'Backend', offset: 0, limit: 10 });
});


test('paging keeps job cards in place without allowing an old job to be selected during the request', async () => {
    window.history.replaceState({}, '', '/chat/12?sharedJob.open=true');
    const onSelect = jest.fn();
    mount(onSelect); await screen.findByText('React Developer'); await settled();
    const oldCard = screen.getByText('React Developer');
    const oldSelect = screen.getByRole('button', { name: 'Chọn công việc này' });
    let finishPage;
    getChatJobs.mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(oldCard).toBeInTheDocument();
    expect(oldCard.closest('[inert]')).not.toBeNull();
    fireEvent.click(oldSelect);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Trang trước' })).toBeInTheDocument();
    await waitFor(() => expect(finishPage).toBeDefined());
    await act(async () => finishPage({ errCode: 0, count: 25, data: [{ id: 9, name: 'Backend Developer' }] }));
    expect(await screen.findByText('Backend Developer')).toBeInTheDocument();
    expect(screen.queryByText('React Developer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn công việc này' }));
    expect(onSelect).toHaveBeenCalledWith({ job: { id: 9, name: 'Backend Developer' } });
});

test('a failed new job page clears retained cards and can be retried at the same URL page', async () => {
    window.history.replaceState({}, '', '/chat/12?sharedJob.open=true');
    mount(); await screen.findByText('React Developer'); await settled();
    getChatJobs.mockRejectedValueOnce(new Error('Trang này chưa tải được'));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Trang này chưa tải được');
    expect(screen.queryByText('React Developer')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('sharedJob.page')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('React Developer'); await settled();
    expect(getChatJobs).toHaveBeenLastCalledWith({ partnerId: 12, search: '', offset: 10, limit: 10 });
});
