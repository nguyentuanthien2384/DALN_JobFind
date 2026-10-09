const { EventEmitter } = require('node:events');
const mockWorker = jest.fn();
jest.mock('node:worker_threads', () => ({ Worker: mockWorker }));

describe('chat PDF worker resource limits and cleanup', () => {
  let workers, validateChatPdf;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    workers = [];
    mockWorker.mockReset().mockImplementation(() => {
      const worker = new EventEmitter();
      worker.terminate = jest.fn().mockResolvedValue(0);
      workers.push(worker);
      return worker;
    });
    ({ validateChatPdf } = require('../../src/utils/chatPdf'));
  });

  afterEach(() => jest.useRealTimers());

  test('passes bytes into a bounded worker and releases it on a valid result', async () => {
    const bytes = Buffer.from('%PDF-fixture');
    const validation = validateChatPdf(bytes);
    expect(mockWorker).toHaveBeenCalledWith(expect.stringMatching(/chatPdfWorker\.cjs$/), {
      workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      stdout: true, stderr: true
    });
    workers[0].emit('message', { pages: 2 });
    await expect(validation).resolves.toEqual({ pages: 2 });
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each(['message', 'error', 'exit'])('rejects a worker %s failure and cleans up once', async event => {
    const validation = validateChatPdf(Buffer.from('invalid document'));
    const rejected = expect(validation).rejects.toThrow('PDF không hợp lệ');
    workers[0].emit(event, event === 'message' ? { error: 'private parser details' } : new Error('private parser details'));
    await rejected;
    workers[0].emit('exit', 1);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('terminates a stalled parser at six seconds and ignores late completion', async () => {
    const validation = validateChatPdf(Buffer.from('slow document'));
    const rejected = expect(validation).rejects.toThrow('PDF không hợp lệ');
    await jest.advanceTimersByTimeAsync(5999);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    workers[0].emit('message', { pages: 1 });
    workers[0].emit('exit', 0);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('permits at most four concurrent parsers and frees exactly one slot per result', async () => {
    const pending = Array.from({ length: 4 }, () => validateChatPdf(Buffer.from('document')));
    await expect(validateChatPdf(Buffer.from('fifth document'))).rejects.toThrow('Đang có nhiều tài liệu');
    expect(mockWorker).toHaveBeenCalledTimes(4);
    workers[0].emit('message', { pages: 1 });
    await pending[0];
    pending.push(validateChatPdf(Buffer.from('replacement document')));
    expect(mockWorker).toHaveBeenCalledTimes(5);
    // EventEmitter can still report exit/message after terminate. Those must not
    // decrement the active counter again and admit a fifth concurrent parser.
    workers[0].emit('message', { pages: 1 }); workers[0].emit('exit', 0);
    await expect(validateChatPdf(Buffer.from('extra document'))).rejects.toThrow('Đang có nhiều tài liệu');
    expect(mockWorker).toHaveBeenCalledTimes(5);
    workers.slice(1).forEach(worker => worker.emit('message', { pages: 1 }));
    await Promise.all(pending);
    expect(jest.getTimerCount()).toBe(0);
    workers.forEach(worker => expect(worker.terminate).toHaveBeenCalledTimes(1));
  });

  test('a constructor failure does not leak a parser slot or create a timeout', async () => {
    const failure = new Error('worker allocation failed');
    mockWorker.mockImplementationOnce(() => { throw failure; });
    await expect(validateChatPdf(Buffer.from('document'))).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
    const pending = Array.from({ length: 4 }, () => validateChatPdf(Buffer.from('document')));
    expect(workers).toHaveLength(4);
    workers.forEach(worker => worker.emit('message', { pages: 1 }));
    await Promise.all(pending);
    expect(jest.getTimerCount()).toBe(0);
  });
});
