const { normalizeEmail, isValidRecipientEmail, validateNewPassword, validateRegistration } = require('../../src/utils/accountValidation');

const valid = () => ({ firstName: '  Nguyễn ', lastName: ' An ', email: ' AN@CANDIDATE.VN ', phonenumber: '0901234567', password: 'Mật khẩu mới !' });

test('normalizes email and accepts Unicode names and passphrases', () => {
    expect(normalizeEmail(valid().email)).toBe('an@candidate.vn');
    expect(isValidRecipientEmail(valid().email)).toBe(true);
    expect(validateRegistration(valid())).toEqual({});
    expect(validateNewPassword('        ')).toBe('');
});

test.each([undefined, null, 12345678, {}, ['password'], '', '1234567', '🧑'.repeat(7)])('rejects missing, non-string or short password: %p', password => {
    expect(validateNewPassword(password)).toContain('8');
});

test('uses Unicode code points for the minimum and UTF-8 bytes for bcrypt maximum', () => {
    expect(validateNewPassword('🧑'.repeat(8))).toBe('');
    expect(validateNewPassword('a'.repeat(72))).toBe('');
    expect(validateNewPassword('a'.repeat(73))).toContain('72 byte');
    expect(validateNewPassword('á'.repeat(36))).toBe('');
    expect(validateNewPassword('á'.repeat(37))).toContain('72 byte');
    expect(validateNewPassword('🧑'.repeat(19))).toContain('72 byte');
});

test.each([null, undefined, [], 'bad', {}])('rejects malformed registration with field errors: %p', data => {
    expect(Object.keys(validateRegistration(data))).toEqual(['firstName', 'lastName', 'phonenumber', 'email', 'password']);
});

test.each([
    ['firstName', '   '], ['lastName', 'a'.repeat(101)], ['firstName', {}],
    ['phonenumber', '0901'], ['phonenumber', 'abcdefghij'], ['phonenumber', 901234567],
    ['email', {}], ['email', 'bad'], ['password', '1234567']
])('reports an invalid %s field', (field, value) => {
    expect(validateRegistration({ ...valid(), [field]: value })[field]).toBeTruthy();
});
