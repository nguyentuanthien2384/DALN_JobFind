// Interview times are Vietnam wall-clock times, independent of server TZ.
const text = (maxLength, required = false) => ({ type: 'string', maxLength, ...(required ? { minLength: 1, pattern: '\\S' } : {}) });
export const interviewSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        companyName: text(255, true),
        interviewDate: { type: 'string', format: 'date' },
        interviewTime: { type: 'string', pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' },
        durationMinutes: { type: 'string', pattern: '^[1-9][0-9]{1,2}$' },
        timeZone: { const: 'Asia/Ho_Chi_Minh' },
        interviewMode: { enum: ['onsite', 'online', 'phone'] },
        location: text(1000), meetingUrl: text(2000),
        round: text(150), interviewers: text(500), preparation: text(3000),
        contactName: text(150, true), contactEmail: { ...text(254, true), format: 'email' }, contactPhone: text(50),
        confirmBy: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]$' }
    },
    required: ['companyName', 'interviewDate', 'interviewTime', 'timeZone', 'interviewMode', 'contactName', 'contactEmail'],
    allOf: [
        { if: { properties: { interviewMode: { const: 'onsite' } } }, then: { required: ['location'], properties: { location: text(1000, true) } } },
        { if: { properties: { interviewMode: { const: 'online' } } }, then: { required: ['meetingUrl'], properties: { meetingUrl: text(2000, true) } } },
        { if: { properties: { interviewMode: { const: 'phone' } } }, then: { required: ['contactPhone'], properties: { contactPhone: text(50, true) } } }
    ]
};
