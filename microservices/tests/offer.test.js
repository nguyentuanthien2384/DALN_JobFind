import { describe, expect, it } from 'vitest';
import { validateOffer } from '../application-service/src/libs/offer.js';
import { offerFixture } from './offerFixture.js';
import { assertEventPayload } from '../shared/eventContract.js';
import { eventExamples } from '../shared/contracts/eventCatalog.js';

describe('offer validation', () => {
    it.each([
        undefined, [], {}, { ...offerFixture, location: ' ' }, { ...offerFixture, startDate: '2099-02-30' },
        { ...offerFixture, startTime: '25:00' }, { ...offerFixture, startDate: '2020-01-01' },
        { ...offerFixture, responseDeadline: '2099-02-30T09:00' }, { ...offerFixture, responseDeadline: '2099-10-21T09:00' },
        { ...offerFixture, responseDeadline: '2020-01-01T09:00' }, { ...offerFixture, timeZone: 'UTC' },
        { ...offerFixture, workMode: 'remote' }, { ...offerFixture, workMode: 'other' },
        { ...offerFixture, meetingUrl: 'javascript:alert(1)' }, { ...offerFixture, meetingUrl: 'https://a:b@host.com' },
        { ...offerFixture, contactEmail: 'hr@x.com\r\nBcc: x@evil.com' },
        { ...offerFixture, contactEmail: 'a@x.com,b@x.com' }, { ...offerFixture, contactName: ' ' },
        { ...offerFixture, salary: 'x'.repeat(1001) }, { ...offerFixture, location: {} },
        { ...offerFixture, surprise: 'unknown' }
    ])('rejects malformed or incomplete offer %#', (offer) => {
        expect(validateOffer(offer).error).toEqual(expect.any(String));
    });
    it('trims values and accepts remote onboarding with a web URL', () => {
        const input = { ...offerFixture, workMode: 'remote', location: '', meetingUrl: ' https://meet.example.com/intro ', contactName: ' Hà ' };
        expect(validateOffer(input).offer).toMatchObject({ contactName: 'Hà', meetingUrl: 'https://meet.example.com/intro' });
    });
    it('compares Vietnam wall-clock time independently of the server timezone', () => {
        const input = { ...offerFixture, startDate: '2026-10-01', startTime: '08:00', responseDeadline: '2026-10-01T07:30' };
        expect(validateOffer(input, Date.parse('2026-10-01T00:00:00Z')).offer).toEqual(input);
        expect(validateOffer(input, Date.parse('2026-10-01T00:30:00Z')).error).toBeTruthy();
    });
    it('accepts the new offer event and old already-queued accepted events', () => {
        const old = eventExamples['application.decision_email_requested'];
        expect(() => assertEventPayload('application.decision_email_requested', old)).not.toThrow();
        expect(() => assertEventPayload('application.decision_email_requested', { ...old, toStage: 'de_nghi', offer: offerFixture })).not.toThrow();
    });
});

