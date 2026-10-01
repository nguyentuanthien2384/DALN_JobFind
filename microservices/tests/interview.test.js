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
