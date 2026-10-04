import { pool } from '../libs/db.js';
import { validateInterview } from '../libs/interview.js';
import { validDate } from '../libs/offer.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('application-service');

// Build a calendar entry from the persisted invitation, never from the current
// CV or internal recruiter notes. Past invitations remain readable.
export const calendarEntry = (row, now = Date.now()) => {
    const snapshot = row.decision_snapshot;
    if (snapshot?.decision !== 'interview') return null;
    const { interview } = validateInterview(snapshot.interview, -Infinity);
    if (!interview) return null;
    const start = Date.parse(`${interview.interviewDate}T${interview.interviewTime}:00+07:00`);
    const end = start + Number(interview.durationMinutes || 60) * 60_000;
    return {
        id: row.invitation_id,
        applicationId: row.id,
        legacyCvId: row.legacy_cv_id ?? null,
        jobId: row.job_id,
        jobTitle: row.job_title ?? null,
        companyId: row.company_id,
        companyName: interview.companyName,
        candidateId: row.candidate_id,
        candidateName: row.candidate_name ?? null,
        candidateEmail: row.candidate_email ?? null,
        applicationStage: row.stage,
        scheduledAt: new Date(row.invitation_created_at).toISOString(),
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        // Moving away and back to the interview stage cannot revive an old
        // invitation. A fresh invitation is needed to create an active schedule.
        status: row.stage !== 'phong_van' || row.invalidated ? 'inactive' : end <= now ? 'past' : 'scheduled',
        interview,
        message: snapshot.message || null
    };
};

const readCalendar = async (req, res, candidateOnly) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const userId = Number(req.headers['x-user-id']);
    const companyId = Number(req.headers['x-company-id']);
    const role = req.headers['x-user-role'];
    const conditions = [];
    const params = [];
    if (candidateOnly) {
        if (!Number.isSafeInteger(userId) || userId < 1) {
            return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được người dùng' });
        }
        params.push(userId);
        conditions.push('a.candidate_id = $1');
    } else if (role !== 'ADMIN') {
        if (!['COMPANY', 'EMPLOYER'].includes(role) || !Number.isSafeInteger(companyId) || companyId < 1) {
            return res.status(403).json({ errCode: 3, errMessage: 'Tài khoản của bạn chưa có quyền xem lịch phỏng vấn của công ty' });
        }
        params.push(companyId);
        conditions.push('a.company_id = $1');
    }

    const { from, to, jobId } = req.query || {};
    if ((from !== undefined && (typeof from !== 'string' || !validDate(from))) ||
        (to !== undefined && (typeof to !== 'string' || !validDate(to))) || (from && to && from > to)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Khoảng ngày xem lịch phỏng vấn không hợp lệ' });
    }
    if (jobId !== undefined) {
        if (candidateOnly || !/^[1-9][0-9]*$/.test(jobId) || !Number.isSafeInteger(Number(jobId))) {
            return res.status(400).json({ errCode: 1, errMessage: 'Tin tuyển dụng không hợp lệ' });
        }
        params.push(Number(jobId));
        conditions.push(`a.job_id = $${params.length}`);
    }
    // Filter only AFTER selecting the latest snapshot. Otherwise changing a
    // date to another month would make the superseded appointment reappear.
    for (const [value, comparison] of [[from, '>='], [to, '<=']]) {
        if (value) {
            params.push(value);
            conditions.push(`invitation.decision_snapshot->'interview'->>'interviewDate' ${comparison} $${params.length}`);
        }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    try {
        const { rows } = await pool.query(
            `SELECT a.id, a.legacy_cv_id, a.job_id, a.job_title, a.company_id,
                    a.candidate_id, a.candidate_name, a.candidate_email, a.stage,
                    invitation.id AS invitation_id, invitation.created_at AS invitation_created_at,
                    invitation.decision_snapshot,
                    EXISTS (
                        SELECT 1 FROM application_events departed
                        WHERE departed.application_id = a.id AND departed.to_stage <> 'phong_van'
                          AND (departed.created_at, departed.id) > (invitation.created_at, invitation.id)
                    ) AS invalidated
             FROM applications a
             JOIN LATERAL (
                 SELECT e.id, e.created_at, e.decision_snapshot FROM application_events e
                 WHERE e.application_id = a.id AND e.decision_snapshot->>'decision' = 'interview'
                 ORDER BY e.created_at DESC, e.id DESC LIMIT 1
             ) invitation ON TRUE
             ${where}
             ORDER BY invitation.decision_snapshot->'interview'->>'interviewDate',
                      invitation.decision_snapshot->'interview'->>'interviewTime', a.id`,
            params
        );
        const now = Date.now();
        const data = rows.map(row => calendarEntry(row, now)).filter(Boolean);
        return res.json({ errCode: 0, data, count: data.length });
    } catch (error) {
        logger.error('doc lich phong van that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được lịch phỏng vấn' });
    }
};

export const listInterviews = (req, res) => readCalendar(req, res, false);
export const myInterviews = (req, res) => readCalendar(req, res, true);
