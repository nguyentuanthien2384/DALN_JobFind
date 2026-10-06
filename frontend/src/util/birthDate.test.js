import { birthDateValue, formatBirthDate, parseBirthDate } from './birthDate';

test('reads every stored date-of-birth format', () => {
    expect(formatBirthDate('2002-01-01')).toBe('01/01/2002');
    expect(formatBirthDate('01/02/2000')).toBe('01/02/2000');
    expect(formatBirthDate(String(Date.UTC(2000, 0, 14, 5)))).toBe('14/01/2000');
    expect(formatBirthDate(Date.UTC(2000, 0, 14, 5))).toBe('14/01/2000');
    expect(formatBirthDate(String(new Date(1965, 4, 6).getTime()))).toBe('06/05/1965');
    expect(formatBirthDate(null)).toBe('Không có thông tin');
    expect(formatBirthDate('31/02/2000')).toBe('Không có thông tin');
    expect(formatBirthDate('không rõ')).toBe('Không có thông tin');
    expect(formatBirthDate('', 'Chưa có')).toBe('Chưa có');
});

test('gives the date picker a local calendar date for every stored format', () => {
    for (const dob of ['1990-01-01', '01/01/1990', String(new Date(1990, 0, 1).getTime())]) {
        const date = parseBirthDate(dob);
        expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([1990, 0, 1]);
    }
});

test.each([undefined, null, '', '   ', 'không rõ', '1990-13-45', '31/02/2000', '8640000000000001'])(
    'never gives the date picker an Invalid Date for %p', dob => {
        expect(parseBirthDate(dob)).toBeNull();
    });

test('stores a cleared birthday as null instead of 01/01/1970', () => {
    expect(birthDateValue(new Date(2000, 5, 15))).toBe(new Date(2000, 5, 15).getTime());
    expect(birthDateValue(null)).toBeNull();
    expect(birthDateValue(new Date(NaN))).toBeNull();
});
