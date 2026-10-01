import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatAiAssist from './ChatAiAssist';
import { chatAssistAi, getAiTask } from '../../service/aiSearchService';

jest.mock('../../service/aiSearchService', () => ({
    createAiRequestOptions: () => ({ idempotencyKey: 'c'.repeat(32) }), chatAssistAi: jest.fn(), getAiTask: jest.fn()
}));

const messages = [{ id: 1, senderId: 5, content: 'Chào anh' }, { id: 2, senderId: 9, content: 'Thứ Hai bạn phỏng vấn được không?' }];
const done = suggestions => ({ errCode: 0, data: { id: 'task-1', type: 'write_assist', status: 'done', result: { kind: 'chat_reply', suggestions } } });

beforeEach(() => {
    jest.clearAllMocks();
    chatAssistAi.mockResolvedValue({ errCode: 0, taskId: 'task-1' });
});

test('suggests replies to the latest partner message and only fills the composer', async () => {
    getAiTask.mockResolvedValue(done(['Dạ, thứ Hai em phỏng vấn được ạ.', 'Anh cho em xin giờ cụ thể ạ?']));
    const onUse = jest.fn();
    // StrictMode mounts twice in development; results must still appear.
    render(<React.StrictMode><ChatAiAssist messages={messages} userId={5} draft="" onUse={onUse} /></React.StrictMode>);
    expect(screen.getByRole('button', { name: 'Viết lại lịch sự hơn' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý trả lời' }));
    expect(chatAssistAi).toHaveBeenCalledWith({ mode: 'suggest', messages: [
        { from: 'me', text: 'Chào anh' }, { from: 'partner', text: 'Thứ Hai bạn phỏng vấn được không?' }
    ] }, expect.objectContaining({ idempotencyKey: 'c'.repeat(32) }));
    fireEvent.click(await screen.findByRole('button', { name: /Anh cho em xin giờ/ }));
    expect(onUse).toHaveBeenCalledWith('Anh cho em xin giờ cụ thể ạ?');
    expect(screen.queryByRole('button', { name: /Dạ, thứ Hai/ })).not.toBeInTheDocument();
});

test('does not offer reply suggestions when the user sent the last message', () => {
    render(<ChatAiAssist messages={messages.slice(0, 1)} userId={5} draft="" onUse={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Gợi ý trả lời' })).toBeDisabled();
});

test('polishes the current draft with a little context and shows failures', async () => {
    getAiTask.mockResolvedValue({ errCode: 0, data: { id: 'task-1', type: 'write_assist', status: 'failed', error: 'Dịch vụ AI chưa thể xử lý yêu cầu' } });
    render(<ChatAiAssist messages={messages} userId={5} draft=" ok mai pv nhe " onUse={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Viết lại lịch sự hơn' }));
    expect(chatAssistAi.mock.calls[0][0]).toMatchObject({ mode: 'polish', draft: 'ok mai pv nhe' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Dịch vụ AI chưa thể xử lý yêu cầu');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Viết lại lịch sự hơn' })).toBeEnabled());
});
