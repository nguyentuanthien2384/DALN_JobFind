import moment from 'moment';
import { formatJobTime, jobLabel } from './jobLocale';

test('uses Vietnamese independently of the global locale and supports both API date formats', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T12:00:00Z'));
    moment.locale('en');
    const time = new Date('2026-07-20T12:00:00Z').getTime();
    expect(formatJobTime(String(time))).toBe('2 tháng trước');
    expect(formatJobTime(new Date(time).toISOString())).toBe('2 tháng trước');
    expect(formatJobTime(time)).toBe('2 tháng trước');
    jest.useRealTimers();
});

test.each([undefined, null, '', 'invalid'])('does not display invalid date text for %s', value => {
    expect(formatJobTime(value)).toBe('Chưa cập nhật');
});

test('localizes common labels and preserves employer values it does not recognize', () => {
    expect(jobLabel({ value: 'Remote' })).toBe('Làm việc từ xa');
    expect(jobLabel('Part-time')).toBe('Bán thời gian');
    expect(jobLabel('Thoả thuận')).toBe('Thỏa thuận');
    expect(jobLabel('React / .NET')).toBe('React / .NET');
    expect(jobLabel()).toBe('Chưa cập nhật');
});

test.each(['Intern', 'Fresher', 'Junior', 'Middle', 'Senior', 'Lead', 'Manager'])(
    'preserves the IT level %s on filters, cards and details', level => {
        expect(jobLabel({ value: level })).toBe(level);
        expect(jobLabel(level.toLowerCase())).toBe(level);
    },
);
