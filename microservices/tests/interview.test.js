import { describe, expect, it } from 'vitest';
import { validateInterview } from '../application-service/src/libs/interview.js';
import { interviewFixture } from './interviewFixture.js';
import { assertEventPayload } from '../shared/eventContract.js';
import { eventExamples } from '../shared/contracts/eventCatalog.js';

describe('interview invitation validation', () => {
    it.each([
        undefined, [], {}, { ...interviewFixture, location: ' ' }, { ...interviewFixture, interviewDate: '2099-02-30' },
        { ...interviewFixture, interviewTime: '24:00' }, { ...interviewFixture, interviewDate: '2020-01-01' },
        { ...interviewFixture, timeZone: 'UTC' }, { ...interviewFixture, interviewMode: 'video' },
        { ...interviewFixture, interviewMode: 'online' }, { ...interviewFixture, interviewMode: 'phone', contactPhone: ' ' },
        { ...interviewFixture, interviewMode: 'online', meetingUrl: 'javascript:alert(1)' },
        { ...interviewFixture, interviewMode: 'online', meetingUrl: 'https://a:b@meet.example.com' },
        { ...interviewFixture, durationMinutes: '5' }, { ...interviewFixture, durationMinutes: '600' }, { ...interviewFixture, durationMinutes: '1.5' },
        { ...interviewFixture, confirmBy: '2099-10-16T09:00' }, { ...interviewFixture, confirmBy: '2020-01-01T09:00' },
        { ...interviewFixture, confirmBy: '2099-10-13' }, { ...interviewFixture, confirmBy: '2099-10-13T17:00T1' },
        { ...interviewFixture, contactEmail: 'hr@x.com\r\nBcc: x@evil.com' }, { ...interviewFixture, contactEmail: 'a@x.com,b@x.com' },
        { ...interviewFixture, contactName: ' ' }, { ...interviewFixture, preparation: 'x'.repeat(3001) },
        { ...interviewFixture, location: {} }, { ...interviewFixture, salary: 'unknown field' }
    ])('rejects malformed or incomplete invitation %#', (interview) => {
        expect(validateInterview(interview).error).toEqual(expect.any(String));
    });

    it('trims values, drops blank optional fields and keeps only the chosen mode logistics', () => {
        const online = validateInterview({ ...interviewFixture, interviewMode: 'online', meetingUrl: ' https://meet.example.com/abc ',
            contactName: ' Hà ', round: ' ', interviewers: '' }).interview;
        expect(online).toMatchObject({ contactName: 'Hà', meetingUrl: 'https://meet.example.com/abc' });
        expect(online).not.toHaveProperty('location');
        expect(online).not.toHaveProperty('round');
        expect(online).not.toHaveProperty('interviewers');
        const phone = validateInterview({ ...interviewFixture, interviewMode: 'phone', meetingUrl: 'https://meet.example.com/abc' }).interview;
        expect(phone).not.toHaveProperty('location');
        expect(phone).not.toHaveProperty('meetingUrl');
        expect(phone.contactPhone).toBe(interviewFixture.contactPhone);
        expect(validateInterview(interviewFixture).interview).toEqual(interviewFixture);
    });

    it('compares Vietnam wall-clock time independently of the server timezone', () => {
        const input = { ...interviewFixture, interviewDate: '2026-10-01', interviewTime: '08:00', confirmBy: '2026-10-01T07:30' };
        expect(validateInterview(input, Date.parse('2026-10-01T00:00:00Z')).interview).toEqual(input);
        expect(validateInterview(input, Date.parse('2026-10-01T00:30:00Z')).error).toBeTruthy();
        expect(validateInterview(input, Date.parse('2026-10-01T01:00:00Z')).error).toBeTruthy();
    });

    it('accepts the invitation event and additive interview fields on existing result events', () => {
        const invitation = eventExamples['application.interview_invitation_requested'];
        expect(() => assertEventPayload('application.interview_invitation_requested', invitation)).not.toThrow();
        expect(() => assertEventPayload('application.interview_invitation_requested', { ...invitation, interview: interviewFixture })).not.toThrow();
        expect(() => assertEventPayload('application.interview_invitation_requested', { ...invitation, toStage: 'de_nghi' })).toThrow();
        expect(() => assertEventPayload('application.interview_invitation_requested', { ...invitation, interview: { ...interviewFixture, interviewMode: 'online' } })).toThrow();
        const decision = eventExamples['application.decision_email_requested'];
        expect(() => assertEventPayload('application.decision_email_requested', { ...decision, decision: 'rejected', toStage: 'tu_choi',
            interviewed: true, interview: interviewFixture, companyName: interviewFixture.companyName })).not.toThrow();
        const stage = eventExamples['application.stage_changed'];
        expect(() => assertEventPayload('application.stage_changed', { ...stage, toStage: 'tu_choi', interviewed: true })).not.toThrow();
    });
});

