import { submitAiTask, requestAiDraft, validateSuggestions, chatHistoryForAi } from './aiAssist';
import { getAiTask } from './aiSearchService';

jest.mock('./aiSearchService', () => ({ createAiRequestOptions: () => ({ idempotencyKey: 'k'.repeat(32) }), getAiTask: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });

test('retries a transient submit with the same idempotency key and returns the task ID', async () => {
    const submit = jest.fn()
        .mockResolvedValueOnce({ errCode: -1, httpStatus: 503, errorType: 'unavailable' })
        .mockResolvedValueOnce({ errCode: 0, taskId: 'task-1' });
    // Real one-second back-off before the second attempt.
    await expect(submitAiTask(submit)).resolves.toBe('task-1');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0].idempotencyKey).toBe(submit.mock.calls[1][0].idempotencyKey);
});

test('does not retry a permanent rejection', async () => {
    const submit = jest.fn().mockResolvedValue({ errCode: 403, httpStatus: 403, errorType: 'forbidden', errMessage: 'Không có quyền' });
    await expect(submitAiTask(submit)).rejects.toThrow('Không có quyền');
    expect(submit).toHaveBeenCalledTimes(1);
});

test('rejects drafts that belong to another task type', async () => {
    getAiTask.mockResolvedValue({ errCode: 0, data: { id: 'task-1', type: 'match_cv', status: 'done', result: { suggestions: ['x'] } } });
    await expect(requestAiDraft(jest.fn().mockResolvedValue({ errCode: 0, taskId: 'task-1' }), 255)).rejects.toThrow();
});

test('returns validated drafts for the requested task', async () => {
    getAiTask.mockResolvedValue({ errCode: 0, data: { id: 'task-1', type: 'write_assist', status: 'done', result: { suggestions: [' Xin chào ', 'x'.repeat(300)] } } });
    await expect(requestAiDraft(jest.fn().mockResolvedValue({ errCode: 0, taskId: 'task-1' }), 255)).resolves.toEqual(['Xin chào']);
});

test('validates suggestion length by characters, not UTF-16 units', () => {
    expect(validateSuggestions({ suggestions: ['😀'.repeat(255)] }, 255)).toHaveLength(1);
    expect(() => validateSuggestions({ suggestions: [] }, 255)).toThrow();
    expect(() => validateSuggestions(null, 255)).toThrow();
});

test('keeps only recent text messages with the user perspective', () => {
    const messages = [
        { senderId: 5, content: 'Chào anh' }, { senderId: 9, content: '' }, { senderId: 9, content: '  Bạn rảnh thứ Hai?  ' }, { senderId: 9 }
    ];
    expect(chatHistoryForAi(messages, '5')).toEqual([{ from: 'me', text: 'Chào anh' }, { from: 'partner', text: 'Bạn rảnh thứ Hai?' }]);
    expect(chatHistoryForAi(Array(20).fill({ senderId: 9, content: 'x' }), 5)).toHaveLength(12);
});
