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

describe('isValidRecipientEmail boundaries (RFC 5321 limits and undeliverable domains)', () => {
    // A valid domain of exactly `length` characters (129-195): two 63-char labels, a filler label and ".vn".
    const domainOfLength = (length) => `${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(length - 131)}.vn`;

    test('accepts the maximum total length of 254 and rejects 255', () => {
        const at254 = `${'a'.repeat(64)}@${domainOfLength(189)}`;
        expect(at254).toHaveLength(254);
        expect(isValidRecipientEmail(at254)).toBe(true);
        const at255 = `${'a'.repeat(64)}@${domainOfLength(190)}`;
        expect(at255).toHaveLength(255);
        expect(isValidRecipientEmail(at255)).toBe(false);
        // The same domain is fine with a shorter local part, so only the total length was rejected.
        expect(isValidRecipientEmail(`${'a'.repeat(63)}@${domainOfLength(190)}`)).toBe(true);
    });

    test('limits the local part to 64 characters', () => {
        expect(isValidRecipientEmail(`${'a'.repeat(64)}@candidate.vn`)).toBe(true);
        expect(isValidRecipientEmail(`${'a'.repeat(65)}@candidate.vn`)).toBe(false);
    });

    test('limits each domain label to 63 characters', () => {
        expect(isValidRecipientEmail(`an@${'b'.repeat(63)}.vn`)).toBe(true);
        expect(isValidRecipientEmail(`an@${'b'.repeat(64)}.vn`)).toBe(false);
    });

    test.each([
        ['leading dot in local part', '.an@candidate.vn'],
        ['trailing dot in local part', 'an.@candidate.vn'],
        ['consecutive dots in local part', 'an..nguyen@candidate.vn'],
        ['space in local part', 'an nguyen@candidate.vn'],
        ['comma in local part', 'an,nguyen@candidate.vn'],
        ['two @ signs', 'an@b@candidate.vn'],
        ['missing local part', '@candidate.vn'],
        ['missing domain', 'an@'],
        ['single-label domain', 'an@localhost'],
        ['empty domain label', 'an@candidate..vn'],
        ['label starting with hyphen', 'an@-candidate.vn'],
        ['label ending with hyphen', 'an@candidate-.vn'],
        ['underscore in domain', 'an@candi_date.vn'],
    ])('rejects %s', (_case, email) => {
        expect(isValidRecipientEmail(email)).toBe(false);
    });

    test.each([
        'an.nguyen+jobs@candidate.vn', "o'neil@candidate.vn", 'an@sub.candidate.com.vn', 'an@candi-date.vn', 'an@1.vn',
    ])('accepts deliverable address %s', (email) => {
        expect(isValidRecipientEmail(email)).toBe(true);
    });

    test.each([
        'example@gmail.com', 'EXAMPLE@GMAIL.COM', 'an@example.com', 'an@example.net', 'an@example.org',
        'an@mail.example.com', 'an@site.example', 'an@site.invalid', 'an@site.test', 'an@printer.local', 'an@app.localhost',
    ])('rejects placeholder or reserved address %s', (email) => {
        expect(isValidRecipientEmail(email)).toBe(false);
    });

    test.each(['an@notexample.com', 'an@example.com.vn', 'an@latest.vn', 'an@vocal.vn'])(
        'does not over-match reserved names inside a real domain: %s', (email) => {
            expect(isValidRecipientEmail(email)).toBe(true);
        });

    test.each([undefined, null, 42, {}, [], '   '])('rejects non-string or blank input %p', (value) => {
        expect(isValidRecipientEmail(value)).toBe(false);
    });
});

describe('validateRegistration field boundaries', () => {
    test('accepts names of exactly 100 Unicode characters and rejects 101', () => {
        expect(validateRegistration({ ...valid(), firstName: 'Ạ'.repeat(100) })).toEqual({});
        expect(validateRegistration({ ...valid(), lastName: '🧑'.repeat(100) })).toEqual({});
        expect(validateRegistration({ ...valid(), firstName: 'Ạ'.repeat(101) })).toHaveProperty('firstName');
    });

    test('reports only the invalid fields of an otherwise valid form', () => {
        expect(validateRegistration({ ...valid(), email: 'an@example.com', phonenumber: '090123456' }))
            .toEqual({ email: expect.any(String), phonenumber: expect.any(String) });
    });

    test('trims the phone number before checking its ten digits', () => {
        expect(validateRegistration({ ...valid(), phonenumber: ' 0901234567 ' })).toEqual({});
        expect(validateRegistration({ ...valid(), phonenumber: '09012345678' })).toHaveProperty('phonenumber');
    });
});
