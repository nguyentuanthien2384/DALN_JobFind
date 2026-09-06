// Frozen payload-v1 wire contracts, independent of HTTP DTOs and DB models.
// Additive fields are accepted; changing/removing fields requires a new version.
const string = (maxLength = 1000000) => ({ type: 'string', maxLength });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
const list = (items) => ({ type: 'array', items, maxItems: 1000 });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const id = { anyOf: [integer(1), { type: 'string', pattern: '^[1-9][0-9]{0,15}$', format: 'jobfind-id' }] };
const token = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$', maxLength: 128 };
const taskId = { ...token, maxLength: 64 };
const requestId = { type: 'string', pattern: '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' };
const bool = { type: 'boolean' };
const notificationPolicy = { const: 'approval-v1' };
const date = { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'string', format: 'date' }] };
const optionalText = nullable(string());
const stages = ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'];
const stage = { type: 'string', enum: stages };
const job = object({ id, name: optionalText, statusCode: { enum: ['PS1', 'PS2', 'PS3', 'PS4'] },
    descriptionHTML: optionalText, descriptionMarkdown: optionalText, userId: nullable(id), companyId: nullable(id),
    companyName: optionalText, companyLogo: nullable(string(50 * 1024 * 1024)),
    companyStatusCode: nullable(string(64)), companyCensorCode: nullable(string(64)),
    timePost: { anyOf: [integer(), string(32), { type: 'null' }] }, timeEnd: { anyOf: [integer(), string(32), { type: 'null' }] },
    isHot: { anyOf: [bool, { enum: [0, 1] }] }
}, ['id', 'name', 'statusCode']);
const application = { applicationId: id, candidateId: id, candidateEmail: optionalText, candidateName: optionalText,
    jobId: id, jobTitle: optionalText, companyId: nullable(id), companyName: optionalText,
    fromStage: nullable(stage), toStage: stage, reason: optionalText };
const cvResult = object({ fullName: optionalText, email: optionalText, phone: optionalText, address: optionalText,
    title: optionalText, summary: optionalText, yearsOfExperience: nullable({ type: 'number', minimum: 0, maximum: 100 }),
    skills: list(string()), languages: list(string()),
    experiences: list(object({ company: optionalText, position: optionalText, duration: optionalText, description: optionalText })),
    educations: list(object({ school: optionalText, major: optionalText, degree: optionalText, year: optionalText }))
}, ['fullName', 'skills']);
const resultSchemas = {
    parse_resume: cvResult,
    match_cv: object({ score: integer(0, 100), verdict: { enum: ['rat_phu_hop', 'phu_hop', 'can_can_nhac', 'chua_phu_hop'] },
        matchedSkills: list(string()), missingSkills: list(string()), strengths: list(string()), concerns: list(string()), summary: string() }, ['score']),
    cover_letter: object({ letter: string(), language: string(32), wordCount: integer() }, ['letter']),
    moderate_job: object({ approved: bool, reason: optionalText, riskLevel: { enum: ['an_toan', 'can_xem_lai', 'nguy_hiem'] }, violations: list(string(100)) }, ['approved'])
};
const aiResult = { oneOf: Object.entries(resultSchemas).map(([type, result]) => ({
    ...object({ type: { const: type }, ok: bool, result, error: string(1000000),
        ...(type === 'moderate_job' ? { jobId: id, taskId: { type: 'null' }, moderationRequestId: requestId } : { taskId, jobId: nullable(id) })
    }, ['type', 'ok', ...(type === 'moderate_job' ? ['jobId', 'moderationRequestId'] : ['taskId'])]),
    allOf: [{ if: { properties: { ok: { const: true } }, required: ['ok'] }, then: { required: ['result'], properties: { result: {}, error: false } }, else: { required: ['error'], properties: { error: {}, result: false } } }]
})) };
const metadata = (schema, aggregateField, producers, consumers, maxBytes = 64 * 1024 * 1024) => ({
    payloadVersion: 1, schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema }, aggregateField,
    producers, consumers: [...consumers, 'admin-service.audit'], maxBytes
});
const base = { jobId: 7, candidateId: 9, candidateName: 'Ứng viên mẫu', candidateEmail: 'candidate@example.invalid', jobTitle: 'Developer' };
const moderationRequestId = '11111111-1111-4111-8111-111111111111';

