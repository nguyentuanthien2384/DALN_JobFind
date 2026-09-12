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
