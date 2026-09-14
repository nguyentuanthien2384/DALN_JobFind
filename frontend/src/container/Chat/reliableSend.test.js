import { readPending, preparePending, clearPending, sendReliably } from './reliableSend';
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: require('crypto').webcrypto }));
beforeEach(() => sessionStorage.clear());
test('uncertain writes retain exactly the same key across reloads, scoped by user and partner', () => {
    const first = preparePending(7, 8, 'hello');
    expect(readPending(7, 8)).toEqual(first);
    expect(preparePending(7, 8, 'hello')).toEqual(first);
    expect(readPending(9, 8)).toBeNull(); expect(readPending(7, 9)).toBeNull();
    expect(() => preparePending(7, 8, 'edited')).toThrow('chưa được xác nhận');
    clearPending(7, 8, 'wrong-key'); expect(readPending(7, 8)).toEqual(first);
    clearPending(7, 8, first.clientMessageId); expect(readPending(7, 8)).toBeNull();
    expect(preparePending(7, 8, 'hello').clientMessageId).not.toBe(first.clientMessageId);
});
test('lost acknowledgement falls back with the identical payload and never creates a new key', async () => {
    const payload = preparePending(7, 8, 'hello');
    const socket = { connected: true, timeout: jest.fn(), emitWithAck: jest.fn().mockRejectedValue(new Error('timeout')) };
    socket.timeout.mockReturnValue(socket);
    const rest = jest.fn().mockResolvedValue({ errCode: 0, duplicate: true, data: { id: 1 } });
    expect(await sendReliably(socket, payload, rest)).toEqual(expect.objectContaining({ duplicate: true }));
    expect(socket.timeout).toHaveBeenCalledWith(5000); expect(rest).toHaveBeenCalledWith(payload);
});
test('business rejection never triggers REST and an offline connection does not queue a socket send', async () => {
    const payload = preparePending(7, 8, 'hello');
    const socket = { connected: true, timeout: jest.fn(), emitWithAck: jest.fn().mockResolvedValue({ errCode: 5, code: 'CHAT_NOT_ALLOWED' }) };
    socket.timeout.mockReturnValue(socket);
    const rest = jest.fn().mockResolvedValue({ errCode: -1 });
    expect((await sendReliably(socket, payload, rest)).code).toBe('CHAT_NOT_ALLOWED'); expect(rest).not.toHaveBeenCalled();
    socket.connected = false;
    await sendReliably(socket, payload, rest); expect(socket.emitWithAck).toHaveBeenCalledTimes(1); expect(rest).toHaveBeenCalledWith(payload);
});
test('a fallback denial cannot resolve an uncertain original socket write', async () => {
    const payload = preparePending(7, 8, 'hello');
    const socket = { connected: true, timeout: jest.fn(), emitWithAck: jest.fn().mockRejectedValue(new Error('lost ACK')) };
    socket.timeout.mockReturnValue(socket);
    const result = await sendReliably(socket, payload, async () => ({ errCode: 7, code: 'RATE_LIMITED' }));
    expect(result.deliveryUncertain).toBe(true);
    expect(readPending(7, 8)).toEqual(payload);
});