export const eventCatalog = {
    'job.created': metadata(object({ job, notificationPolicy }, ['job']), 'job.id', ['job-core-service', 'legacy-backend'], ['search-service.indexer', 'notification-service.events']),
    'job.updated': metadata(object({ job }, ['job']), 'job.id', ['job-core-service', 'legacy-backend'], ['search-service.indexer']),
    'job.deleted': metadata(object({ jobId: id }, ['jobId']), 'jobId', ['job-core-service'], ['search-service.indexer']),
    'company.updated': metadata(object({ companyId: id, companyStatusCode: nullable(string(64)), companyCensorCode: nullable(string(64)) }, ['companyId']), 'companyId', ['legacy-backend'], ['search-service.indexer']),
    'notification.manual_moderation_requested': metadata({
        ...object({ decisionId: requestId, jobId: id, recipientId: id,
            audience: { enum: ['author', 'follower'] }, action: { enum: ['approve', 'reject', 'ban', 'reopen'] },
            jobTitle: nullable(string(255)), companyName: nullable(string(255)), note: nullable(string(255))
        }, ['decisionId', 'jobId', 'recipientId', 'audience', 'action', 'jobTitle', 'companyName', 'note']),
        allOf: [{ if: { properties: { audience: { const: 'follower' } }, required: ['audience'] },
            then: { properties: { action: { const: 'approve' }, note: { type: 'null' } } },
            else: { properties: { note: { type: 'string', minLength: 1, maxLength: 255 } } } }]
    }, 'jobId', ['legacy-backend'], ['notification-service.events'], 16 * 1024),
    'notification.job_approved_requested': metadata(object({ decisionId: requestId, jobId: id, recipientId: id,
        jobTitle: nullable(string(255)), companyName: nullable(string(255))
    }, ['decisionId', 'jobId', 'recipientId', 'jobTitle', 'companyName']), 'jobId', ['job-core-service'], ['notification-service.events'], 16 * 1024),
    'job.moderated': metadata({ ...object({ jobId: id, posterId: nullable(id), jobTitle: optionalText, approved: bool, statusCode: { enum: ['PS1', 'PS2'] }, reason: optionalText, moderationRequestId: requestId }, ['jobId', 'approved', 'statusCode']),
        allOf: [{ if: { properties: { approved: { const: true } }, required: ['approved'] }, then: { properties: { statusCode: { const: 'PS1' } } }, else: { properties: { statusCode: { const: 'PS2' } } } }]
    }, 'jobId', ['job-core-service'], ['search-service.indexer', 'notification-service.events']),
    'ai.moderate_job': metadata(object({ jobId: id, taskId: { type: 'null' }, name: string(), descriptionHTML: string(), moderationRequestId: requestId, notificationPolicy }, ['jobId', 'name', 'descriptionHTML', 'moderationRequestId']), 'jobId', ['job-core-service'], ['ai-worker.jobs'], 8 * 1024 * 1024),
    'ai.parse_resume': metadata(object({ taskId, jobId: nullable(id), fileBase64: { ...string(8 * 1024 * 1024), minLength: 1, pattern: '\\S' }, fileName: nullable(string()) }, ['taskId', 'fileBase64']), 'taskId', ['job-core-service'], ['ai-worker.jobs'], 8 * 1024 * 1024),
    'ai.match_cv': metadata(object({ taskId, jobId: nullable(id), resumeText: string(), jobTitle: string(), jobDescription: string() }, ['taskId', 'resumeText', 'jobTitle', 'jobDescription']), 'taskId', ['job-core-service'], ['ai-worker.jobs'], 8 * 1024 * 1024),
    'ai.cover_letter': metadata(object({ taskId, jobId: nullable(id), resumeText: string(), jobTitle: string(), jobDescription: string(), companyName: optionalText, language: string(32) }, ['taskId', 'resumeText', 'jobTitle', 'jobDescription']), 'taskId', ['job-core-service'], ['ai-worker.jobs'], 8 * 1024 * 1024),
    'ai.result': metadata(aiResult, { moderate_job: 'jobId', parse_resume: 'taskId', match_cv: 'taskId', cover_letter: 'taskId' }, ['ai-worker'], ['job-core-service.ai-results'], 1024 * 1024),
    'application.stage_changed': metadata(object(application, ['applicationId', 'candidateId', 'jobId', 'fromStage', 'toStage']), 'applicationId', ['application-service'], ['notification-service.events']),
    'application.decision_email_requested': metadata({ ...object({ ...application, decision: { enum: ['accepted', 'rejected'] }, message: optionalText }, ['applicationId', 'candidateId', 'jobId', 'decision', 'toStage']),
        allOf: [{ if: { properties: { decision: { const: 'accepted' } }, required: ['decision'] }, then: { properties: { toStage: { const: 'nhan_viec' } } }, else: { properties: { toStage: { const: 'tu_choi' } } } }]
    }, 'applicationId', ['application-service'], ['notification-service.events']),
    'application.submitted': metadata(object({ cvId: id, jobId: id, candidateId: id, companyId: id, posterId: nullable(id),
        jobTitle: optionalText, candidateName: optionalText, candidateEmail: optionalText, candidatePhone: optionalText, coverLetter: optionalText, appliedAt: nullable(date)
    }, ['cvId', 'jobId', 'candidateId', 'companyId']), 'cvId', ['legacy-backend'], ['application-service.submissions', 'notification-service.events'])
};

