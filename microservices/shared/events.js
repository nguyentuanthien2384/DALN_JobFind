// Danh muc su kien dung chung cho ca he thong.
//
// Gom mot cho de khong bi lech ten giua ben publish va ben consume - loi kieu
// do rat kho phat hien vi RabbitMQ khong bao gi ca, tin nhan chi lang le roi vao
// hu khong.

export const EXCHANGE = 'jobportal.events';

export const EVENTS = {
    // Job Core (ben Ghi) phat ra khi tin tuyen dung thay doi.
    JOB_CREATED: 'job.created',
    JOB_UPDATED: 'job.updated',
    JOB_DELETED: 'job.deleted',

    // AI Worker phat ra sau khi kiem duyet xong noi dung tin.
    JOB_MODERATED: 'job.moderated',

    // Yeu cau gui cho AI Worker.
    AI_MODERATE_JOB: 'ai.moderate_job',
    AI_PARSE_RESUME: 'ai.parse_resume',
    AI_MATCH_CV: 'ai.match_cv',
    AI_COVER_LETTER: 'ai.cover_letter',

    // AI Worker tra ket qua ve.
    AI_RESULT: 'ai.result',

    // Application & Workflow Service phat ra khi ho so chuyen buoc trong pipeline.
    // Notification Service se dung su kien nay de bao cho ung vien.
    APPLICATION_STAGE_CHANGED: 'application.stage_changed',

    // Backend cu phat ra khi ung vien nop CV. Frontend van nop qua backend cu nen
    // day la duong duy nhat de Application Service biet co ho so moi.
    APPLICATION_SUBMITTED: 'application.submitted'
};

// Ten hang doi cua tung service. Dat ten ro rang de nhin bang quan tri RabbitMQ
// la biet ngay hang doi nao dang un.
export const QUEUES = {
    SEARCH_INDEXER: 'search-service.indexer',
    AI_WORKER: 'ai-worker.jobs',
    AI_RESULT_HANDLER: 'job-core-service.ai-results'
};