// Each invalid input must fail for its own reason. Asserting only `expect.any(String)` lets a
// later check mask a broken earlier one (e.g. a past start date caught by the deadline rule).
describe('offer validation reports the specific rule that failed', () => {
    const E = {
        input: 'Vui lòng điền thông tin thư mời nhận việc',
        field: 'Thông tin thư mời không hợp lệ hoặc quá dài',
        required: 'Vui lòng điền đủ ngày giờ nhận việc, hình thức, người liên hệ và hạn phản hồi',
        timeZone: 'Thời gian nhận việc phải theo giờ Việt Nam (UTC+7)',
        start: 'Ngày hoặc giờ nhận việc không hợp lệ',
        deadlineFormat: 'Hạn phản hồi không hợp lệ',
        startPast: 'Thời gian nhận việc phải ở tương lai',
        deadline: 'Hạn phản hồi phải ở tương lai và không sau thời gian nhận việc',
        mode: 'Hình thức làm việc không hợp lệ',
        location: 'Vui lòng nhập địa điểm nhận việc cụ thể',
        urlRequired: 'Vui lòng nhập đường dẫn nhận việc trực tuyến',
        url: 'Đường dẫn trực tuyến phải là URL http hoặc https hợp lệ',
        email: 'Email người liên hệ không hợp lệ',
    };
    const remote = { ...offerFixture, workMode: 'remote', location: '' };

    it.each([
        ['undefined', undefined, E.input], ['null', null, E.input], ['an array', [], E.input], ['a string', 'offer', E.input],
        ['an unknown field', { ...offerFixture, surprise: 'x' }, E.field],
        ['a non-string field', { ...offerFixture, location: {} }, E.field],
        ['salary over 1000 chars', { ...offerFixture, salary: 'x'.repeat(1001) }, E.field],
        ['a field without maxLength over 100 chars', { ...offerFixture, workMode: 'x'.repeat(101) }, E.field],
        ['an empty object', {}, E.required],
        ['a blank contact name', { ...offerFixture, contactName: '   ' }, E.required],
        ['a non-Vietnam time zone', { ...offerFixture, timeZone: 'UTC' }, E.timeZone],
        ['an impossible start date', { ...offerFixture, startDate: '2099-02-30' }, E.start],
        ['a start date without zero padding', { ...offerFixture, startDate: '2099-1-5' }, E.start],
        ['an out-of-range start time', { ...offerFixture, startTime: '25:00' }, E.start],
        ['a deadline without time', { ...offerFixture, responseDeadline: '2099-10-18' }, E.deadlineFormat],
        ['an impossible deadline date', { ...offerFixture, responseDeadline: '2099-02-30T09:00' }, E.deadlineFormat],
        ['a deadline with an extra part', { ...offerFixture, responseDeadline: '2099-10-18T17:00T1' }, E.deadlineFormat],
        ['a past start date', { ...offerFixture, startDate: '2020-01-01' }, E.startPast],
        ['a deadline after the start', { ...offerFixture, responseDeadline: '2099-10-21T09:00' }, E.deadline],
        ['a past deadline', { ...offerFixture, responseDeadline: '2020-01-01T09:00' }, E.deadline],
        ['an unknown work mode', { ...offerFixture, workMode: 'other' }, E.mode],
        ['onsite without location', { ...offerFixture, location: '  ' }, E.location],
        ['hybrid without location', { ...offerFixture, workMode: 'hybrid', location: '' }, E.location],
        ['remote without meeting URL', remote, E.urlRequired],
        ['a javascript: URL', { ...remote, meetingUrl: 'javascript:alert(1)' }, E.url],
        ['an ftp URL', { ...remote, meetingUrl: 'ftp://files.example.vn/a' }, E.url],
        ['an unparsable URL', { ...remote, meetingUrl: 'not a url' }, E.url],
        ['a URL with credentials', { ...remote, meetingUrl: 'https://a:b@meet.example.vn' }, E.url],
        ['a URL with inner whitespace', { ...remote, meetingUrl: 'https://meet.example.vn/a b' }, E.url],
        ['a header-injection email', { ...offerFixture, contactEmail: 'hr@x.com\r\nBcc: x@evil.com' }, E.email],
        ['an email with a trailing newline', { ...offerFixture, contactEmail: 'hr@company.vn\n' }, E.email],
        ['an email list', { ...offerFixture, contactEmail: 'a@x.com,b@x.com' }, E.email],
        ['a leading dot', { ...offerFixture, contactEmail: '.hr@company.vn' }, E.email],
        ['a trailing dot', { ...offerFixture, contactEmail: 'hr.@company.vn' }, E.email],
        ['consecutive dots', { ...offerFixture, contactEmail: 'h..r@company.vn' }, E.email],
        ['a 65-char local part', { ...offerFixture, contactEmail: `${'a'.repeat(65)}@company.vn` }, E.email],
        ['a 64-char domain label', { ...offerFixture, contactEmail: `hr@${'b'.repeat(64)}.vn` }, E.email],
        ['a single-label domain', { ...offerFixture, contactEmail: 'hr@localhost' }, E.email],
    ])('rejects %s', (_case, input, expected) => {
        expect(validateOffer(input)).toEqual({ error: expected });
    });

    it.each([
        ['a 64-char local part', { ...offerFixture, contactEmail: `${'a'.repeat(64)}@company.vn` }],
        ['a 63-char domain label', { ...offerFixture, contactEmail: `hr@${'b'.repeat(63)}.vn` }],
        ['a plus-tagged address', { ...offerFixture, contactEmail: 'hr+offers@company.vn' }],
        ['hybrid work with a location', { ...offerFixture, workMode: 'hybrid' }],
        ['onsite work with an optional meeting URL', { ...offerFixture, meetingUrl: 'http://meet.example.vn/x' }],
        ['a field of exactly its max length', { ...offerFixture, salary: 'x'.repeat(1000) }],
    ])('accepts %s', (_case, input) => {
        expect(validateOffer(input)).toHaveProperty('offer');
    });

    describe('time boundaries in Vietnam time (UTC+7)', () => {
        const input = { ...offerFixture, startDate: '2030-05-10', startTime: '08:00', responseDeadline: '2030-05-09T17:00' };
        const start = Date.parse('2030-05-10T08:00:00+07:00');
        const deadline = Date.parse('2030-05-09T17:00:00+07:00');

        it('rejects a start exactly at the current instant', () => {
            expect(validateOffer({ ...input, responseDeadline: '2030-05-10T08:00' }, start)).toEqual({ error: E.startPast });
        });
        it('rejects a deadline exactly at the current instant but accepts one minute before it', () => {
            expect(validateOffer(input, deadline)).toEqual({ error: E.deadline });
            expect(validateOffer(input, deadline - 60_000)).toHaveProperty('offer');
        });
        it('accepts a deadline equal to the start and rejects one minute later', () => {
            expect(validateOffer({ ...input, responseDeadline: '2030-05-10T08:00' }, deadline)).toHaveProperty('offer');
            expect(validateOffer({ ...input, responseDeadline: '2030-05-10T08:01' }, deadline)).toEqual({ error: E.deadline });
        });
    });
});
