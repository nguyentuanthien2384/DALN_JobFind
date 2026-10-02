import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SessionContext from '../../auth/SessionContext';
import { streamSupportReply, supportApi } from '../../service/supportChatService';
import SupportChat from './SupportChat';

// Read lazily by the mock factory; tests set the page the widget is shown on.
let mockLocation = { pathname: '/' };
jest.mock('react-router-dom', () => ({
    MemoryRouter: ({ children }) => children,
    Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
    useLocation: () => mockLocation
}));
// CRA's Jest runner cannot load assistant-ui's ESM bundle. These small primitives
// keep the component's own conversation behavior observable through its controls.
jest.mock('@assistant-ui/react', () => {
    const React = require('react');
    const RuntimeContext = React.createContext(null);
    const View = ({ children, ...props }) => <div {...props}>{children}</div>;
    const useRuntime = () => React.useContext(RuntimeContext);
    return {
        AssistantRuntimeProvider: ({ runtime, children }) => <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>,
        useExternalStoreRuntime: config => {
            const [text, setText] = React.useState('');
            return { config, thread: { composer: { setText, getState: () => ({ text }) } } };
        },
        ThreadPrimitive: {
            Root: View, Viewport: View,
            Messages: ({ children }) => {
                const runtime = useRuntime();
                return runtime.config.messages.map(item => <React.Fragment key={item.id}>
                    {children({ message: runtime.config.convertMessage(item) })}
                </React.Fragment>);
            },
            ScrollToBottom: ({ children, ...props }) => <button type="button" {...props}>{children}</button>
        },
        ComposerPrimitive: {
            Root: View,
            Input: React.forwardRef(({ minRows, maxRows, ...props }, ref) => {
                const runtime = useRuntime();
                return <textarea {...props} ref={ref} value={runtime.thread.composer.getState().text}
                    onChange={event => runtime.thread.composer.setText(event.target.value)} />;
            }),
            Send: ({ children, ...props }) => {
                const runtime = useRuntime();
                return <button type="button" {...props} onClick={() => runtime.config.onNew({
                    content: [{ type: 'text', text: runtime.thread.composer.getState().text }]
                })}>{children}</button>;
            },
            Cancel: ({ children, ...props }) => {
                const runtime = useRuntime();
                return <button type="button" {...props} onClick={() => runtime.config.onCancel()}>{children}</button>;
            }
        },
        MessagePrimitive: { Root: View },
        ActionBarPrimitive: { Reload: ({ children, ...props }) => <button type="button" {...props}>{children}</button> }
    };
});
jest.mock('../../service/supportChatService', () => ({
    streamSupportReply: jest.fn(),
    supportApi: {
        list: jest.fn(), get: jest.fn(), remove: jest.fn(), privateTool: jest.fn(),
        handoff: jest.fn(), resetGuest: jest.fn(), feedback: jest.fn()
    }
}));

const show = (user = null) => render(
    <MemoryRouter><SessionContext.Provider value={user}><SupportChat /></SessionContext.Provider></MemoryRouter>
);
const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Tìm việc IT/ })).toBeEnabled());
};
const askQuickQuestion = () => fireEvent.click(screen.getByRole('button', { name: /Tìm việc IT/ }));
const remoteThread = (extra = {}) => ({
    id: 'conversation-1', title: 'Hỏi về hồ sơ', createdAt: 1700000000000,
    updatedAt: 1700000000000, version: 2,
    messages: [{ id: 'question-1', role: 'user', text: 'Làm sao tạo CV?', status: 'complete' },
        { id: 'answer-1', role: 'assistant', text: 'Mở trang CV.', status: 'complete' }],
    ...extra
});
const renderFor = user => <MemoryRouter><SessionContext.Provider value={user}><SupportChat /></SessionContext.Provider></MemoryRouter>;

beforeEach(() => {
    jest.resetAllMocks();
    mockLocation = { pathname: '/' };
    try { sessionStorage.clear(); } catch { /* jsdom always provides it */ }
    supportApi.list.mockResolvedValue([]);
    Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: jest.fn()
        .mockReturnValue('11111111-1111-4111-8111-111111111111') } });
});
afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    jest.restoreAllMocks();
});

