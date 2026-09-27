'use strict';

// This module writes local demo fixtures, not business events. In particular it
// never enqueues email, notification, payment, or AI requests.
const STAGES = Object.freeze(['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi']);
const DAY = 24 * 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new Error(`${label} must be a positive PostgreSQL integer`);
    return id;
}

function indexed(records, label) {
    if (!Array.isArray(records)) throw new Error(`manifest.${label} must be an array`);
    const result = new Map();
    for (const record of records) {
        const id = positiveId(record.id, `${label}.id`);
        if (result.has(id)) throw new Error(`Duplicate ${label} id ${id}`);
        result.set(id, { ...record, id });
    }
    return result;
}

function iso(value, label) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${label}`);
    return date.toISOString();
}

function assertLocalTarget(client, databaseHost) {
    const host = String(databaseHost || '').toLowerCase();
    if (process.env.NODE_ENV === 'production' || !LOCAL_HOSTS.has(host)) {
        throw new Error('Demo workflow seeding only supports a local development PostgreSQL database');
    }
    const connectedHost = client?.connectionParameters?.host;
    if (connectedHost && !LOCAL_HOSTS.has(String(connectedHost).toLowerCase())) {
        throw new Error('Connected PostgreSQL client is not a local development target');
    }
    if (!client || typeof client.query !== 'function') throw new Error('A connected PostgreSQL Client is required');
    if (typeof client.totalCount === 'number') throw new Error('Use a checked-out PostgreSQL client, not a Pool');
}

function buildDecision(company, candidate, stage, happenedAt, now, hired) {
    if (stage === 'tu_choi') return {
        decision: 'rejected',
        message: `[DEMO] Cảm ơn ${candidate.name}. Hồ sơ được lưu để trao đổi khi có vị trí phù hợp hơn. Đây là kết quả mô phỏng; không gửi email.`
    };
    if (stage !== 'de_nghi') return null;
    // Hired records contain a historical offer; open offers have a future
    // response deadline and start date. These are preview snapshots only.
    const base = hired ? new Date(happenedAt).getTime() : now.getTime();
    return {
        decision: 'accepted',
        message: '[DEMO] Thư mời mẫu để trình diễn thông tin nhận việc; chưa gửi email thực tế.',
        offer: {
            companyName: company.name,
            startDate: new Date(base + (hired ? 1 : 10) * DAY).toISOString().slice(0, 10),
            startTime: '09:00',
            timeZone: 'Asia/Ho_Chi_Minh',
            responseDeadline: `${new Date(base + (hired ? 0 : 5) * DAY).toISOString().slice(0, 10)}T17:00`,
            workMode: 'hybrid',
            location: company.address || 'Văn phòng công ty — địa chỉ minh họa cho bản demo',
            contactName: company.recruiterName || 'Bộ phận tuyển dụng demo',
            contactEmail: company.recruiterEmail || 'hr@jobfind.example',
            workSchedule: 'Thứ Hai đến thứ Sáu, 09:00–18:00; làm từ xa 2 ngày/tuần.',
            salary: 'Thu nhập minh họa: 22.000.000 VND gross/tháng; trao đổi theo kinh nghiệm.',
            probation: 'Thử việc 2 tháng, mức lương theo thư mời chính thức.',
            benefits: 'Máy tính làm việc, ngân sách đào tạo và hoạt động đội nhóm.',
            requiredDocuments: 'Bản demo: danh sách giấy tờ sẽ được HR xác nhận sau.',
            onboardingInstructions: 'Bản demo: gặp bộ phận nhân sự, nhận thiết bị và trao đổi kế hoạch 30 ngày đầu.'
        }
    };
}

/**
 * No database access. Manifest is the actual MySQL IDs from the companion seed:
 * {seedId, companies:[{id,name,recruiterId}], candidates:[{id,name,email,phone,skills}],
 *  posts:[{id,companyId,title}], cvs:[{id,userId,postId,createdAt,description,stage?}]}.
 * All generated history is explicitly demo data; match_score remains null so
 * the UI never presents a fabricated AI analysis as an executed analysis.
 */
function buildWorkflowPlan(manifest, { now = new Date() } = {}) {
    if (!manifest || !/^jobfind-demo-[a-z0-9-]+$/.test(manifest.seedId || '')) {
        throw new Error('A namespaced jobfind-demo-* seedId is required');
    }
    now = new Date(iso(now, 'now'));
    const companies = indexed(manifest.companies, 'companies');
    const candidates = indexed(manifest.candidates, 'candidates');
    const posts = indexed(manifest.posts, 'posts');
    const cvs = indexed(manifest.cvs, 'cvs');
    const companyIndexes = new Map();
    const applicationKeys = new Set();
    const talentKeys = new Set();
    const applications = [];
    const talent = [];
    for (const cv of [...cvs.values()].sort((a, b) => a.id - b.id)) {
        const candidateId = positiveId(cv.userId, 'cv.userId');
        const jobId = positiveId(cv.postId, 'cv.postId');
        const candidateSource = candidates.get(candidateId);
        const post = posts.get(jobId);
        if (!candidateSource || !post) throw new Error(`CV ${cv.id} references a missing candidate or job`);
        const company = companies.get(positiveId(post.companyId, 'post.companyId'));
        if (!company) throw new Error(`Job ${jobId} references a missing company`);
        const recruiterId = positiveId(company.recruiterId, 'company.recruiterId');
        const pair = `${candidateId}:${jobId}`;
        if (applicationKeys.has(pair)) throw new Error(`Duplicate candidate/job application ${pair}`);
        applicationKeys.add(pair);
        const ordinal = companyIndexes.get(company.id) || 0;
        companyIndexes.set(company.id, ordinal + 1);
        const stage = cv.stage || STAGES[ordinal % STAGES.length];
        if (!STAGES.includes(stage)) throw new Error(`Unsupported application stage ${stage}`);
        const candidate = {
            ...candidateSource,
            name: candidateSource.name || [candidateSource.firstName, candidateSource.lastName].filter(Boolean).join(' ')
        };
        if (!candidate.name || !candidate.email || !company.name || !(post.title || post.name)) {
            throw new Error(`CV ${cv.id} needs candidate name/email, company name and job title`);
        }
        const appliedAt = iso(cv.createdAt || new Date(now.getTime() - (12 + ordinal % 24) * DAY), 'CV createdAt');
        const appliedMs = new Date(appliedAt).getTime();
        if (appliedMs > now.getTime()) throw new Error(`CV ${cv.id} cannot have a future application date`);
        const path = stage === 'tu_choi'
            ? ['moi_ung_tuyen', 'dang_xem_xet', ...(ordinal % 2 ? ['phong_van'] : []), 'tu_choi']
            : STAGES.slice(0, STAGES.indexOf(stage) + 1);
        const endMs = Math.min(now.getTime(), appliedMs + (4 + ordinal % 7) * DAY);
        const eventReasons = {
            moi_ung_tuyen: '[DEMO] Ứng viên nộp hồ sơ và thư giới thiệu.',
            dang_xem_xet: '[DEMO] HR đã kiểm tra hồ sơ và chuyển sang vòng sàng lọc.',
            phong_van: '[DEMO] Hoàn tất trao đổi sơ bộ, chuyển sang phỏng vấn chuyên môn.',
            de_nghi: '[DEMO] Đã chuẩn bị thư mời nhận việc mẫu, chờ phản hồi; không gửi email.',
            nhan_viec: '[DEMO] Ứng viên đã xác nhận nhận việc trong kịch bản minh họa.',
            tu_choi: '[DEMO] Chưa phù hợp yêu cầu kinh nghiệm của vị trí trong kịch bản minh họa.'
        };
        const events = path.map((step, index) => {
            const createdAt = new Date(appliedMs + (path.length === 1 ? 0 : (endMs - appliedMs) * index / (path.length - 1))).toISOString();
            return {
                fromStage: index ? path[index - 1] : null,
                toStage: step,
                actorId: index ? recruiterId : candidateId,
                reason: eventReasons[step], createdAt,
                decisionSnapshot: buildDecision(company, candidate, step, createdAt, now, stage === 'nhan_viec')
            };
        });
        const changedAt = events[events.length - 1].createdAt;
        const skills = Array.isArray(candidate.skills) ? candidate.skills.slice(0, 4).map(String) : [];
        const notes = path.length === 1 ? [] : [{
            authorId: recruiterId,
            body: `[DEMO] Đã đọc CV cho vị trí ${post.title || post.name}. ${skills.length ? `Kỹ năng ứng viên khai báo: ${skills.join(', ')}. ` : ''}Cần trao đổi thêm về ví dụ dự án, vai trò cá nhân và thời gian có thể bắt đầu.`,
            createdAt: events[1].createdAt
        }];
        if (['phong_van', 'de_nghi', 'nhan_viec'].includes(stage)) notes.push({
            authorId: recruiterId,
            body: '[DEMO] Ghi chú phỏng vấn mẫu: trình bày rõ cách giải quyết vấn đề và phối hợp nhóm. Bước tiếp theo: xác nhận kỳ vọng thu nhập và thống nhất kế hoạch làm việc.',
            createdAt: changedAt
        });
        applications.push({
            legacyCvId: cv.id, jobId, jobTitle: post.title || post.name,
            candidateId, candidateName: candidate.name, candidateEmail: candidate.email,
            candidatePhone: candidate.phone || candidate.phonenumber || null,
            companyId: company.id, stage,
            rating: stage === 'moi_ung_tuyen' ? null : stage === 'tu_choi' ? 2 : stage === 'nhan_viec' ? 5 : 3 + ordinal % 3,
            matchScore: null,
            coverLetter: cv.description || `Tôi mong muốn trao đổi về vị trí ${post.title || post.name} và các dự án của công ty.`,
            isRead: stage !== 'moi_ung_tuyen', appliedAt, stageChangedAt: changedAt, updatedAt: changedAt,
            cvSnapshot: {
                fullName: candidate.name, email: candidate.email,
                phone: candidate.phone || candidate.phonenumber || null,
                source: 'demo_seed', demoSeedId: manifest.seedId,
                demoNotice: 'Hồ sơ và tiến trình giả lập phục vụ trình diễn; không phải kết quả AI.',
                seededAt: now.toISOString()
            },
            events, notes
        });
        const talentKey = `${company.id}:${candidateId}`;
        if (['phong_van', 'de_nghi', 'tu_choi'].includes(stage) && !talentKeys.has(talentKey)) {
            talentKeys.add(talentKey);
            talent.push({
                companyId: company.id, candidateId, candidateName: candidate.name, savedBy: recruiterId,
                tags: ['Demo', stage === 'tu_choi' ? 'Cơ hội tương lai' : 'Ứng viên tiềm năng', ...skills.slice(0, 2)],
                note: `[DEMO ${manifest.seedId}] Lưu hồ sơ để trao đổi về ${post.title || post.name} và những vị trí phù hợp tiếp theo.`,
                savedAt: changedAt
            });
        }
    }
    return {
        seedId: manifest.seedId, generatedAt: now.toISOString(), applications, talent,
        summary: {
            applications: applications.length,
            stages: Object.fromEntries(STAGES.map(stage => [stage, applications.filter(row => row.stage === stage).length])),
            events: applications.reduce((sum, row) => sum + row.events.length, 0),
            notes: applications.reduce((sum, row) => sum + row.notes.length, 0), talent: talent.length
        }
    };
}

function sameApplication(existing, wanted) {
    return Number(existing.job_id) === wanted.jobId
        && Number(existing.candidate_id) === wanted.candidateId
        && Number(existing.company_id) === wanted.companyId
        && existing.candidate_email === wanted.candidateEmail;
}

function canAdoptProjection(existing, wanted, hasHistory) {
    return sameApplication(existing, wanted) && !hasHistory
        && !existing.cv_snapshot?.demoSeedId
        && ['legacy_mysql', 'legacy_event'].includes(existing.cv_snapshot?.source)
        && ['moi_ung_tuyen', 'dang_xem_xet'].includes(existing.stage)
        && existing.rating == null && existing.match_score == null;
}

const APP_COLUMNS = ['legacy_cv_id', 'job_id', 'job_title', 'candidate_id', 'candidate_name',
    'candidate_email', 'candidate_phone', 'company_id', 'stage', 'rating', 'match_score',
    'cover_letter', 'cv_snapshot', 'is_read', 'applied_at', 'stage_changed_at', 'updated_at'];
const appValues = app => [app.legacyCvId, app.jobId, app.jobTitle, app.candidateId, app.candidateName,
    app.candidateEmail, app.candidatePhone, app.companyId, app.stage, app.rating, app.matchScore,
    app.coverLetter, JSON.stringify(app.cvSnapshot), app.isRead, app.appliedAt, app.stageChangedAt, app.updatedAt];

/** Caller owns the connection. Never pass a pool: BEGIN/COMMIT require one client. */
async function seedWorkflow({ client, manifest, now = new Date(), databaseHost, apply = false }) {
    const plan = buildWorkflowPlan(manifest, { now });
    if (!apply) return { dryRun: true, ...plan.summary };
    assertLocalTarget(client, databaseHost);
    const result = { dryRun: false, inserted: 0, adopted: 0, preserved: 0, skippedConflict: [], events: 0, notes: 0, talent: 0 };
    const eligibleCandidates = new Set();
    await client.query('BEGIN');
    try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`demo-workflow:${manifest.seedId}`]);
        for (const app of plan.applications) {
            // The insert also handles a concurrent initial projection safely.
            const inserted = await client.query(
                `INSERT INTO applications (${APP_COLUMNS.join(', ')})
                 VALUES (${APP_COLUMNS.map((_, index) => `$${index + 1}`).join(', ')})
                 ON CONFLICT (legacy_cv_id) DO NOTHING RETURNING id`, appValues(app));
            let applicationId = inserted.rows[0]?.id;
            if (applicationId) result.inserted++;
            else {
                const { rows } = await client.query('SELECT * FROM applications WHERE legacy_cv_id = $1 FOR UPDATE', [app.legacyCvId]);
                const existing = rows[0];
                if (!existing) throw new Error(`Application ${app.legacyCvId} disappeared during seed`);
                if (sameApplication(existing, app) && existing.cv_snapshot?.demoSeedId === manifest.seedId) {
                    result.preserved++;
                    continue;
                }
                const history = await client.query(
                    `SELECT EXISTS (SELECT 1 FROM application_events WHERE application_id = $1)
                         OR EXISTS (SELECT 1 FROM application_notes WHERE application_id = $1) AS has_history`, [existing.id]);
                if (!canAdoptProjection(existing, app, history.rows[0].has_history)) {
                    result.skippedConflict.push(app.legacyCvId);
                    continue;
                }
                applicationId = existing.id;
                await client.query(
                    `UPDATE applications SET ${APP_COLUMNS.map((column, index) => `${column} = $${index + 1}`).join(', ')}
                     WHERE id = $${APP_COLUMNS.length + 1}`, [...appValues(app), applicationId]);
                result.adopted++;
            }
            eligibleCandidates.add(`${app.companyId}:${app.candidateId}`);
            for (const event of app.events) {
                await client.query(
                    `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, reason, decision_snapshot, created_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [applicationId, event.fromStage, event.toStage, event.actorId, event.reason,
                        event.decisionSnapshot ? JSON.stringify(event.decisionSnapshot) : null, event.createdAt]);
                result.events++;
            }
            for (const note of app.notes) {
                await client.query(
                    'INSERT INTO application_notes (application_id, author_id, body, created_at) VALUES ($1,$2,$3,$4)',
                    [applicationId, note.authorId, note.body, note.createdAt]);
                result.notes++;
            }
        }
        for (const item of plan.talent) {
            if (!eligibleCandidates.has(`${item.companyId}:${item.candidateId}`)) continue;
            const added = await client.query(
                `INSERT INTO talent_pool (company_id, candidate_id, candidate_name, saved_by, tags, note, saved_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (company_id, candidate_id) DO NOTHING`,
                [item.companyId, item.candidateId, item.candidateName, item.savedBy, item.tags, item.note, item.savedAt]);
            result.talent += added.rowCount;
        }
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function verifyWorkflow({ client, manifest }) {
    const cvs = indexed(manifest.cvs, 'cvs');
    const posts = indexed(manifest.posts, 'posts');
    const ids = [...cvs.keys()];
    const { rows } = await client.query(
        `SELECT a.id, a.legacy_cv_id, a.job_id, a.candidate_id, a.company_id, a.stage,
                a.cv_snapshot->>'demoSeedId' AS seed_id,
                (SELECT COUNT(*)::int FROM application_events e WHERE e.application_id = a.id) AS events,
                (SELECT COUNT(*)::int FROM application_notes n WHERE n.application_id = a.id) AS notes
         FROM applications a WHERE a.legacy_cv_id = ANY($1::integer[]) ORDER BY a.legacy_cv_id`, [ids]);
    const found = new Set(rows.map(row => Number(row.legacy_cv_id)));
    const byCompany = {};
    for (const row of rows) {
        const company = byCompany[row.company_id] ||= Object.fromEntries(STAGES.map(stage => [stage, 0]));
        company[row.stage] = (company[row.stage] || 0) + 1;
    }
    return {
        expected: ids.length, found: rows.length,
        owned: rows.filter(row => row.seed_id === manifest.seedId).length,
        missingCvIds: ids.filter(id => !found.has(id)),
        mismatchedCvIds: rows.filter(row => {
            const cv = cvs.get(Number(row.legacy_cv_id));
            const post = posts.get(Number(cv.postId));
            return Number(row.candidate_id) !== Number(cv.userId) || Number(row.job_id) !== Number(cv.postId)
                || !post || Number(row.company_id) !== Number(post.companyId);
        }).map(row => Number(row.legacy_cv_id)),
        unsupportedStageCvIds: rows.filter(row => !STAGES.includes(row.stage)).map(row => Number(row.legacy_cv_id)),
        events: rows.reduce((sum, row) => sum + row.events, 0),
        notes: rows.reduce((sum, row) => sum + row.notes, 0), byCompany
    };
}

module.exports = { STAGES, buildWorkflowPlan, seedWorkflow, verifyWorkflow, canAdoptProjection, assertLocalTarget };