// Synthetic contract fixtures, never customer data or live addresses.
export const eventExamples = {
    'job.created': { job: { id: 7, name: 'Developer', statusCode: 'PS3', companyId: 3, companyName: 'Example' } },
    'job.updated': { job: { id: 7, name: 'Developer', statusCode: 'PS1', companyId: 3 } },
    'job.deleted': { jobId: 7 }, 'company.updated': { companyId: 3, companyStatusCode: 'S1', companyCensorCode: 'CS1' },
    'notification.manual_moderation_requested': { decisionId: moderationRequestId, jobId: 7, recipientId: 5,
        audience: 'author', action: 'approve', jobTitle: 'Developer', companyName: 'Example', note: 'Đã duyệt bài thành công' },
    'job.moderated': { jobId: 7, posterId: 5, jobTitle: 'Developer', approved: true, statusCode: 'PS1', reason: 'OK', moderationRequestId },
    'notification.job_approved_requested': { decisionId: moderationRequestId, jobId: 7, recipientId: 9, jobTitle: 'Developer', companyName: 'Example' },
    'ai.moderate_job': { jobId: 7, name: 'Developer', descriptionHTML: '<p>Build services</p>', moderationRequestId },
    'ai.parse_resume': { taskId: 'task-1', fileBase64: 'c3ludGhldGlj', fileName: 'example.pdf' },
    'ai.match_cv': { taskId: 'task-1', resumeText: 'Synthetic CV', jobTitle: 'Developer', jobDescription: 'Build services' },
    'ai.cover_letter': { taskId: 'task-1', resumeText: 'Synthetic CV', jobTitle: 'Developer', jobDescription: 'Build services', companyName: 'Example', language: 'en' },
    'ai.result': { taskId: 'task-1', type: 'match_cv', ok: true, result: { score: 80, matchedSkills: ['Node'] } },
    'application.stage_changed': { ...base, applicationId: 31, fromStage: 'moi_ung_tuyen', toStage: 'phong_van', reason: null },
    'application.decision_email_requested': { ...base, applicationId: 31, companyId: 3, fromStage: null, toStage: 'nhan_viec', decision: 'accepted', message: 'Congratulations' },
    'application.submitted': { ...base, cvId: 21, companyId: 3, posterId: 5, candidatePhone: null, coverLetter: 'Synthetic letter', appliedAt: '2026-09-05T00:00:00.000Z' }
};
