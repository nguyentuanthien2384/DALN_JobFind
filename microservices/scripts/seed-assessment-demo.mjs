import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
    computeMcqAutoEvaluation,
    domainLabelOf,
    findTemplateById,
    normalizeQuestions,
    toTenScale
} from '../shared/assessmentTemplates.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MICROSERVICES_DIR = path.resolve(__dirname, '..');

function loadEnvMap(envPath) {
    if (!fs.existsSync(envPath)) return {};
    const out = {};
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function resolvePostgresUrl() {
    if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
    const env = loadEnvMap(path.join(MICROSERVICES_DIR, '.env'));
    const user = process.env.POSTGRES_USER || env.POSTGRES_USER || 'jobportal';
    const password = process.env.POSTGRES_PASSWORD || env.POSTGRES_PASSWORD || '';
    const host = process.env.POSTGRES_HOST || '127.0.0.1';
    const port = process.env.POSTGRES_PORT || '5435';
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/application_db`;
}

// Dinh nghia 2 bo de mau rieng cua doanh nghiep theo tung linh vuc (tuyet doi khong chep cheo).
const CUSTOM_COMPANY_TEMPLATES = [
    {
        companyId: 30, // An Phuc Commerce (Demo)
        domainCode: 'kinh-te',
        title: 'Đề chuẩn nội bộ: CSKH & Giữ chân khách hàng B2B — An Phúc Commerce',
        description: 'Kiểm tra kỹ năng xử lý khiếu nại SLA, tính toán giá trị vòng đời khách hàng (CLV) và giao tiếp khéo léo trong thương mại điện tử / B2B.',
        difficulty: 'MID',
        timeLimitMinutes: 35,
        createdBy: 9055,
        questions: normalizeQuestions([
            {
                id: 'apc-cskh-1',
                order: 1,
                type: 'mcq_single',
                prompt: 'Một hợp đồng khách hàng B2B mang lại doanh thu định kỳ 18 triệu/tháng với biên lợi nhuận gộp 40% và vòng đời trung bình 24 tháng. Giá trị lợi nhuận gộp kỳ vọng theo vòng đời (Gross CLV) là bao nhiêu?',
                points: 2,
                options: [
                    { id: 'A', text: '172.8 triệu đồng' },
                    { id: 'B', text: '432.0 triệu đồng' },
                    { id: 'C', text: '108.0 triệu đồng' },
                    { id: 'D', text: '216.0 triệu đồng' }
                ],
                correctOptionIds: ['A'],
                explanation: '18 triệu × 24 tháng × 40% = 172.8 triệu đồng.'
            },
            {
                id: 'apc-cskh-2',
                order: 2,
                type: 'mcq_multi',
                prompt: 'Khi tỷ lệ khách hàng rời bỏ (Churn rate) tăng bất thường ở tháng thứ 3 sau ký hợp đồng, những hành động nào đội CSKH nên ưu tiên thực hiện?',
                points: 2,
                options: [
                    { id: 'A', text: 'Phân nhóm lý do rời bỏ và phỏng vấn nhanh 5-10 khách hàng vừa hủy gia hạn' },
                    { id: 'B', text: 'Rà soát mức độ sử dụng tính năng chính trong 30-60 ngày đầu onboarding' },
                    { id: 'C', text: 'Ẩn nút hủy hợp đồng khỏi tài khoản khách hàng để giảm số liệu churn' },
                    { id: 'D', text: 'Thiết lập mốc kiểm tra sức khỏe tài khoản (Health Check) trước ngày gia hạn 30 ngày' }
                ],
                correctOptionIds: ['A', 'B', 'D'],
                explanation: 'Cần tìm nguyên nhân gốc rễ qua dữ liệu sử dụng & phản hồi khách hàng, kết hợp cảnh báo sớm trước kỳ gia hạn.'
            },
            {
                id: 'apc-cskh-3',
                order: 3,
                type: 'text',
                prompt: 'Một khách hàng doanh nghiệp trọng điểm bị giao trễ đơn hàng 3 ngày đúng dịp chiến dịch khuyến mãi lớn và yêu cầu bồi thường 30% giá trị hợp đồng. Bạn sẽ phản hồi qua email/điện thoại như thế nào để vừa giữ quan hệ lâu dài vừa kiểm soát chi phí đền bù?',
                points: 4,
                placeholder: 'Trình bày cấu trúc xử lý: xin lỗi & xác nhận vấn đề, giải pháp khắc phục tức thời, phương án bù đắp cân bằng...',
                maxLength: 8000,
                rubric: 'Thể hiện sự đồng cảm không đổ lỗi, tách bạch nguyên nhân & thời hạn xử lý ngay lập tức, đề xuất gói bù đắp giá trị cao nhưng chi phí trực tiếp hợp lý (tín dụng đơn kế tiếp/hỗ trợ ưu tiên) thay vì giảm tiền mặt 30% ngay.'
            },
            {
                id: 'apc-cskh-4',
                order: 4,
                type: 'text',
                prompt: 'Hãy nêu 3 chỉ số đo lường hiệu quả đội Chăm sóc khách hàng Thương mại (ví dụ CSAT, NPS, FRT, Net Revenue Retention) và giải thích cách bạn theo dõi để tránh làm đẹp số liệu hình thức.',
                points: 3,
                placeholder: 'Phân tích 3 chỉ số và cách kiểm soát chất lượng thực tế...',
                maxLength: 8000,
                rubric: 'Nêu rõ công thức/ngữ cảnh sử dụng của từng chỉ số, kết hợp chỉ số tốc độ (FRT/Resolution time) với chất lượng giải quyết triệt để (FCR/NRR) để tránh tình trạng đóng ticket vội.'
            }
        ])
    },
    {
        companyId: 28, // Sao Khue Digital (Demo)
        domainCode: 'cong-nghe-thong-tin',
        title: 'Đề chuẩn nội bộ: Frontend React, TypeScript & Async JS — Sao Khuê Digital',
        description: 'Đánh giá tư duy thiết kế hook React, tối ưu render danh sách lớn, xử lý bất đồng bộ bằng code JavaScript/TypeScript và chống rò rỉ bộ nhớ.',
        difficulty: 'MID',
        timeLimitMinutes: 40,
        createdBy: 9051,
        questions: normalizeQuestions([
            {
                id: 'skd-fe-1',
                order: 1,
                type: 'mcq_single',
                prompt: 'Trong React `useEffect`, khi nào hàm cleanup được thực thi?',
                points: 2,
                options: [
                    { id: 'A', text: 'Trước mỗi lần effect chạy lại do dependency thay đổi và khi component unmount' },
                    { id: 'B', text: 'Chỉ duy nhất một lần sau khi trình duyệt đóng tab' },
                    { id: 'C', text: 'Ngay trước khi component render lần đầu tiên' },
                    { id: 'D', text: 'Chỉ khi xảy ra lỗi runtime trong React' }
                ],
                correctOptionIds: ['A'],
                explanation: 'Cleanup chạy trước mỗi lần re-run effect và khi unmount.'
            },
            {
                id: 'skd-fe-2',
                order: 2,
                type: 'mcq_multi',
                prompt: 'Chọn các biện pháp chuẩn xác để giảm re-render dư thừa ở một bảng dữ liệu 500 dòng trong React:',
                points: 2,
                options: [
                    { id: 'A', text: 'Áp dụng windowing/virtualization (như react-window) chỉ render các dòng đang hiển thị' },
                    { id: 'B', text: 'Đưa hàm callback ổn định qua useCallback kết hợp React.memo cho RowItem' },
                    { id: 'C', text: 'Sinh key bằng Math.random() trong mỗi lần render để React làm mới DOM' },
                    { id: 'D', text: 'Tách state đang gõ ở thanh tìm kiếm khỏi component bảng lớn hoặc debounce truy vấn' }
                ],
                correctOptionIds: ['A', 'B', 'D'],
                explanation: 'Math.random() làm key khiến React unmount/mount lại toàn bộ DOM mỗi lần render.'
            },
            {
                id: 'skd-fe-3',
                order: 3,
                type: 'code',
                prompt: 'Hoàn thiện hàm JavaScript `groupApplicationsByStage(items)` nhận mảng ứng viên `{ id, name, stage, aiScore }`, trả về object gom nhóm theo `stage`, trong mỗi nhóm sắp xếp giảm dần theo `aiScore` (null/undefined coi như 0). Không làm biến đổi mảng gốc.',
                points: 4,
                language: 'javascript',
                starterCode: `function groupApplicationsByStage(items = []) {
  // TODO: Gom nhóm theo stage, giữ nguyên items gốc, sort giảm dần theo aiScore
  return {};
}
`,
                rubric: 'Nhóm chính xác theo stage, không mutate object/array đầu vào, xử lý an toàn khi items rỗng hoặc aiScore null.',
                sampleAnswer: `function groupApplicationsByStage(items = []) {
  const grouped = {};
  for (const item of items) {
    const stage = item?.stage || 'moi_ung_tuyen';
    if (!grouped[stage]) grouped[stage] = [];
    grouped[stage].push({ ...item });
  }
  for (const stage of Object.keys(grouped)) {
    grouped[stage].sort((a, b) => Number(b.aiScore || 0) - Number(a.aiScore || 0));
  }
  return grouped;
}`
            },
            {
                id: 'skd-fe-4',
                order: 4,
                type: 'text',
                prompt: 'Một trang quản lý ứng viên vừa có kéo thả giữa các cột vừa tải tệp CV PDF lớn khi mở modal. Bạn tổ chức quản lý state (optimistic update, rollback khi API lỗi, cancel fetch khi đổi ứng viên) như thế nào?',
                points: 4,
                placeholder: 'Trình bày luồng optimistic update, rollback và race-condition handling...',
                maxLength: 8000,
                rubric: 'Lưu snapshot trước kéo thả để rollback nếu API fail, dùng AbortController hoặc requestId ref khi chuyển ứng viên nhanh để tránh ghi đè modal.'
            }
        ])
    }
];

function buildQaAutomationQuestions() {
    return normalizeQuestions([
        {
            id: 'skd-qa-1',
            order: 1,
            type: 'mcq_single',
            prompt: 'Khi kiểm thử API tạo bài test có phân quyền chỉ cho phép ở bước phỏng vấn (`phong_van`), mã trạng thái HTTP nào chuẩn nhất khi nhà tuyển dụng gọi tạo ở vòng `moi_ung_tuyen`?',
            points: 2,
            options: [
                { id: 'A', text: '409 Conflict (xung đột trạng thái quy trình) kèm thông báo rõ lý do' },
                { id: 'B', text: '200 OK kèm danh sách rỗng' },
                { id: 'C', text: '500 Internal Server Error' },
                { id: 'D', text: '301 Moved Permanently' }
            ],
            correctOptionIds: ['A'],
            explanation: '409 Conflict biểu thị trạng thái tài nguyên hiện tại chưa thỏa điều kiện nghiệp vụ.'
        },
        {
            id: 'skd-qa-2',
            order: 2,
            type: 'mcq_multi',
            prompt: 'Những điểm kiểm tra bảo mật nào BẮT BUỘC có trong bộ test cho API ứng viên lấy đề thi (`GET /my-applications/:id/assessment`)?',
            points: 2,
            options: [
                { id: 'A', text: 'Đảm bảo response KHÔNG chứa correctOptionIds, sampleAnswer hay rubric chấm điểm trước khi nộp bài' },
                { id: 'B', text: 'Kiểm tra ứng viên A không thể đọc bài test của ứng viên B (trả 403/404)' },
                { id: 'C', text: 'Cho phép client tự gửi totalScore lúc nộp bài để giảm tải server' },
                { id: 'D', text: 'Kiểm tra câu hỏi phải đúng lĩnh vực của tin tuyển dụng' }
            ],
            correctOptionIds: ['A', 'B', 'D'],
            explanation: 'Server không bao giờ để lộ đáp án trước khi hoàn tất và luôn tự tính điểm phía server.'
        },
        {
            id: 'skd-qa-3',
            order: 3,
            type: 'code',
            prompt: 'Viết hàm JavaScript `assertNoSecretFields(candidatePayload)` dùng trong automated test để kiểm tra sâu `questions` của ứng viên chưa chấm không bị rò rỉ các khóa `correctOptionIds`, `rubric`, `sampleAnswer`, `explanation` (ném Error nếu phát hiện).',
            points: 4,
            language: 'javascript',
            starterCode: `function assertNoSecretFields(candidatePayload) {
  const forbidden = ['correctOptionIds', 'rubric', 'sampleAnswer', 'explanation'];
  // TODO: Kiểm tra từng câu hỏi và ném Error nêu rõ question.id + key bị lộ
}
`,
            rubric: 'Duyệt qua questions, kiểm tra Object.hasOwn với từng forbidden key, báo rõ question id và field bị rò rỉ.',
            sampleAnswer: `function assertNoSecretFields(candidatePayload) {
  const forbidden = ['correctOptionIds', 'rubric', 'sampleAnswer', 'explanation'];
  for (const q of candidatePayload?.questions || []) {
    for (const key of forbidden) {
      if (Object.hasOwn(q, key) && q[key] !== undefined && q[key] !== null) {
        throw new Error(\`Leaked secret field "\${key}" in question "\${q.id}"\`);
      }
    }
  }
}`
        },
        {
            id: 'skd-qa-4',
            order: 4,
            type: 'text',
            prompt: 'Mô tả kế hoạch Regression Test ngắn gọn cho luồng Kéo thả ứng viên -> Tạo bài test -> Ứng viên nộp bài -> AI chấm điểm (cần test những kịch bản tích cực và tiêu cực nào?).',
            points: 4,
            placeholder: 'Liệt kê test case positive, negative và boundary...',
            maxLength: 8000,
            rubric: 'Bao gồm happy path e2e, phân quyền sai vai trò/công ty khác, chặn tạo ngoài vòng phỏng vấn, chặn submit 2 lần, quá thời gian làm bài và timeout khi gọi AI.'
        }
    ]);
}

async function main() {
    const resetExisting = process.argv.includes('--reset');
    const pool = new Pool({ connectionString: resolvePostgresUrl(), max: 3 });

    try {
        // Dam bao role ung dung co quyen truy cap ke ca khi bang duoc tao boi role quan tri.
        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jf_application_9f0ced') THEN
                    GRANT ALL PRIVILEGES ON TABLE application_assessments, domain_test_templates TO jf_application_9f0ced;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jf_application_9f0ced;
                END IF;
            END $$;
        `);

        console.log('1) Seeding company domain_test_templates...');
        for (const tpl of CUSTOM_COMPANY_TEMPLATES) {
            const existing = await pool.query(
                `SELECT id FROM domain_test_templates
                 WHERE company_id = $1 AND domain_code = $2 AND title = $3`,
                [tpl.companyId, tpl.domainCode, tpl.title]
            );
            if (existing.rows.length > 0 && resetExisting) {
                await pool.query(
                    `UPDATE domain_test_templates
                     SET description = $1, difficulty = $2, time_limit_minutes = $3, questions = $4::jsonb, updated_at = NOW()
                     WHERE id = $5`,
                    [tpl.description, tpl.difficulty, tpl.timeLimitMinutes, JSON.stringify(tpl.questions), existing.rows[0].id]
                );
                console.log(`   [UPDATED] Template id=${existing.rows[0].id} (company=${tpl.companyId}, domain=${tpl.domainCode})`);
            } else if (existing.rows.length === 0) {
                const inserted = await pool.query(
                    `INSERT INTO domain_test_templates (
                        company_id, domain_code, domain_label, title, description,
                        difficulty, time_limit_minutes, questions, created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                    RETURNING id`,
                    [
                        tpl.companyId,
                        tpl.domainCode,
                        domainLabelOf(tpl.domainCode),
                        tpl.title,
                        tpl.description,
                        tpl.difficulty,
                        tpl.timeLimitMinutes,
                        JSON.stringify(tpl.questions),
                        tpl.createdBy
                    ]
                );
                console.log(`   [INSERTED] Template id=${inserted.rows[0].id} (company=${tpl.companyId}, domain=${tpl.domainCode})`);
            } else {
                console.log(`   [SKIPPED] Template already exists id=${existing.rows[0].id} (company=${tpl.companyId})`);
            }
        }

        const econCskhQuestions = CUSTOM_COMPANY_TEMPLATES[0].questions;
        const econSalesTpl = findTemplateById('tpl-econ-sales');
        const itFrontendTpl = findTemplateById('tpl-it-frontend');
        const skdFrontendCustomQuestions = CUSTOM_COMPANY_TEMPLATES[1].questions;
        const qaQuestions = buildQaAutomationQuestions();

        const now = Date.now();
        const minsAgo = (m) => new Date(now - m * 60 * 1000);

        // Chuan bi cac bai test demo bam sat dung domain cua tung job (chi tren cac ho so da o stage = 'phong_van').
        const demos = [
            // === COMPANY 30: An Phuc Commerce (Demo) — Domain 'kinh-te' ===
            (() => {
                const questions = econCskhQuestions;
                const answers = {
                    'apc-cskh-1': { selectedOptionIds: ['A'] },
                    'apc-cskh-2': { selectedOptionIds: ['A', 'B', 'D'] },
                    'apc-cskh-3': {
                        textAnswer:
                            '1. Chủ động gọi điện xin lỗi trực tiếp trong 2 giờ, xác nhận trách nhiệm từ phía vận hành.\n' +
                            '2. Ngay lập tức bố trí chuyến giao hỏa tốc trong ngày để kịp phần còn lại của chiến dịch.\n' +
                            '3. Thay vì giảm tiền mặt 30%, đề xuất tặng gói ưu tiên giao vận miễn phí cho 2 chiến dịch tới kèm voucher tín dụng 10% đơn kế tiếp và báo cáo cam kết SLA riêng.'
                    },
                    'apc-cskh-4': {
                        textAnswer:
                            'Tôi theo dõi bộ 3 chỉ số: CSAT (đo mức độ hài lòng ngay sau xử lý ticket), FCR - First Contact Resolution (giải quyết triệt để ngay lần liên hệ đầu để tránh CSAT cao giả do đóng ticket vội), và NRR - Net Revenue Retention (đo doanh thu giữ lại + mở rộng từ nhóm khách hiện hữu).'
                    }
                };
                const mcqEval = computeMcqAutoEvaluation(questions, answers);
                const maxScore = questions.reduce((s, q) => s + Number(q.points || 0), 0);
                return {
                    applicationId: 3071,
                    expectedCompanyId: 30,
                    domainCode: 'kinh-te',
                    templateId: null,
                    title: 'Bài test Vòng Phỏng vấn: Chăm sóc Khách hàng & Giữ chân Doanh thu (Kinh tế)',
                    description: 'Đánh giá khả năng tính chỉ số khách hàng, xử lý tình huống SLA trễ hạn và giữ chân doanh thu B2B.',
                    instructions: 'Trả lời đầy đủ 2 câu trắc nghiệm (tự động chấm) và 2 tình huống thực tế bên dưới.',
                    timeLimitSeconds: 35 * 60,
                    questions,
                    status: 'SUBMITTED',
                    answers,
                    startedAt: minsAgo(65),
                    submittedAt: minsAgo(40),
                    timeSpentSeconds: 1485,
                    isOvertime: false,
                    mcqScore: mcqEval.mcqScore,
                    mcqAutoResults: mcqEval,
                    earnedPoints: mcqEval.mcqScore,
                    maxScore,
                    totalScore: null,
                    gradingMode: null,
                    gradingFeedback: null,
                    createdBy: 9056,
                    gradedBy: null,
                    gradedAt: null
                };
            })(),
            {
                applicationId: 3065,
                expectedCompanyId: 30,
                domainCode: 'kinh-te',
                templateId: econSalesTpl.id,
                title: econSalesTpl.title,
                description: econSalesTpl.description,
                instructions: 'Bài test gồm trắc nghiệm biên lợi nhuận & đàm phán giá trị B2B + 2 tình huống thực tế. Thời gian 40 phút.',
                timeLimitSeconds: econSalesTpl.timeLimitMinutes * 60,
                questions: econSalesTpl.questions,
                status: 'ASSIGNED',
                answers: null,
                startedAt: null,
                submittedAt: null,
                timeSpentSeconds: null,
                isOvertime: false,
                mcqScore: null,
                mcqAutoResults: null,
                earnedPoints: null,
                maxScore: econSalesTpl.questions.reduce((s, q) => s + Number(q.points || 0), 0),
                totalScore: null,
                gradingMode: null,
                gradingFeedback: null,
                createdBy: 9056,
                gradedBy: null,
                gradedAt: null
            },

            // === COMPANY 28: Sao Khue Digital (Demo) — Domain 'cong-nghe-thong-tin' ===
            (() => {
                const questions = itFrontendTpl.questions;
                const answers = {
                    'it-fe-1': { selectedOptionIds: ['A'] },
                    'it-fe-2': { selectedOptionIds: ['A', 'C', 'D'] },
                    'it-fe-3': {
                        codeAnswer: `function createLatestFetcher(fetchFn) {
  let controller = null;
  return async function run(query) {
    if (controller) {
      controller.abort();
    }
    const current = new AbortController();
    controller = current;
    try {
      return await fetchFn(query, { signal: current.signal });
    } finally {
      if (controller === current) {
        controller = null;
      }
    }
  };
}`
                    },
                    'it-fe-4': {
                        textAnswer:
                            '1. Autosave bản nháp mỗi 1.5s theo key assessment_draft_{applicationId} vào localStorage kèm dấu thời gian.\n' +
                            '2. Đồng hồ đếm ngược luôn tính dựa trên startedAt do server trả về thay vì đếm thuần trên client để F5 không sai giờ.\n' +
                            '3. Gắn sự kiện beforeunload cảnh báo khi có thay đổi chưa lưu và cho phép retry idempotent khi rớt mạng tạm thời.'
                    }
                };
                const mcqEval = computeMcqAutoEvaluation(questions, answers);
                const maxScore = questions.reduce((s, q) => s + Number(q.points || 0), 0);
                return {
                    applicationId: 3022,
                    expectedCompanyId: 28,
                    domainCode: 'cong-nghe-thong-tin',
                    templateId: itFrontendTpl.id,
                    title: itFrontendTpl.title,
                    description: itFrontendTpl.description,
                    instructions: 'Hoàn thành các câu trắc nghiệm React, viết code JavaScript trực tiếp trong trình soạn và giải đáp câu hỏi kiến trúc.',
                    timeLimitSeconds: itFrontendTpl.timeLimitMinutes * 60,
                    questions,
                    status: 'SUBMITTED',
                    answers,
                    startedAt: minsAgo(90),
                    submittedAt: minsAgo(62),
                    timeSpentSeconds: 1680,
                    isOvertime: false,
                    mcqScore: mcqEval.mcqScore,
                    mcqAutoResults: mcqEval,
                    earnedPoints: mcqEval.mcqScore,
                    maxScore,
                    totalScore: null,
                    gradingMode: null,
                    gradingFeedback: null,
                    createdBy: 9052,
                    gradedBy: null,
                    gradedAt: null
                };
            })(),
            {
                applicationId: 3023,
                expectedCompanyId: 28,
                domainCode: 'cong-nghe-thong-tin',
                templateId: null,
                title: 'Bài test Vòng Phỏng vấn: React, TypeScript & Async Coding (Sao Khuê Digital)',
                description: 'Bài đánh giá hỗn hợp gồm trắc nghiệm kiến thức React + bài tập viết code JavaScript xử lý dữ liệu Kanban + tự luận kiến trúc.',
                instructions: 'Bạn có 40 phút để làm trắc nghiệm, viết hàm JavaScript trong trình soạn code và hoàn thiện câu tự luận.',
                timeLimitSeconds: 40 * 60,
                questions: skdFrontendCustomQuestions,
                status: 'ASSIGNED',
                answers: null,
                startedAt: null,
                submittedAt: null,
                timeSpentSeconds: null,
                isOvertime: false,
                mcqScore: null,
                mcqAutoResults: null,
                earnedPoints: null,
                maxScore: skdFrontendCustomQuestions.reduce((s, q) => s + Number(q.points || 0), 0),
                totalScore: null,
                gradingMode: null,
                gradingFeedback: null,
                createdBy: 9052,
                gradedBy: null,
                gradedAt: null
            },
            (() => {
                const questions = qaQuestions;
                const answers = {
                    'skd-qa-1': { selectedOptionIds: ['A'] },
                    'skd-qa-2': { selectedOptionIds: ['A', 'B', 'D'] },
                    'skd-qa-3': {
                        codeAnswer: `function assertNoSecretFields(candidatePayload) {
  const forbidden = ['correctOptionIds', 'rubric', 'sampleAnswer', 'explanation'];
  const list = Array.isArray(candidatePayload?.questions) ? candidatePayload.questions : [];
  for (const q of list) {
    for (const key of forbidden) {
      if (Object.hasOwn(q, key) && q[key] !== undefined && q[key] !== null) {
        throw new Error('Phat hien truong bi mat bi ro ri: ' + key + ' o cau ' + q.id);
      }
    }
  }
}`
                    },
                    'skd-qa-4': {
                        textAnswer:
                            'Positive: Chuyển stage sang phong_van -> tạo đề đúng domain -> ứng viên làm & nộp -> AI chấm trả về thang 10.\n' +
                            'Negative & Security: Tạo đề khi stage chưa phải phong_van phải trả 409; chọn đề của ngành khác bị chặn 400; ứng viên khác hoặc công ty khác truy cập trả 403; gọi AI khi vượt timeout cần hiển thị thông báo an toàn không mất bài.'
                    }
                };
                const mcqEval = computeMcqAutoEvaluation(questions, answers);
                const maxScore = questions.reduce((s, q) => s + Number(q.points || 0), 0); // 12
                const earnedPoints = 10.2;
                const totalScore = toTenScale(earnedPoints, maxScore); // 8.50
                const gradingFeedback = {
                    overallFeedback: 'Ứng viên nắm vững quy chuẩn HTTP API (409/403), thiết kế kiểm thử bảo mật chặt chẽ và viết hàm kiểm tra rò rỉ dữ liệu rõ ràng, xử lý tốt trường hợp mảng rỗng.',
                    recommendation: 'PASS',
                    strengths: [
                        'Đạt điểm tối đa 4/4 phần trắc nghiệm nguyên tắc API & bảo mật.',
                        'Code JS hàm assertNoSecretFields sử dụng Object.hasOwn an toàn, có kiểm tra mảng rỗng.'
                    ],
                    gaps: [
                        'Phần kế hoạch regression có thể bổ sung thêm kiểm tra idempotency khi ứng viên nhấn nộp 2 lần liên tiếp.'
                    ],
                    perQuestion: [
                        {
                            questionId: 'skd-qa-1',
                            earnedPoints: 2,
                            maxPoints: 2,
                            autoGraded: true,
                            comment: 'Chọn đúng đáp án hệ thống (409 Conflict).'
                        },
                        {
                            questionId: 'skd-qa-2',
                            earnedPoints: 2,
                            maxPoints: 2,
                            autoGraded: true,
                            comment: 'Chọn đầy đủ cả 3 đáp án kiểm thử bảo mật (A, B, D).'
                        },
                        {
                            questionId: 'skd-qa-3',
                            earnedPoints: 3.5,
                            maxPoints: 4,
                            autoGraded: false,
                            comment: 'Code sạch, kiểm tra an toàn Object.hasOwn và phòng mảng rỗng; có thể kiểm tra đệ quy nếu schema mở rộng options.'
                        },
                        {
                            questionId: 'skd-qa-4',
                            earnedPoints: 2.7,
                            maxPoints: 4,
                            autoGraded: false,
                            comment: 'Bao phủ tốt kịch bản phân quyền và cross-domain; nên thêm test double-submit và timer quá giờ.'
                        }
                    ]
                };
                return {
                    applicationId: 3029,
                    expectedCompanyId: 28,
                    domainCode: 'cong-nghe-thong-tin',
                    templateId: null,
                    title: 'Bài test Vòng Phỏng vấn: QA Automation & API Security (Công nghệ thông tin)',
                    description: 'Kiểm tra tư duy thiết kế bộ test API, bảo mật dữ liệu ứng viên và viết script kiểm tra tự động bằng JavaScript.',
                    instructions: 'Hoàn thành trắc nghiệm, viết script kiểm tra và nêu kịch bản kiểm thử hồi quy.',
                    timeLimitSeconds: 40 * 60,
                    questions,
                    status: 'GRADED',
                    answers,
                    startedAt: minsAgo(150),
                    submittedAt: minsAgo(118),
                    timeSpentSeconds: 1920,
                    isOvertime: false,
                    mcqScore: mcqEval.mcqScore,
                    mcqAutoResults: mcqEval,
                    earnedPoints,
                    maxScore,
                    totalScore,
                    gradingMode: 'AI',
                    gradingFeedback,
                    createdBy: 9052,
                    gradedBy: 9052,
                    gradedAt: minsAgo(115)
                };
            })()
        ];

        console.log('2) Seeding application_assessments (only in stage=phong_van)...');
        for (const item of demos) {
            const appRes = await pool.query(
                `SELECT id, job_id, company_id, candidate_id, candidate_name, stage
                 FROM applications WHERE id = $1`,
                [item.applicationId]
            );
            const appRow = appRes.rows[0];
            if (!appRow) {
                console.log(`   [SKIPPED] application_id=${item.applicationId} khong ton tai trong applications`);
                continue;
            }
            if (appRow.stage !== 'phong_van') {
                console.log(`   [SKIPPED] application_id=${item.applicationId} dang o stage='${appRow.stage}' (khong phai 'phong_van')`);
                continue;
            }
            if (Number(appRow.company_id) !== item.expectedCompanyId) {
                console.log(`   [SKIPPED] application_id=${item.applicationId} thuoc company_id=${appRow.company_id} != ${item.expectedCompanyId}`);
                continue;
            }

            if (resetExisting) {
                await pool.query('DELETE FROM application_assessments WHERE application_id = $1', [appRow.id]);
            }

            const existing = await pool.query(
                'SELECT id, status FROM application_assessments WHERE application_id = $1',
                [appRow.id]
            );
            if (existing.rows.length > 0) {
                console.log(`   [SKIPPED] application_id=${appRow.id} (${appRow.candidate_name}) da co assessment id=${existing.rows[0].id} (${existing.rows[0].status})`);
                continue;
            }

            const insertRes = await pool.query(
                `INSERT INTO application_assessments (
                    application_id, job_id, company_id, candidate_id,
                    domain_code, domain_label, template_id,
                    title, description, instructions, time_limit_seconds,
                    questions, status, answers,
                    started_at, submitted_at, time_spent_seconds, is_overtime,
                    mcq_score, mcq_auto_results, earned_points, max_score, total_score,
                    grading_mode, grading_feedback, created_by, graded_by, graded_at
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7,
                    $8, $9, $10, $11,
                    $12::jsonb, $13, $14::jsonb,
                    $15, $16, $17, $18,
                    $19, $20::jsonb, $21, $22, $23,
                    $24, $25::jsonb, $26, $27, $28
                ) RETURNING id`,
                [
                    appRow.id,
                    appRow.job_id,
                    appRow.company_id,
                    appRow.candidate_id,
                    item.domainCode,
                    domainLabelOf(item.domainCode),
                    item.templateId,
                    item.title,
                    item.description,
                    item.instructions,
                    item.timeLimitSeconds,
                    JSON.stringify(item.questions),
                    item.status,
                    item.answers ? JSON.stringify(item.answers) : null,
                    item.startedAt,
                    item.submittedAt,
                    item.timeSpentSeconds,
                    item.isOvertime,
                    item.mcqScore,
                    item.mcqAutoResults ? JSON.stringify(item.mcqAutoResults) : null,
                    item.earnedPoints,
                    item.maxScore,
                    item.totalScore,
                    item.gradingMode,
                    item.gradingFeedback ? JSON.stringify(item.gradingFeedback) : null,
                    item.createdBy,
                    item.gradedBy,
                    item.gradedAt
                ]
            );
            console.log(`   [INSERTED] app=${appRow.id} (${appRow.candidate_name}, company=${appRow.company_id}, domain=${item.domainCode}) -> status=${item.status}, assessment_id=${insertRes.rows[0].id}`);
        }

        console.log('Done seeding demo assessments.');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
});
