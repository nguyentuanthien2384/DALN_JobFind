import { createHash } from 'node:crypto';

// Keep this protocol identical in backend/src/utils/jobRevision.js and
// microservices/shared/jobRevision.js. Cross-writer tests enforce byte equality.
// This is an opaque state fingerprint, NOT an authorization token or event clock.
const detailFields = [
    'name', 'descriptionHTML', 'descriptionMarkdown', 'categoryJobCode', 'addressCode',
    'salaryJobCode', 'amount', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode'
];
export const isJobRevision = value => typeof value === 'string' && /^jv1-[a-f0-9]{64}$/.test(value);
const scalar = value => value == null ? null : String(value);
export const jobRevision = (post, detail = post) => {
    const detailId = post.detailPostId ?? (detail === post ? undefined : detail?.id);
    if (![post.id, detailId].every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)) return null;
    const values = [
        'job-edit-v1', String(post.id), String(detailId), scalar(post.userId),
        scalar(post.statusCode), scalar(post.timeEnd),
        post.isHot == null ? null : String(Number(post.isHot)),
        ...detailFields.map(field => field === 'amount' && detail[field] != null
            ? String(Number(detail[field])) : scalar(detail[field]))
    ];
    return 'jv1-' + createHash('sha256').update(JSON.stringify(values)).digest('hex');
};
