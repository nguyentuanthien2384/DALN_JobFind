// Transport schemas. No type coercion, defaults, or silent property removal.
export const text = (maxLength = 255) => ({ type: 'string', maxLength });
export const nonblank = (maxLength = 255) => ({ ...text(maxLength), minLength: 1, pattern: '\\S' });
export const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const object = (properties = {}, required = [], additionalProperties = false) => ({ type: 'object', properties, required, additionalProperties });
export const array = (items, maxItems = 100) => ({ type: 'array', items, maxItems });
export const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
export const idString = { type: 'string', pattern: '^[1-9][0-9]{0,15}$', format: 'jobfind-id' };
export const id = { anyOf: [integer(1), idString] };
export const mongoId = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' };
export const eventId = { ...text(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' };
export const requestKey = { ...text(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
export const taskId = { ...eventId, maxLength: 64 };
export const date = { anyOf: [{ type: 'string', format: 'date' }, { type: 'string', format: 'date-time' }] };
export const stage = { type: 'string', enum: ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'] };
const optionalText = (max) => nullable(text(max));
const listOfText = array(nonblank(255));
const experience = object({ company: optionalText(255), position: optionalText(255), from: optionalText(100), to: optionalText(100), description: optionalText(10000) });
const education = object({ school: optionalText(255), major: optionalText(255), degree: optionalText(255), year: optionalText(100) });
const cvFields = {
    title: optionalText(255), template: optionalText(100), fullName: optionalText(255), email: optionalText(320),
    phone: optionalText(100), address: optionalText(1000), summary: optionalText(20000), skills: listOfText,
    languages: listOfText, experiences: array(experience), educations: array(education)
};
const parsed = object({
    ...cvFields, yearsOfExperience: nullable({ type: 'number', minimum: 0, maximum: 100 }),
    experiences: array(object({ company: optionalText(255), position: optionalText(255), duration: optionalText(255), description: optionalText(10000) }))
});
const jobFields = {
    name: nonblank(255), descriptionHTML: nonblank(200000), descriptionMarkdown: text(200000),
    categoryJobCode: nonblank(64), addressCode: optionalText(64), salaryJobCode: optionalText(64),
    amount: { anyOf: [integer(1, 100000), { type: 'string', pattern: '^(100000|[1-9][0-9]{0,4})$' }] },
    categoryJoblevelCode: optionalText(64), categoryWorktypeCode: optionalText(64), experienceJobCode: optionalText(64)
};
// Query values remain strings; controllers already parse them. Arrays/objects are rejected.
export const queryNumber = (max) => ({ type: 'string', pattern: '^(0|[1-9][0-9]*)$', maxLength: String(max).length, format: `jobfind-uint-${max}` });
export const schemas = {
    Empty: object(),
    JobCreate: object({ ...jobFields, genderPostCode: optionalText(64),
        timeEnd: { anyOf: [integer(1, 8640000000000000), { type: 'string', pattern: '^[1-9][0-9]{0,15}$', format: 'jobfind-id' }] },
        isHot: { anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [0, 1] }] }
    }, ['name', 'descriptionHTML', 'categoryJobCode']),
    // Only fields actually written by updateJob are accepted. No ignored isHot/timeEnd/statusCode.
    JobUpdate: { ...object(jobFields), minProperties: 1 },
    ParseResume: object({ fileBase64: nonblank(8 * 1024 * 1024), fileName: optionalText(255) }, ['fileBase64']),
    MatchCv: object({ resumeText: nonblank(500000), jobId: id }, ['resumeText', 'jobId']),
    CoverLetter: object({ resumeText: nonblank(500000), jobId: id, language: optionalText(32) }, ['resumeText', 'jobId']),
    ProfileUpdate: { ...object({ headline: optionalText(255), about: optionalText(20000), skills: listOfText,
        email: optionalText(320), firstName: optionalText(255), lastName: optionalText(255), phonenumber: optionalText(100),
        jobPreference: object({ categoryJobCode: optionalText(64), addressCode: optionalText(64), salaryJobCode: optionalText(64), experienceJobCode: optionalText(64), isFindJob: { type: 'boolean' }, isTakeMail: { type: 'boolean' } })
    }), minProperties: 1 },
    CvCreate: object({ ...cvFields, parsedFrom: object({ fileName: optionalText(255), parsedAt: date, raw: parsed }) }),
    CvUpdate: { ...object(cvFields), minProperties: 1 },
    CvImport: object({ parsed, fileName: optionalText(255) }, ['parsed']),
    MoveStage: object({ stage, reason: optionalText(5000) }, ['stage']),
    Decision: object({ decision: { type: 'string', enum: ['accepted', 'rejected'] }, message: optionalText(3000) }, ['decision']),
    Rating: object({ rating: { anyOf: [integer(1, 5), { type: 'string', pattern: '^[1-5]$' }] } }, ['rating']),
    Note: object({ body: nonblank(5000) }, ['body']),
    TalentSave: object({ candidateId: id, candidateName: optionalText(255), tags: array(nonblank(100), 50), note: optionalText(5000) }, ['candidateId']),
    TagSave: object({ type: nonblank(64), code: nullable(nonblank(64)), name: optionalText(255), aliases: array(nonblank(255)),
        group: optionalText(255), weight: { type: 'number', minimum: -1000000, maximum: 1000000 }, isActive: { type: 'boolean' }, description: optionalText(10000)
    }, ['type']),
    AuditAction: object({ method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] }, route: nonblank(2048),
        actorId: nullable(id), actorRole: nullable(text(32)), companyId: nullable(id), targetType: optionalText(64), targetId: nullable(eventId),
        status: integer(100, 599), durationMs: { type: 'number', minimum: 0, maximum: 86400000 }, ip: text(128), correlationId: nullable(requestKey)
    }, ['method', 'route', 'status', 'durationMs']),
    SearchQuery: object({ q: text(500), categoryJobCode: text(64), addressCode: text(64), salaryJobCode: text(64), categoryJoblevelCode: text(64),
        categoryWorktypeCode: text(64), experienceJobCode: text(64), isHot: { type: 'string', enum: ['1', '0', 'true', 'false', ''] },
        sort: { type: 'string', enum: ['newest', 'relevance'] }, limit: queryNumber(100), offset: queryNumber(10000)
    }),
    ApplicationQuery: object({ jobId: idString, stage, minRating: { type: 'string', pattern: '^[1-5]$' }, q: text(500), limit: queryNumber(100), offset: queryNumber(1000000) }),
    AuditQuery: object({ kind: { type: 'string', enum: ['event', 'action'] }, name: text(200), actorId: idString, targetType: text(64),
        targetId: eventId, correlationId: requestKey, eventId, fromDate: date, toDate: date, limit: queryNumber(200), offset: queryNumber(1000000)
    }),
    RangeQuery: object({ fromDate: date, toDate: date }),
    Error: object({ errCode: { type: 'integer' }, errMessage: text(1000), requestId: requestKey }, ['errCode'], true),
    Ack: object({ errCode: { const: 0 }, errMessage: text(1000) }, ['errCode'], true),
    AcceptedTask: object({ errCode: { const: 0 }, taskId, errMessage: text(1000) }, ['errCode', 'taskId']),
    Task: object({ id: taskId, type: { type: 'string', enum: ['parse_resume', 'match_cv', 'cover_letter'] },
        status: { type: 'string', enum: ['pending', 'done', 'failed'] }, result: {}, error: optionalText(20000), createdAt: date, updatedAt: date
    }, ['id', 'type', 'status', 'result', 'error', 'createdAt', 'updatedAt']),
    Job: object({ id, name: text(255), descriptionHTML: text(200000), statusCode: { type: 'string', enum: ['PS1', 'PS2', 'PS3', 'PS4'] },
        userId: nullable(id), companyId: nullable(id), companyName: optionalText(255) }, ['id', 'name', 'statusCode'], true),
    Cv: object({ ...cvFields, _id: mongoId, createdAt: date, updatedAt: date }, ['_id'], true),
    Profile: object({ legacyUserId: id, roleCode: text(32), companyId: nullable(id), cvs: { type: 'array', items: { $ref: '#/$defs/Cv' } } }, ['legacyUserId'], true),
    Application: object({ id, job_id: id, candidate_id: id, company_id: id, stage, rating: nullable(integer(1, 5)) }, ['id', 'stage'], true),
    Record: { type: 'object', additionalProperties: true }
};
