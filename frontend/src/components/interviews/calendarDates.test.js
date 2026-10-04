import { adjacentMonth, calendarDays, createInterviewIcs, downloadInterviewIcs, safeMeetingUrl, vietnamDate, vietnamTime } from './calendarDates';

const event = {
    id: 9, applicationId: 7, jobTitle: 'Kỹ sư, dữ liệu; ứng dụng', companyName: 'Công ty Việt',
    startAt: '2026-10-04T09:30:00+07:00', endAt: '2026-10-04T10:30:00+07:00',
    interview: { interviewMode: 'onsite', location: '12 Nguyễn Huệ', preparation: 'Mang CV\r\nChuẩn bị máy tính', round: 'Vòng 2' },
};

test('dates use Vietnam midnight and the six-week grid starts on Monday across year boundaries', () => {
    expect(vietnamDate('2026-10-03T17:00:00Z')).toBe('2026-10-04');
    expect(vietnamDate('2026-10-03T16:59:59Z')).toBe('2026-10-03');
    expect(vietnamTime('2026-10-03T17:00:00Z')).toBe('00:00');
    expect(vietnamDate('bad')).toBe('');
    expect(vietnamTime('bad')).toBe('');
    const days = calendarDays('2026-10');
    expect(days).toHaveLength(42);
    expect(new Set(days).size).toBe(42);
    expect(days[0]).toBe('2026-09-28');
    expect(days[41]).toBe('2026-11-08');
    expect(adjacentMonth('2026-01', -1)).toBe('2025-12');
    expect(adjacentMonth('2026-12', 1)).toBe('2027-01');
});

test.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///c:/secret', 'https://user:pass@example.com', 'https://example.com/a b', 'not a URL', '', null])('does not expose unsafe meeting link %p', value => {
    expect(safeMeetingUrl(value)).toBeNull();
});

test('accepts HTTP(S) links and preserves their query safely', () => {
    expect(safeMeetingUrl('https://meet.example.com/room?a=1&b=2')).toBe('https://meet.example.com/room?a=1&b=2');
    expect(safeMeetingUrl('http://localhost:3000/room')).toBe('http://localhost:3000/room');
});

test('exports UTC stamps, RFC text escaping and UTF-8 byte folding without splitting code points', () => {
    const title = 'Ứng viên Việt Nam 👩‍💻 '.repeat(20);
    const content = createInterviewIcs({ ...event, jobTitle: title, message: 'A\\B;C,D\nBEGIN:VALARM' }, new Date('2026-10-01T00:00:00Z'));
    const unfolded = content.replace(/\r\n /g, '');
    expect(unfolded).toContain('DTSTART:20261004T023000Z\r\nDTEND:20261004T033000Z');
    expect(unfolded).toContain('DTSTAMP:20261001T000000Z');
    expect(unfolded).toContain(`SUMMARY:Phỏng vấn ${title} — Công ty Việt`);
    expect(unfolded).toContain('Mang CV\\nChuẩn bị máy tính');
    expect(unfolded).toContain('A\\\\B\\;C\\,D\\nBEGIN:VALARM');
    expect(content.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(content.split('\r\n').filter(line => line === 'BEGIN:VALARM')).toEqual([]);
    content.split('\r\n').forEach(line => {
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
        expect(line).not.toContain('\uFFFD');
    });
});

test('does not export unsafe URLs and rejects invalid or reversed interview times', () => {
    const content = createInterviewIcs({ ...event, interview: { interviewMode: 'online', meetingUrl: 'javascript:alert(1)' } });
    expect(content).toContain('LOCATION:\r\n');
    expect(content).not.toContain('javascript');
    expect(() => createInterviewIcs({ ...event, startAt: 'invalid' })).toThrow('Thời gian lịch phỏng vấn không hợp lệ');
    expect(() => createInterviewIcs({ ...event, endAt: event.startAt })).toThrow();
    expect(() => createInterviewIcs({ ...event, endAt: '2026-10-01T00:00:00Z' })).toThrow();
});

test('downloads one calendar file with a sanitized name and releases its object URL', () => {
    jest.useFakeTimers();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const create = jest.fn(() => 'blob:interview');
    const revoke = jest.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        expect(this.download).toBe('phong-van-7x.ics');
        expect(this.href).toBe('blob:interview');
    });
    try {
        downloadInterviewIcs({ ...event, applicationId: '7/../x' });
        expect(click).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
        expect(document.querySelector('a[download]')).toBeNull();
        jest.advanceTimersByTime(1000);
        expect(revoke).toHaveBeenCalledWith('blob:interview');
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; click.mockRestore(); jest.useRealTimers(); }
});