test('opens guest support only on request and loads server history before enabling questions', async () => {
    show();
    expect(supportApi.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' }));
    expect(await screen.findByRole('dialog', { name: 'Trợ lý hỗ trợ JobFind' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Tìm việc IT/ })).toBeEnabled());
    expect(supportApi.list).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('Tra cứu riêng tư')).not.toBeInTheDocument();
    expect(streamSupportReply).not.toHaveBeenCalled();
});

test('a history outage blocks sending until the guest explicitly reconnects', async () => {
    supportApi.list.mockRejectedValueOnce(new Error('Không tải được lịch sử'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được lịch sử');
    expect(screen.getByRole('button', { name: /Tìm việc IT/ })).toBeDisabled();
    expect(streamSupportReply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Kết nối lại/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Tìm việc IT/ })).toBeEnabled());
    expect(supportApi.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('streams a single turn, shows only validated job cards and help links, then completes', async () => {
    const pending = deferred();
    let options;
    streamSupportReply.mockImplementation((history, opts) => { options = opts; return pending.promise; });
    show(); await open(); askQuickQuestion();
    expect(streamSupportReply).toHaveBeenCalledTimes(1);
    expect(streamSupportReply).toHaveBeenCalledWith(
        [expect.objectContaining({ role: 'user', text: 'Tìm việc IT đang tuyển tại Hà Nội' })],
        expect.objectContaining({ turn: expect.objectContaining({
            requestId: '11111111-1111-4111-8111-111111111111',
            text: 'Tìm việc IT đang tuyển tại Hà Nội', replaceFrom: null, parentId: null
        }), signal: expect.anything() })
    );
    expect(screen.getByRole('button', { name: 'Dừng trả lời' })).toBeInTheDocument();
    await act(async () => {
        options.onText('Đây là câu trả lời');
        options.onTool({ jobs: [{ id: 9, name: 'React Engineer', company: 'Acme' },
            { id: 'javascript:alert(1)', name: 'Unsafe' }] });
        options.onSources([{ id: 1, title: 'Cách ứng tuyển', href: '/support/help#apply' },
            { id: 2, title: 'Unsafe source', href: 'https://example.com' }]);
    });
    expect(screen.getByRole('link', { name: /React Engineer/ })).toHaveAttribute('href', '/detail-job/9');
    expect(screen.getByRole('link', { name: /Cách ứng tuyển/ })).toHaveAttribute('href', '/support/help#apply');
    expect(screen.queryByText('Unsafe')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsafe source')).not.toBeInTheDocument();
    await act(async () => pending.resolve('Đây là câu trả lời'));
    expect(screen.getByText('Đây là câu trả lời')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sao chép' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dừng trả lời' })).not.toBeInTheDocument();
});

test('labels verified job results when Claude is interrupted after a tool call', async () => {
    let options;
    streamSupportReply.mockImplementation(async (_history, opts) => {
        options = opts;
        opts.onTool({ name: 'search_jobs', jobs: [{ id: 9, name: 'React Engineer', company: 'Acme' }] });
        opts.onMode('public_tool');
        opts.onText('Tìm thấy 1 tin tuyển dụng công khai đang mở.');
        return 'Tìm thấy 1 tin tuyển dụng công khai đang mở.';
    });
    show(); await open(); askQuickQuestion();
    expect(await screen.findByText('Kết quả tra cứu trực tiếp · Claude tạm gián đoạn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /React Engineer/ })).toHaveAttribute('href', '/detail-job/9');
    expect(options.turn.text).toBe('Tìm việc IT đang tuyển tại Hà Nội');
});

test('stop aborts the request, labels partial text and ignores late stream frames', async () => {
    const pending = deferred();
    let options;
    streamSupportReply.mockImplementation((history, opts) => { options = opts; return pending.promise; });
    show(); await open(); askQuickQuestion();
    await act(async () => options.onText('Câu trả lời dang dở'));
    fireEvent.click(screen.getByRole('button', { name: 'Dừng trả lời' }));
    expect(options.signal.aborted).toBe(true);
    expect(screen.getByText('Câu trả lời dang dở')).toBeInTheDocument();
    expect(screen.getByText(/Đã dừng · câu trả lời chưa hoàn chỉnh/)).toBeInTheDocument();
    await act(async () => {
        options.onText('Câu trả lời đến muộn');
        pending.resolve('Câu trả lời đến muộn');
    });
    expect(screen.queryByText('Câu trả lời đến muộn')).not.toBeInTheDocument();
    expect(screen.getByText('Câu trả lời dang dở')).toBeInTheDocument();
});

test('failed answer keeps the question and retries it once after an explicit click', async () => {
    streamSupportReply.mockRejectedValueOnce(new Error('Dịch vụ bận'))
        .mockResolvedValueOnce('Đã trả lời lại');
    show(); await open(); askQuickQuestion();
    expect(await screen.findByRole('alert')).toHaveTextContent('Dịch vụ bận');
    expect(screen.getAllByText('Tìm việc IT đang tuyển tại Hà Nội')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Thử lại/ }));
    await screen.findByText('Đã trả lời lại');
    expect(streamSupportReply).toHaveBeenCalledTimes(2);
    expect(streamSupportReply.mock.calls[1][0].filter(item => item.role === 'user')).toHaveLength(1);
    expect(streamSupportReply.mock.calls[1][1].turn.text).toBe('Tìm việc IT đang tuyển tại Hà Nội');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('server history opens the requested conversation and deletion removes it', async () => {
    supportApi.list.mockResolvedValue([remoteThread({ messages: undefined })]);
    supportApi.get.mockResolvedValue(remoteThread());
    supportApi.remove.mockResolvedValue({});
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Hỏi về hồ sơ/ }));
    expect(await screen.findByText('Mở trang CV.')).toBeInTheDocument();
    expect(supportApi.get).toHaveBeenCalledWith('conversation-1');
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Làm mới lịch sử' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Xóa / }));
    await waitFor(() => expect(supportApi.remove).toHaveBeenCalledWith('conversation-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Xóa / })).not.toBeInTheDocument());
});

test('a failed server deletion keeps the conversation available and explains the failure', async () => {
    supportApi.list.mockResolvedValue([remoteThread({ messages: undefined })]);
    supportApi.remove.mockRejectedValue(new Error('Chưa thể xóa'));
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa Hỏi về hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa thể xóa');
    expect(screen.getByRole('button', { name: /^Hỏi về hồ sơ/ })).toBeInTheDocument();
});

test('changing account aborts an in-flight answer and hides old text and private results', async () => {
    const pending = deferred();
    const privatePending = deferred();
    let options;
    streamSupportReply.mockImplementation((history, opts) => { options = opts; return pending.promise; });
    supportApi.privateTool.mockReturnValue(privatePending.promise);
    const view = show({ id: 7, roleCode: 'CANDIDATE' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Đơn ứng tuyển của tôi' }));
    askQuickQuestion();
    await act(async () => options.onText('Thông tin riêng của tài khoản cũ'));
    view.rerender(renderFor({ id: 8, roleCode: 'EMPLOYER' }));
    await waitFor(() => expect(options.signal.aborted).toBe(true));
    expect(screen.queryByText('Thông tin riêng của tài khoản cũ')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đơn ứng tuyển của tôi' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tin công ty' })).toBeInTheDocument();
    await act(async () => {
        privatePending.resolve({ title: 'Kết quả cũ', lines: ['Bí mật cũ'] });
        options.onText('Câu trả lời cũ đến muộn');
        pending.resolve('Câu trả lời cũ đến muộn');
    });
    expect(screen.queryByText('Bí mật cũ')).not.toBeInTheDocument();
    expect(screen.queryByText('Câu trả lời cũ đến muộn')).not.toBeInTheDocument();
    expect(supportApi.list).toHaveBeenCalledTimes(2);
});

test('private lookup is role-scoped and only links to approved internal management pages', async () => {
    supportApi.privateTool.mockResolvedValueOnce({ title: 'Việc đã lưu', lines: ['Có 2 tin'], href: '/candidate/saved-jobs' })
        .mockResolvedValueOnce({ title: 'Kết quả', lines: ['Một dòng'], href: 'https://example.com/steal' });
    show({ id: 7, roleCode: 'CANDIDATE' }); await open();
    expect(screen.getByRole('button', { name: 'Đơn ứng tuyển của tôi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hạn mức gói' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Việc đã lưu' }));
    expect(await screen.findByText('Có 2 tin')).toBeInTheDocument();
    expect(supportApi.privateTool).toHaveBeenCalledWith('getMySavedJobs');
    expect(screen.getByRole('link', { name: /Mở trang quản lý/ })).toHaveAttribute('href', '/candidate/saved-jobs');
    fireEvent.click(screen.getByRole('button', { name: 'Hồ sơ của tôi' }));
    expect(await screen.findByText('Một dòng')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mở trang quản lý/ })).not.toBeInTheDocument();
});

test('handoff requires explicit consent after a saved conversation and displays its status', async () => {
    supportApi.get.mockResolvedValue(remoteThread({ title: 'Tìm việc React', messages: [
        { id: 'question-1', role: 'user', text: 'Tìm việc IT đang tuyển tại Hà Nội', status: 'complete' },
        { id: 'answer-1', role: 'assistant', text: 'Có tin phù hợp', status: 'complete' }
    ] }));
    supportApi.handoff.mockRejectedValueOnce(new Error('Chưa thể chuyển yêu cầu'))
        .mockResolvedValueOnce({ status: 'waiting', agentId: null });
    streamSupportReply.mockImplementation(async (history, options) => {
        options.onState({ id: 'conversation-1', version: 2,
            userId: '22222222-2222-4222-8222-222222222222', answerId: '33333333-3333-4333-8333-333333333333' });
        options.onText('Có tin phù hợp');
        return 'Có tin phù hợp';
    });
    show({ id: 7, roleCode: 'CANDIDATE' }); await open(); askQuickQuestion();
    const button = await screen.findByRole('button', { name: 'Chuyển hội thoại cho hỗ trợ' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Đồng ý chia sẻ hội thoại/ }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa thể chuyển yêu cầu');
    expect(button).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Đồng ý chia sẻ hội thoại/ })).toBeChecked();
    fireEvent.click(button);
    await waitFor(() => expect(supportApi.handoff).toHaveBeenCalledTimes(2));
    expect(supportApi.handoff).toHaveBeenLastCalledWith('conversation-1');
    expect(await screen.findByText(/Đã lưu yêu cầu. Đang chờ nhân viên tiếp nhận/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chuyển hội thoại cho hỗ trợ' })).not.toBeInTheDocument();
});

test('a new conversation stops the old stream and leaves its partial answer in history', async () => {
    const pending = deferred();
    let options;
    streamSupportReply.mockImplementation((history, opts) => { options = opts; return pending.promise; });
    show(); await open(); askQuickQuestion();
    await act(async () => options.onText('Đã tìm được vài tin'));
    fireEvent.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));
    expect(options.signal.aborted).toBe(true);
    expect(screen.getByRole('heading', { name: 'Bạn cần hỗ trợ gì?' })).toBeInTheDocument();
    expect(screen.queryByText('Đã tìm được vài tin')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    expect(screen.getByRole('button', { name: /^Tìm việc IT đang tuyển/ })).toBeInTheDocument();
    await act(async () => pending.resolve('Kết quả muộn'));
    expect(screen.queryByText('Kết quả muộn')).not.toBeInTheDocument();
});

test('editing a server question sends its replacement ID and keeps the conversation version', async () => {
    const questionId = '22222222-2222-4222-8222-222222222222';
    const old = remoteThread({ messages: [
        { id: questionId, role: 'user', text: 'Làm sao tạo CV?', status: 'complete' },
        { id: '33333333-3333-4333-8333-333333333333', role: 'assistant', text: 'Mở trang CV.', status: 'complete' }
    ] });
    supportApi.list.mockResolvedValue([remoteThread({ messages: undefined })]);
    supportApi.get.mockResolvedValueOnce(old).mockResolvedValueOnce(remoteThread({ messages: [
        { id: questionId, role: 'user', text: 'Cách sửa CV?', status: 'complete' },
        { id: 'answer-new', role: 'assistant', text: 'Mở phần chỉnh sửa.', status: 'complete' }
    ] }));
    streamSupportReply.mockResolvedValue('Mở phần chỉnh sửa.');
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Hỏi về hồ sơ/ }));
    await screen.findByText('Mở trang CV.');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa câu hỏi' }));
    fireEvent.change(screen.getByLabelText('Sửa câu hỏi và tạo câu trả lời mới'),
        { target: { value: 'Cách sửa CV?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại' }));
    await waitFor(() => expect(streamSupportReply).toHaveBeenCalledTimes(1));
    expect(streamSupportReply.mock.calls[0][1].turn).toEqual(expect.objectContaining({
        text: 'Cách sửa CV?', conversationId: 'conversation-1', version: 2,
        replaceFrom: questionId, parentId: null
    }));
    expect(await screen.findByText('Mở phần chỉnh sửa.')).toBeInTheDocument();
    expect(screen.queryByText('Mở trang CV.')).not.toBeInTheDocument();
});

