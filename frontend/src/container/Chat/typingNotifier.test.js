import { createTypingNotifier } from './typingNotifier';

describe('typing notifications', () => {
    let socket;
    let getSocket;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-01T00:00:00Z'));
        sessionStorage.clear();
        socket = { connected: true, emit: jest.fn(), volatile: { emit: jest.fn() } };
        getSocket = jest.fn(() => socket);
    });

    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    it('delivers typing for a rapid second message after the first indicator was cleared', () => {
        let visible = false;
        let acceptedAt = -Infinity;
        // Model the real server's 750ms window and the receiver clearing its
        // indicator when a message arrives. Volatile packets are dropped.
        socket.emit.mockImplementation(() => {
            if (Date.now() - acceptedAt >= 750) {
                visible = true;
                acceptedAt = Date.now();
            }
        });
        const typing = createTypingNotifier(getSocket, 7);
        typing.notify(20, 'First message');
        expect(visible).toBe(true);
        typing.cancel();
        visible = false;
        jest.advanceTimersByTime(100);
        typing.notify(20, 'Second message');
        jest.advanceTimersByTime(250);
        expect(visible).toBe(false);
        jest.advanceTimersByTime(850);
        expect(visible).toBe(true);
        expect(socket.emit).toHaveBeenCalledTimes(2);
        expect(socket.volatile.emit).not.toHaveBeenCalled();
    });

    it('bounds sustained typing below the server limit and stops when edits stop', () => {
        const emittedAt = [];
        socket.emit.mockImplementation(() => emittedAt.push(Date.now()));
        const typing = createTypingNotifier(getSocket, 7);
        for (let index = 0; index < 600; index += 1) {
            typing.notify(20, `Draft ${index}`);
            jest.advanceTimersByTime(100);
        }
        expect(emittedAt.length).toBeGreaterThan(40);
        expect(emittedAt.length).toBeLessThan(60);
        expect(emittedAt.slice(1).every((at, index) => at - emittedAt[index] >= 1200)).toBe(true);
        const count = emittedAt.length;
        jest.advanceTimersByTime(60000);
        expect(emittedAt).toHaveLength(count);
    });

    it('preserves the emission budget across page reloads and recipient changes', () => {
        const previousPage = createTypingNotifier(getSocket, 7);
        previousPage.notify(20, 'First draft');
        previousPage.cancel();
        jest.advanceTimersByTime(100);
        const reloadedPage = createTypingNotifier(getSocket, 7);
        reloadedPage.notify(30, 'New draft');
        jest.advanceTimersByTime(1099);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        expect(socket.emit).toHaveBeenLastCalledWith('chat:typing', { receiverId: 30 });
        expect(socket.emit).toHaveBeenCalledTimes(2);
    });

    it.each(['', '   '])('cancels a pending draft when changed to %j', (value) => {
        const typing = createTypingNotifier(getSocket, 7);
        typing.notify(20, 'First');
        typing.notify(20, 'Pending');
        typing.notify(20, value);
        jest.advanceTimersByTime(5000);
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });

    it('never queues offline edits or emits a pending draft through a disconnected socket', () => {
        const typing = createTypingNotifier(getSocket, 7);
        socket.connected = false;
        typing.notify(20, 'Offline draft');
        socket.connected = true;
        jest.advanceTimersByTime(5000);
        expect(socket.emit).not.toHaveBeenCalled();
        typing.notify(20, 'Connected draft');
        typing.notify(20, 'Pending draft');
        socket.connected = false;
        jest.advanceTimersByTime(1200);
        socket.connected = true;
        jest.advanceTimersByTime(5000);
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });

    it('discards a pending notification if the signed-in socket is replaced', () => {
        const typing = createTypingNotifier(getSocket, 7);
        typing.notify(20, 'First');
        typing.notify(20, 'Pending');
        const replacement = { connected: true, emit: jest.fn() };
        getSocket.mockReturnValue(replacement);
        jest.advanceTimersByTime(1200);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(replacement.emit).not.toHaveBeenCalled();
    });

    it('discards an old pending edit when a suspended tab resumes', () => {
        const typing = createTypingNotifier(getSocket, 7);
        typing.notify(20, 'First');
        typing.notify(20, 'Pending');
        jest.setSystemTime(Date.now() + 30000);
        jest.advanceTimersByTime(1200);
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });

    it('still throttles when session storage is unavailable', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
        const typing = createTypingNotifier(getSocket, 7);
        typing.notify(20, 'First');
        typing.notify(20, 'Second');
        jest.advanceTimersByTime(1200);
        expect(socket.emit).toHaveBeenCalledTimes(2);
    });
});
