import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
const mount = () => render(<BrowserRouter><ChatShareTools partnerId={12} onSelect={jest.fn()} onBusy={jest.fn()} /></BrowserRouter>);
beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/chat/12');
    getChatJobs.mockResolvedValue({ errCode: 0, count: 25, data: [{ id: 7, name: 'React Developer' }] });
});
test('reload restores the open job picker, search and selected page', async () => {
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ công việc' }));
    await screen.findByText('React Developer');
    fireEvent.change(screen.getByLabelText('Tìm theo tên công việc'), { target: { value: 'React' } });
    await screen.findByText('React Developer');
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await screen.findByText('Trang 2 / 3');
    first.unmount(); getChatJobs.mockClear(); mount();
    await screen.findByText('Trang 2 / 3');
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
    await screen.findByText('Trang 1 / 3');
    expect(getChatJobs).toHaveBeenLastCalledWith({ partnerId: 12, search: 'Backend', offset: 0, limit: 10 });
});