// Table of invalid invitations with the exact rule each one must trip (see offer.test.js).
describe('interview validation reports the specific rule that failed', () => {
    const E = {
        input: 'Vui lòng điền thông tin thư mời phỏng vấn',
        field: 'Thông tin thư mời phỏng vấn không hợp lệ hoặc quá dài',
        required: 'Vui lòng điền đủ ngày giờ phỏng vấn, hình thức và người liên hệ',
        timeZone: 'Thời gian phỏng vấn phải theo giờ Việt Nam (UTC+7)',
        when: 'Ngày hoặc giờ phỏng vấn không hợp lệ',
        past: 'Thời gian phỏng vấn phải ở tương lai',
        duration: 'Thời lượng phỏng vấn phải từ 15 đến 480 phút',
        mode: 'Hình thức phỏng vấn không hợp lệ',
        location: 'Vui lòng nhập địa điểm phỏng vấn cụ thể',
        url: 'Vui lòng nhập đường dẫn phỏng vấn trực tuyến',
        phone: 'Vui lòng nhập số điện thoại sẽ liên hệ phỏng vấn',
        urlFormat: 'Đường dẫn trực tuyến phải là URL http hoặc https hợp lệ',
        email: 'Email người liên hệ không hợp lệ',
        confirmFormat: 'Hạn xác nhận tham gia không hợp lệ',
        confirm: 'Hạn xác nhận phải ở tương lai và không sau giờ phỏng vấn',
    };
    const online = { ...interviewFixture, interviewMode: 'online', location: '' };

    it.each([
        ['null', null, E.input], ['an array', [], E.input],
        ['an unknown field', { ...interviewFixture, extra: 'x' }, E.field],
        ['a numeric duration', { ...interviewFixture, durationMinutes: 60 }, E.field],
        ['a field without maxLength over 100 chars', { ...interviewFixture, interviewMode: 'x'.repeat(101) }, E.field],
        ['a blank contact name', { ...interviewFixture, contactName: ' ' }, E.required],
        ['a missing interview date', { ...interviewFixture, interviewDate: '' }, E.required],
        ['a UTC time zone', { ...interviewFixture, timeZone: 'UTC' }, E.timeZone],
        ['an impossible date', { ...interviewFixture, interviewDate: '2099-02-29' }, E.when],
        ['an out-of-range minute', { ...interviewFixture, interviewTime: '09:60' }, E.when],
        ['a past interview', { ...interviewFixture, interviewDate: '2020-01-01' }, E.past],
        ['a 14 minute duration', { ...interviewFixture, durationMinutes: '14' }, E.duration],
        ['a 481 minute duration', { ...interviewFixture, durationMinutes: '481' }, E.duration],
        ['a zero-padded duration', { ...interviewFixture, durationMinutes: '060' }, E.duration],
        ['a fractional duration', { ...interviewFixture, durationMinutes: '30.5' }, E.duration],
        ['an unknown mode', { ...interviewFixture, interviewMode: 'video' }, E.mode],
        ['onsite without location', { ...interviewFixture, location: '   ' }, E.location],
        ['online without URL', online, E.url],
        ['phone without a phone number', { ...interviewFixture, interviewMode: 'phone', contactPhone: '' }, E.phone],
        ['online with an unparsable URL', { ...online, meetingUrl: 'meet now' }, E.urlFormat],
        ['online with a data: URL', { ...online, meetingUrl: 'data:text/html,hi' }, E.urlFormat],
        ['an injected contact email', { ...interviewFixture, contactEmail: 'hr@x.vn\nBcc: a@b.vn' }, E.email],
        ['a confirm-by date without time', { ...interviewFixture, confirmBy: '2099-10-13' }, E.confirmFormat],
        ['a confirm-by with an extra part', { ...interviewFixture, confirmBy: '2099-10-13T17:00T1' }, E.confirmFormat],
        ['a confirm-by after the interview', { ...interviewFixture, confirmBy: '2099-10-16T09:00' }, E.confirm],
        ['a past confirm-by', { ...interviewFixture, confirmBy: '2020-01-01T09:00' }, E.confirm],
    ])('rejects %s', (_case, input, expected) => {
        expect(validateInterview(input)).toEqual({ error: expected });
    });

    it.each([['15', '15'], ['480', '480'], ['99', '99']])('accepts the duration boundary %s minutes', (duration) => {
        expect(validateInterview({ ...interviewFixture, durationMinutes: duration }).interview.durationMinutes).toBe(duration);
    });

    it('ignores the URL of another mode instead of validating or e-mailing it', () => {
        const result = validateInterview({ ...interviewFixture, meetingUrl: 'not a url' });
        expect(result.interview).not.toHaveProperty('meetingUrl');
        expect(validateInterview({ ...interviewFixture, interviewMode: 'phone' }).interview).not.toHaveProperty('location');
    });

    describe('time boundaries in Vietnam time (UTC+7)', () => {
        const input = { ...interviewFixture, interviewDate: '2030-03-01', interviewTime: '09:00', confirmBy: '2030-02-28T17:00' };
        const start = Date.parse('2030-03-01T09:00:00+07:00');
        const confirmBy = Date.parse('2030-02-28T17:00:00+07:00');

        it('rejects an interview exactly now and accepts one a minute later', () => {
            const { confirmBy: _omit, ...withoutConfirm } = input;
            expect(validateInterview(withoutConfirm, start)).toEqual({ error: E.past });
            expect(validateInterview(withoutConfirm, start - 60_000)).toHaveProperty('interview');
        });
        it('rejects a confirm-by exactly now and accepts a confirm-by equal to the interview start', () => {
            expect(validateInterview(input, confirmBy)).toEqual({ error: E.confirm });
            expect(validateInterview({ ...input, confirmBy: '2030-03-01T09:00' }, confirmBy)).toHaveProperty('interview');
            expect(validateInterview({ ...input, confirmBy: '2030-03-01T09:01' }, confirmBy)).toEqual({ error: E.confirm });
        });
    });
});
