import { pool } from '../libs/db.js';
import { consume } from '../../../shared/rabbitmq.js';
import { EVENTS } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('application-service');

const QUEUE = 'application-service.submissions';

// Nhan ho so ung tuyen moi tu backend cu.
//
// Frontend van nop CV qua API cu (/api/create-new-cv), nen day la duong duy nhat
// de bang Kanban biet co ho so moi. Truoc khi co consumer nay, ho so chi vao
// pipeline luc service khoi dong - nha tuyen dung mo Kanban ra khong thay ai ung
// tuyen ca du man hinh cu van dem duoc.
export const startSubmissionConsumer = async () => {
    await consume(QUEUE, [EVENTS.APPLICATION_SUBMITTED], async (payload) => {
        const {
            cvId, jobId, jobTitle, candidateId, candidateName,
            candidateEmail, candidatePhone, companyId, coverLetter, appliedAt
        } = payload;

        if (!cvId || !companyId) {
            logger.warn('bo qua ho so thieu du lieu', { cvId, companyId });
            return;
        }

        // ON CONFLICT DO NOTHING: RabbitMQ bao dam "it nhat mot lan", nen cung mot
        // tin co the den hai lan sau khi mang chap chon. Rang buoc UNIQUE tren
        // legacy_cv_id khien lan thu hai khong tao ban ghi trung.
        const { rowCount } = await pool.query(
            `INSERT INTO applications
               (legacy_cv_id, job_id, job_title, candidate_id, candidate_name,
                candidate_email, candidate_phone, company_id, stage, cover_letter,
                is_read, applied_at, stage_changed_at, cv_snapshot)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'moi_ung_tuyen',$9,FALSE,$10,$10,$11)
             ON CONFLICT (legacy_cv_id) DO NOTHING`,
            [
                cvId, jobId, jobTitle, candidateId, candidateName,
                candidateEmail, candidatePhone, companyId, coverLetter,
                appliedAt ? new Date(appliedAt) : new Date(),
                // Snapshot ho so tai thoi diem nop.
                JSON.stringify({
                    fullName: candidateName,
                    email: candidateEmail,
                    phone: candidatePhone,
                    source: 'legacy_event',
                    receivedAt: new Date().toISOString()
                })
            ]
        );

        if (rowCount) {
            logger.info('da nhan ho so ung tuyen moi', { cvId, jobId, companyId });
        } else {
            logger.debug('ho so da co tu truoc, bo qua', { cvId });
        }
    }, { prefetch: 20 });
};
