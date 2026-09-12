// Local wall-clock times are explicitly Vietnam time, independent of server TZ.
const text = (maxLength, required = false) => ({ type: 'string', maxLength, ...(required ? { minLength: 1, pattern: '\\S' } : {}) });
export const offerSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        companyName: text(255, true),
        startDate: { type: 'string', format: 'date' },
        startTime: { type: 'string', pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' },
        timeZone: { const: 'Asia/Ho_Chi_Minh' },
        responseDeadline: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]$' },
        workMode: { enum: ['onsite', 'remote', 'hybrid'] },
        location: text(1000), meetingUrl: text(2000),
        contactName: text(150, true), contactEmail: { ...text(254, true), format: 'email' }, contactPhone: text(50),
        workSchedule: text(500), salary: text(1000), probation: text(1000),
        benefits: text(3000), requiredDocuments: text(3000), onboardingInstructions: text(3000)
    },
    required: ['companyName', 'startDate', 'startTime', 'timeZone', 'responseDeadline', 'workMode', 'contactName', 'contactEmail'],
    allOf: [
        { if: { properties: { workMode: { enum: ['onsite', 'hybrid'] } } }, then: { required: ['location'], properties: { location: text(1000, true) } } },
        { if: { properties: { workMode: { const: 'remote' } } }, then: { required: ['meetingUrl'], properties: { meetingUrl: text(2000, true) } } }
    ]
};
