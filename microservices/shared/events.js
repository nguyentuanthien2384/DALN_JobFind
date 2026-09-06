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
    COMPANY_UPDATED: 'company.updated',

    // AI Worker phat ra sau khi kiem duyet xong noi dung tin.
    JOB_MODERATED: 'job.moderated',
    // One durable recipient intent per accepted legacy manual decision.
    MANUAL_MODERATION_NOTIFICATION_REQUESTED: 'notification.manual_moderation_requested',
    // One frozen follower intent per accepted, policy-marked Core approval.
    JOB_APPROVAL_NOTIFICATION_REQUESTED: 'notification.job_approved_requested',

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

    // Nha tuyen dung gui ket qua cuoi cung (trung tuyen / tu choi) cho ung vien.
    // Tach rieng khoi su kien keo tha de co the gui lai email ma khong can doi
    // trang thai ho so them mot lan nua.
    APPLICATION_DECISION_EMAIL_REQUESTED: 'application.decision_email_requested',

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