test('microphone transcription enters the composer and closing the panel aborts recognition', async () => {
    let recognition;
    window.SpeechRecognition = class {
        constructor() { recognition = this; this.start = jest.fn(); this.stop = jest.fn(); this.abort = jest.fn(); }
    };
    show(); await open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Đặt câu hỏi hỗ trợ' }),
        { target: { value: 'Cho tôi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nhập bằng giọng nói' }));
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(recognition.lang).toBe('vi-VN');
    await act(async () => recognition.onresult({ results: [[{ transcript: 'tìm việc React' }]] }));
    expect(screen.getByRole('textbox', { name: 'Đặt câu hỏi hỗ trợ' })).toHaveValue('Cho tôi tìm việc React');
    fireEvent.click(screen.getByRole('button', { name: 'Dừng nhập giọng nói' }));
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    await act(async () => recognition.onerror({ error: 'not-allowed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Không nhận được giọng nói');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chatbot' }));
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' })).toBeInTheDocument();
});

test('failed private lookup can be retried without showing fabricated private data', async () => {
    supportApi.privateTool.mockRejectedValue(new Error('Không truy cập được hồ sơ'));
    show({ id: 7, roleCode: 'CANDIDATE' }); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Hồ sơ của tôi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không truy cập được hồ sơ');
    expect(screen.queryByText('Tra cứu trực tiếp, không gửi cho AI.')).not.toBeInTheDocument();
    supportApi.privateTool.mockResolvedValueOnce({ title: 'Hồ sơ', lines: ['Đã cập nhật'] });
    fireEvent.click(screen.getByRole('button', { name: 'Hồ sơ của tôi' }));
    expect(await screen.findByText('Đã cập nhật')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('the composer trims a typed question and does not send empty input', async () => {
    streamSupportReply.mockResolvedValue('Câu trả lời');
    show(); await open();
    const composer = screen.getByRole('textbox', { name: 'Đặt câu hỏi hỗ trợ' });
    fireEvent.change(composer, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
    expect(streamSupportReply).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: '  Tôi cần hỗ trợ  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
    await waitFor(() => expect(streamSupportReply).toHaveBeenCalledTimes(1));
    expect(streamSupportReply.mock.calls[0][1].turn.text).toBe('Tôi cần hỗ trợ');
    expect(await screen.findByText('Câu trả lời')).toBeInTheDocument();
});

test('copying an answer reports success and recovers when clipboard access fails', async () => {
    const writeText = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Clipboard blocked'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    supportApi.list.mockResolvedValue([remoteThread({ messages: undefined })]);
    supportApi.get.mockResolvedValue(remoteThread());
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Hỏi về hồ sơ/ }));
    await screen.findByText('Mở trang CV.');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));
    expect(await screen.findByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('Mở trang CV.');
    fireEvent.click(screen.getByRole('button', { name: 'Đã sao chép' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sao chép' })).toBeInTheDocument());
});

test('exports only the requested server conversation and reports a failed download', async () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:conversation');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    supportApi.list.mockResolvedValue([remoteThread({ messages: undefined })]);
    supportApi.get.mockResolvedValueOnce(remoteThread()).mockRejectedValueOnce(new Error('Không tải được bản xuất'));
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tải xuống Hỏi về hồ sơ' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:conversation');
    fireEvent.click(screen.getByRole('button', { name: 'Tải xuống Hỏi về hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được bản xuất');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
});

test('shows quick replies under the latest answer and sends the chosen one', async () => {
    streamSupportReply.mockImplementationOnce(async (history, options) => {
        options.onText('Có 15 tin IT.'); options.onSuggestions(['Lọc theo Đà Nẵng', 'Mẹo CV IT']); return 'Có 15 tin IT.';
    }).mockImplementationOnce(async (history, options) => { options.onText('Đã lọc'); return 'Đã lọc'; });
    show(); await open(); askQuickQuestion();
    fireEvent.click(await screen.findByRole('button', { name: 'Lọc theo Đà Nẵng' }));
    await waitFor(() => expect(streamSupportReply).toHaveBeenCalledTimes(2));
    expect(streamSupportReply.mock.calls[1][1].turn.text).toBe('Lọc theo Đà Nẵng');
    expect(await screen.findByText('Đã lọc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lọc theo Đà Nẵng' })).not.toBeInTheDocument();
});

test('renders external job cards linking to the reviewed listing with only local logos', async () => {
    streamSupportReply.mockImplementation(async (history, options) => {
        options.onTool({ name: 'search_jobs', jobs: [
            { id: 'external-a16a0d2c3e4e', name: 'Lập trình PL/SQL', company: 'VNPT IT', location: 'Hà Nội', deadline: '2026-10-05', logo: '/external-jobs/logos/vnpt.png' },
            { id: 'external-bad', name: 'Sai mã' }, { id: 5, name: 'Kế toán', logo: 'https://evil.example/x.png' }] });
        options.onText('Có 2 tin'); return 'Có 2 tin';
    });
    show(); await open(); askQuickQuestion();
    const card = await screen.findByRole('link', { name: /Lập trình PL\/SQL/ });
    expect(card).toHaveAttribute('href', '/external-job/external-a16a0d2c3e4e');
    expect(card).toHaveTextContent('Tin nguồn chính thức');
    expect(card).toHaveTextContent('Hạn nộp 05/10/2026');
    expect(card.querySelector('img')).toHaveAttribute('src', '/external-jobs/logos/vnpt.png');
    const internal = screen.getByRole('link', { name: /Kế toán/ });
    expect(internal).toHaveAttribute('href', '/detail-job/5');
    expect(internal.querySelector('img')).toBeNull();
    expect(screen.queryByText('Sai mã')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem thêm việc làm ›' })).toHaveAttribute('href', '/job');
});

test('rates a saved answer, can undo the rating and restores it when saving fails', async () => {
    const answerId = '33333333-3333-4333-8333-333333333333';
    supportApi.get.mockResolvedValue(remoteThread({ messages: [
        { id: '22222222-2222-4222-8222-222222222222', role: 'user', text: 'Tìm việc IT đang tuyển tại Hà Nội', status: 'complete' },
        { id: answerId, role: 'assistant', text: 'Có tin phù hợp', status: 'complete' }] }));
    supportApi.feedback.mockResolvedValue({ saved: true });
    streamSupportReply.mockImplementation(async (history, options) => {
        options.onState({ id: 'conversation-1', version: 2, userId: '22222222-2222-4222-8222-222222222222', answerId });
        options.onText('Có tin phù hợp'); return 'Có tin phù hợp';
    });
    show(); await open(); askQuickQuestion();
    fireEvent.click(await screen.findByRole('button', { name: 'Câu trả lời hữu ích' }));
    await waitFor(() => expect(supportApi.feedback).toHaveBeenCalledWith('conversation-1', answerId, 'up'));
    expect(screen.getByRole('button', { name: 'Câu trả lời hữu ích' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Câu trả lời hữu ích' }));
    await waitFor(() => expect(supportApi.feedback).toHaveBeenLastCalledWith('conversation-1', answerId, null));
    supportApi.feedback.mockRejectedValueOnce(new Error('Không lưu được đánh giá'));
    fireEvent.click(screen.getByRole('button', { name: 'Câu trả lời chưa hữu ích' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được đánh giá');
    expect(screen.getByRole('button', { name: 'Câu trả lời chưa hữu ích' })).toHaveAttribute('aria-pressed', 'false');
});

test('offers questions about the job being viewed', async () => {
    mockLocation = { pathname: '/external-job/external-a16a0d2c3e4e' };
    streamSupportReply.mockResolvedValue('Tóm tắt');
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Tóm tắt tin này' }));
    await waitFor(() => expect(streamSupportReply).toHaveBeenCalled());
    expect(streamSupportReply.mock.calls[0][1].turn.text).toBe('Tóm tắt giúp mình tin tuyển dụng mã external-a16a0d2c3e4e');
});

test('the shortcut menu sends a prepared question and closes', async () => {
    streamSupportReply.mockResolvedValue('Thống kê');
    show(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Menu lối tắt' }));
    expect(screen.getByRole('menu', { name: 'Lối tắt' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Thống kê tuyển dụng/ }));
    await waitFor(() => expect(streamSupportReply).toHaveBeenCalled());
    expect(streamSupportReply.mock.calls[0][1].turn.text).toBe('Tỉnh thành và công ty nào đang tuyển nhiều nhất?');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('greets visitors once per browser session with a personal greeting and unread badge', () => {
    jest.useFakeTimers();
    try {
        show({ id: 7, roleCode: 'CANDIDATE', firstName: 'Nguyễn Thu', lastName: 'Trang' });
        expect(screen.queryByText(/Chào Trang/)).not.toBeInTheDocument();
        act(() => { jest.advanceTimersByTime(6000); });
        expect(screen.getByText(/Chào Trang 👋/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' })).toHaveTextContent('1 tin nhắn mới');
        fireEvent.click(screen.getByRole('button', { name: 'Ẩn lời chào' }));
        expect(screen.queryByText(/Chào Trang 👋/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' })).not.toHaveTextContent('tin nhắn mới');
        expect(sessionStorage.getItem('jobfind-support-teaser')).toBe('1');
        act(() => { jest.advanceTimersByTime(60000); });
        expect(screen.queryByText(/Chào Trang 👋/)).not.toBeInTheDocument();
    } finally { jest.useRealTimers(); }
});

test('does not greet on account pages', () => {
    jest.useFakeTimers();
    try {
        mockLocation = { pathname: '/candidate/info' };
        show();
        act(() => { jest.advanceTimersByTime(60000); });
        expect(screen.queryByText(/Chào bạn 👋/)).not.toBeInTheDocument();
    } finally { jest.useRealTimers(); }
});

test('shows what the assistant is doing until the answer text arrives', async () => {
    const reply = deferred();
    let options;
    streamSupportReply.mockImplementation(async (history, value) => { options = value; const text = await reply.promise; value.onText(text); return text; });
    show(); await open(); askQuickQuestion();
    expect(await screen.findByText('Trợ lý đang soạn tin…')).toBeInTheDocument();
    act(() => options.onStatus({ stage: 'tool', name: 'search_jobs' }));
    expect(screen.getByText('Đang tìm việc phù hợp…')).toBeInTheDocument();
    act(() => options.onStatus({ stage: 'writing' }));
    expect(screen.getByText('Đang viết câu trả lời…')).toBeInTheDocument();
    await act(async () => { reply.resolve('Có 15 tin IT.'); });
    expect(await screen.findByText('Có 15 tin IT.')).toBeInTheDocument();
    expect(screen.queryByText('Đang viết câu trả lời…')).not.toBeInTheDocument();
});

test('an answer that arrives while the chat is closed shows a preview and unread badge', async () => {
    const reply = deferred();
    streamSupportReply.mockImplementation(async (history, options) => { const text = await reply.promise; options.onText(text); return text; });
    show(); await open(); askQuickQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chatbot' }));
    await act(async () => { reply.resolve('Có 15 tin IT đang tuyển tại Hà Nội.'); });
    expect(await screen.findByText(/Trợ lý vừa trả lời: Có 15 tin IT/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' })).toHaveTextContent('1 tin nhắn mới');
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind' }));
    expect(await screen.findByText('Có 15 tin IT đang tuyển tại Hà Nội.')).toBeInTheDocument();
    expect(screen.queryByText(/Trợ lý vừa trả lời/)).not.toBeInTheDocument();
});
