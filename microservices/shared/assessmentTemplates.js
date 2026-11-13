// Danh mục bài test chuyên ngành theo từng mã JOBTYPE thực tế của JobFind.
// NGUYÊN TẮC BẮT BUỘC:
// - Mỗi bài test gắn cứng với đúng một domainCode (categoryJobCode).
// - Tuyệt đối KHÔNG fallback hay sao chép bài test từ lĩnh vực khác (ví dụ: không lấy đề IT cho ngành Luật/Nhân sự).
// - Hỗ trợ trộn lẫn câu hỏi trắc nghiệm (mcq_single, mcq_multi) và câu hỏi điền/tự luận/code (text, code).

export const QUESTION_TYPES = Object.freeze(['mcq_single', 'mcq_multi', 'text', 'code']);
export const CODE_LANGUAGES = Object.freeze(['javascript', 'typescript', 'python', 'java', 'sql', 'html_css', 'other']);
export const ASSESSMENT_STATUSES = Object.freeze(['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'GRADED']);
export const GRADING_MODES = Object.freeze(['RECRUITER', 'AI']);
export const RECOMMENDATIONS = Object.freeze(['PASS', 'CONSIDER', 'FAIL']);

export const DOMAIN_LABELS = Object.freeze({
    'cong-nghe-thong-tin': 'Công nghệ thông tin',
    'truyen-thong': 'Truyền thông',
    'kinh-te': 'Kinh tế',
    'quan-ly-nhan-su': 'Quản lý nhân sự',
    'giao-vien': 'Giáo viên',
    'bat-dong-san': 'Bất động sản',
    'luat': 'Luật',
    'logistics': 'Logistics'
});

const qMcqSingle = (id, order, prompt, options, correctId, points = 2, explanation = '') => ({
    id, order, type: 'mcq_single', prompt, points, options, correctOptionIds: [correctId], explanation
});

const qMcqMulti = (id, order, prompt, options, correctIds, points = 2, explanation = '') => ({
    id, order, type: 'mcq_multi', prompt, points, options, correctOptionIds: correctIds, explanation
});

const qText = (id, order, prompt, { points = 3, placeholder = 'Nhập câu trả lời chi tiết của bạn...', maxLength = 8000, rubric = '', sampleAnswer = '' } = {}) => ({
    id, order, type: 'text', prompt, points, placeholder, maxLength, rubric, sampleAnswer
});

const qCode = (id, order, prompt, { points = 4, language = 'javascript', starterCode = '', rubric = '', sampleAnswer = '' } = {}) => ({
    id, order, type: 'code', prompt, points, language, starterCode, rubric, sampleAnswer
});

const RAW_TEMPLATES = [
    // ================= 1. CÔNG NGHỆ THÔNG TIN =================
    {
        id: 'tpl-it-fullstack',
        domainCode: 'cong-nghe-thong-tin',
        domainLabel: DOMAIN_LABELS['cong-nghe-thong-tin'],
        title: 'Đánh giá Fullstack & Backend Engineering (Node.js, SQL & Debug)',
        description: 'Kiểm tra kiến thức hệ thống backend, truy vấn SQL, xử lý dữ liệu bằng code thực tế và tư duy debug sản xuất.',
        timeLimitMinutes: 45,
        difficulty: 'MID',
        questions: [
            qMcqSingle('it-fs-1', 1, 'Trong Node.js, vì sao một vòng lặp CPU-bound chạy đồng bộ 2 giây trên thread chính lại làm toàn bộ API khác bị treo?', [
                { id: 'A', text: 'Do Event Loop chạy đơn luồng JS nên callback kế tiếp bị chặn không được thực thi' },
                { id: 'B', text: 'Do PostgreSQL tự động khóa toàn bộ connection pool' },
                { id: 'C', text: 'Do Express tự đóng mọi kết nối HTTP keep-alive sau 500ms' },
                { id: 'D', text: 'Do garbage collector chỉ chạy khi khởi động lại server' }
            ], 'A', 2, 'Tác vụ CPU-bound đồng bộ chặn main event loop của Node.js.'),
            qMcqMulti('it-fs-2', 2, 'Chọn TẤT CẢ các biện pháp hiệu quả để chống SQL Injection và tăng an toàn truy vấn CSDL:', [
                { id: 'A', text: 'Dùng Parameterized Query / Prepared Statements ($1, $2 hoặc ?)' },
                { id: 'B', text: 'Nối chuỗi trực tiếp nhưng gọi .trim() trước khi chạy SQL' },
                { id: 'C', text: 'Cấp quyền tối thiểu (least privilege) cho tài khoản DB của từng service' },
                { id: 'D', text: 'Xác thực kiểu dữ liệu và giới hạn enum ở lớp schema trước khi truy vấn' }
            ], ['A', 'C', 'D'], 2, 'Không bao giờ nối chuỗi input vào SQL; cần parameterized query, kiểm tra schema và least privilege.'),
            qCode('it-fs-3', 3, 'Viết hàm JavaScript `pickLatestByCandidate(records)` nhận mảng `{ candidateId, appliedAt, score }` (ISO string `appliedAt`), giữ lại hồ sơ mới nhất cho từng `candidateId` và trả về mảng sắp xếp giảm dần theo `score`.', {
                points: 4,
                language: 'javascript',
                starterCode: 'function pickLatestByCandidate(records = []) {\n  // TODO: Nhóm theo candidateId, giữ appliedAt mới nhất, sắp xếp giảm dần theo score\n  return [];\n}\n',
                rubric: 'Độ phức tạp O(n log n); so sánh timestamp chính xác (Date.parse hoặc chuỗi ISO); không mutate input; xử lý mảng rỗng an toàn.',
                sampleAnswer: 'Dùng Map theo candidateId, so sánh Date.parse(appliedAt) để giữ bản ghi mới hơn, sau đó Array.from(map.values()).sort((a, b) => b.score - a.score).'
            }),
            qCode('it-fs-4', 4, 'Viết truy vấn SQL lấy Top 3 `job_id` có số lượng ứng viên đang ở giai đoạn `phong_van` nhiều nhất (chỉ lấy các job có >= 2 ứng viên ở vòng phỏng vấn).', {
                points: 3,
                language: 'sql',
                starterCode: '-- Bảng applications(id, job_id, candidate_id, stage, applied_at)\nSELECT \n  -- hoàn thiện truy vấn\n;',
                rubric: 'Lọc WHERE stage = \'phong_van\', GROUP BY job_id, HAVING COUNT(*) >= 2, ORDER BY total DESC, LIMIT 3.',
                sampleAnswer: "SELECT job_id, COUNT(*) AS total FROM applications WHERE stage = 'phong_van' GROUP BY job_id HAVING COUNT(*) >= 2 ORDER BY total DESC LIMIT 3;"
            }),
            qText('it-fs-5', 5, 'API danh sách ứng viên bị chậm (p95 = 3.2s) khi một công ty có 50.000 hồ sơ. Nêu tối thiểu 3 nguyên nhân phổ biến và phương án tối ưu cụ thể ở DB/API.', {
                points: 4,
                placeholder: 'Trình bày phương án tối ưu index, phân trang keyset/limit, tránh N+1, caching...',
                rubric: 'Chỉ ra được composite index (company_id, stage, applied_at), tránh N+1/SELECT *, phân trang hợp lý, giải thích tác động.',
                sampleAnswer: 'Tạo composite index phù hợp với WHERE/ORDER BY, bỏ N+1 query bằng JOIN/batching, dùng keyset pagination hoặc giới hạn offset, chọn cột cần thiết thay vì SELECT *.'
            })
        ]
    },
    {
        id: 'tpl-it-frontend',
        domainCode: 'cong-nghe-thong-tin',
        domainLabel: DOMAIN_LABELS['cong-nghe-thong-tin'],
        title: 'Đánh giá Frontend React & Trải nghiệm Hiệu năng Web',
        description: 'Tập trung vào kiến trúc component React, xử lý bất đồng bộ tránh race condition, bảo mật trình duyệt và code thực tế.',
        timeLimitMinutes: 40,
        difficulty: 'JUNIOR',
        questions: [
            qMcqSingle('it-fe-1', 1, 'Vấn đề gì xảy ra khi dùng index của mảng làm `key` trong danh sách React có thêm/xóa/sắp xếp lại phần tử ở đầu hoặc giữa?', [
                { id: 'A', text: 'React ghép nhầm state nội bộ của DOM/component sang phần tử khác sau khi thứ tự đổi' },
                { id: 'B', text: 'Trình duyệt sẽ tự động chặn render toàn bộ trang' },
                { id: 'C', text: 'Redux tự xóa state của danh sách' },
                { id: 'D', text: 'CSS Flexbox không áp dụng được lên phần tử con' }
            ], 'A', 2),
            qMcqMulti('it-fe-2', 2, 'Chọn các kỹ thuật đúng để bảo vệ dữ liệu người dùng và tối ưu tải trang trên SPA:', [
                { id: 'A', text: 'Thoát/sanitize HTML trước khi dùng dangerouslySetInnerHTML để ngăn XSS' },
                { id: 'B', text: 'Lưu mật khẩu gốc vào localStorage để tự đăng nhập lại' },
                { id: 'C', text: 'Dùng React.lazy + code splitting cho route ít truy cập' },
                { id: 'D', text: 'Hủy request HTTP đang chờ bằng AbortController khi component unmount hoặc query đổi' }
            ], ['A', 'C', 'D'], 2),
            qCode('it-fe-3', 3, 'Viết hàm JavaScript `createLatestFetcher(fetchFn)` đảm bảo nếu gọi liên tiếp khi người dùng gõ tìm kiếm, chỉ kết quả của lần gọi mới nhất được resolve (hoặc hủy request cũ bằng AbortController).', {
                points: 4,
                language: 'javascript',
                starterCode: 'function createLatestFetcher(fetchFn) {\n  let controller = null;\n  return async function run(query) {\n    // TODO: Hủy request trước đó nếu còn chạy và gọi fetchFn(query, { signal })\n  };\n}\n',
                rubric: 'Khởi tạo AbortController mới mỗi lần gọi, gọi controller.abort() cho request trước, truyền signal vào fetchFn, quản lý cleanup sạch.',
                sampleAnswer: 'Kiểm tra controller?.abort(); tạo controller = new AbortController(); bọc try/finally xóa reference nếu controller hiện tại trùng khớp.'
            }),
            qText('it-fe-4', 4, 'Khi thiết kế form nộp bài test có đồng hồ đếm ngược 30 phút và bộ soạn code, bạn xử lý thế nào để ứng viên không mất bài nếu lỡ nhấn Back hoặc rớt mạng tạm thời?', {
                points: 4,
                placeholder: 'Mô tả cách lưu nháp tự động, đồng bộ mốc thời gian với server, cảnh báo rời trang...',
                rubric: 'Nhắc đến autosave theo debounce (local/session storage theo applicationId), lấy startedAt từ server thay vì tin đồng hồ client, beforeunload warning và retry submit an toàn.'
            })
        ]
    },

    // ================= 2. TRUYỀN THÔNG =================
    {
        id: 'tpl-mkt-performance',
        domainCode: 'truyen-thong',
        domainLabel: DOMAIN_LABELS['truyen-thong'],
        title: 'Đánh giá Truyền thông Số, Performance Funnel & Copywriting',
        description: 'Kiểm tra tư duy đo lường phễu chuyển đổi (CAC, ROAS), lập kế hoạch chiến dịch đa kênh và kỹ năng viết thông điệp thực chiến.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('mkt-pf-1', 1, 'Một chiến dịch chi 20 triệu đồng, mang về 400 click, tỷ lệ chuyển đổi từ click sang đơn hàng là 5%, giá trị trung bình mỗi đơn là 2.000.000đ. ROAS của chiến dịch bằng bao nhiêu?', [
                { id: 'A', text: '2.0x' },
                { id: 'B', text: '4.0x' },
                { id: 'C', text: '1.5x' },
                { id: 'D', text: '5.0x' }
            ], 'A', 2, '400 * 5% = 20 đơn -> Doanh thu 40 triệu / Chi phí 20 triệu = ROAS 2.0x.'),
            qMcqMulti('mkt-pf-2', 2, 'Khi kiểm định A/B test hai mẫu quảng cáo (A và B), những yếu tố nào cần đảm bảo để kết luận đáng tin cậy?', [
                { id: 'A', text: 'Thay đổi duy nhất 1 biến chính (ví dụ tiêu đề hoặc hình ảnh) giữa A và B' },
                { id: 'B', text: 'Tắt nhóm yếu hơn ngay sau 2 giờ đầu dù mới có 3 lượt nhấp' },
                { id: 'C', text: 'Đảm bảo cỡ mẫu và thời gian chạy đủ dài trước khi chốt người thắng' },
                { id: 'D', text: 'Phân chia tệp đối tượng ngẫu nhiên và tránh chồng chéo tệp lớn' }
            ], ['A', 'C', 'D'], 2),
            qText('mkt-pf-3', 3, 'Với ngân sách 50 triệu/tháng cho một nền tảng tìm việc làm hướng tới sinh viên năm cuối & nhân sự 1-3 năm kinh nghiệm, hãy phân bổ ngân sách theo phễu TOFU - MOFU - BOFU và nêu KPI đo lường cho từng tầng.', {
                points: 4,
                placeholder: 'Trình bày tỷ trọng kênh (TikTok/Meta/Search/PR/Community) và KPI cho từng tầng phễu...',
                rubric: 'Phân bổ hợp lý giữa Awareness (CPM/Reach), Consideration (CTR/CPC/Traffic chất lượng) và Conversion (CPL/CPA ứng tuyển hoàn tất); tránh dồn 100% vào một bước.'
            }),
            qText('mkt-pf-4', 4, 'Viết 3 phương án tiêu đề mở đầu (hook dưới 25 từ/mẫu) cho bài đăng mạng xã hội giới thiệu tính năng tạo CV chuẩn ngành để tăng tỷ lệ click từ nhóm ứng viên mới đi làm.', {
                points: 3,
                placeholder: 'Phương án 1 (Pain point)..., Phương án 2 (Lợi ích cụ thể)..., Phương án 3 (Social proof/Tò mò)...',
                rubric: 'Đúng tệp đối tượng, ngắn gọn, đánh trúng nỗi đau/lợi ích thật, không giật tít sai sự thật.'
            })
        ]
    },
    {
        id: 'tpl-mkt-pr',
        domainCode: 'truyen-thong',
        domainLabel: DOMAIN_LABELS['truyen-thong'],
        title: 'Đánh giá Chiến lược Nội dung, SEO & Xử lý Khủng hoảng Truyền thông',
        description: 'Đánh giá khả năng hoạch định nội dung đa kênh, tối ưu tìm kiếm tự nhiên và ứng biến khủng hoảng thương hiệu.',
        timeLimitMinutes: 35,
        difficulty: 'MID',
        questions: [
            qMcqSingle('mkt-pr-1', 1, 'Khi khách hàng phản ánh công khai một lỗi dịch vụ có thật và bài viết đang lan truyền nhanh, phản ứng đầu tiên phù hợp nhất của bộ phận Truyền thông là gì?', [
                { id: 'A', text: 'Xóa bình luận trái chiều và chặn tài khoản đăng bài' },
                { id: 'B', text: 'Xác minh nhanh sự thật nội bộ, phản hồi cầu thị nhận trách nhiệm trong phần đúng phạm vi và nêu mốc xử lý rõ ràng' },
                { id: 'C', text: 'Im lặng hoàn toàn chờ dư luận tự quên' },
                { id: 'D', text: 'Đổ lỗi công khai cho bộ phận kỹ thuật hoặc đối tác' }
            ], 'B', 2),
            qMcqMulti('mkt-pr-2', 2, 'Trong khung chất lượng nội dung E-E-A-T của Google, những yếu tố nào góp phần tăng độ tin cậy bền vững cho bài viết chuyên môn?', [
                { id: 'A', text: 'Thể hiện trải nghiệm thực tế, số liệu dẫn chứng rõ ràng và tác giả có chuyên môn phù hợp' },
                { id: 'B', text: 'Lặp lại từ khóa chính 50 lần ở cuối bài bằng chữ ẩn' },
                { id: 'C', text: 'Trích nguồn chính thống và cập nhật thông tin lỗi thời định kỳ' },
                { id: 'D', text: 'Cấu trúc bài rõ ràng đáp ứng đúng ý định tìm kiếm (Search Intent)' }
            ], ['A', 'C', 'D'], 2),
            qText('mkt-pr-3', 3, 'Một bài review chê quy trình tuyển dụng thiếu chuyên nghiệp của công ty xuất hiện trên cộng đồng nghề nghiệp 200.000 thành viên. Soạn thảo thông điệp phản hồi chính thức (~150-250 từ) giữ uy tín thương hiệu tuyển dụng.', {
                points: 4,
                rubric: 'Giọng điệu tôn trọng, lắng nghe, không tranh cãi tay đôi, nêu hành động rà soát cụ thể và mở kênh trao đổi trực tiếp.'
            }),
            qText('mkt-pr-4', 4, 'Xây dựng 1 lịch biên tập nội dung (Content Pillar & 4 chủ đề nhánh) trong 2 tuần cho kênh LinkedIn/Facebook doanh nghiệp nhằm thu hút nhân tài công nghệ và kinh doanh.', {
                points: 3,
                rubric: 'Cân bằng giữa văn hóa nội bộ, chuyên môn thật của đội ngũ, góc nhìn nghề nghiệp và cơ hội việc làm; nêu rõ định dạng bài đăng.'
            })
        ]
    },

    // ================= 3. KINH TẾ =================
    {
        id: 'tpl-econ-sales',
        domainCode: 'kinh-te',
        domainLabel: DOMAIN_LABELS['kinh-te'],
        title: 'Đánh giá Kinh doanh B2B, Đàm phán Thương mại & Quản trị Doanh thu',
        description: 'Kiểm tra tư duy tính toán biên lợi nhuận, quy trình tư vấn B2B, xử lý từ chối về giá và phân tích phễu bán hàng.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('econ-s-1', 1, 'Một doanh nghiệp bán gói dịch vụ 100 triệu đồng/năm với giá vốn trực tiếp là 35 triệu đồng. Nếu giảm giá 15% cho khách hàng nhưng giá vốn không đổi, biên lợi nhuận gộp mới là bao nhiêu?', [
                { id: 'A', text: 'Khoảng 58.8%' },
                { id: 'B', text: '50.0%' },
                { id: 'C', text: '65.0%' },
                { id: 'D', text: '45.5%' }
            ], 'A', 2, 'Doanh thu sau giảm = 85 triệu; Lợi nhuận gộp = 85 - 35 = 50 triệu -> 50 / 85 = 58.82%.'),
            qMcqMulti('econ-s-2', 2, 'Khi khách hàng B2B nói "Giá bên bạn cao hơn đối thủ 20%", những cách xử lý nào thể hiện tư duy bán hàng theo giá trị (Value-based Selling)?', [
                { id: 'A', text: 'Đặt câu hỏi làm rõ tiêu chí so sánh của khách (phạm vi dịch vụ, SLA hỗ trợ, chi phí ẩn)' },
                { id: 'B', text: 'Lập tức giảm giá 25% ngay trong cuộc gọi đầu để chốt nhanh' },
                { id: 'C', text: 'Quy đổi chênh lệch chi phí thành ROI hoặc thời gian/rủi ro khách hàng tiết kiệm được' },
                { id: 'D', text: 'Đề xuất chia giai đoạn gói hoặc điều khoản thanh toán linh hoạt nếu ngân sách quý hạn chế' }
            ], ['A', 'C', 'D'], 2),
            qText('econ-s-3', 3, 'Cuối quý, một khách hàng doanh nghiệp tiềm năng đòi chiết khấu thêm 25% mới ký hợp đồng ngay, nếu không sẽ hoãn sang quý sau. Bạn sẽ chuẩn bị chiến lược đàm phán như thế nào (giới hạn nhượng bộ, giá trị trao đổi đi kèm - give & get)?', {
                points: 4,
                rubric: 'Áp dụng nguyên tắc give-and-get (đổi chiết khấu vừa phải lấy cam kết thời hạn dài hơn, thanh toán trước, case study), bảo vệ biên lợi nhuận và quy trình phê duyệt.'
            }),
            qText('econ-s-4', 4, 'Nhóm bán hàng nhận 100 lead đạt chuẩn trong tháng: 60 cuộc hẹn Demo thành công, nhưng chỉ 15 khách nhận Báo giá và 4 khách ký hợp đồng. Chỉ ra điểm nghẽn lớn nhất và đề xuất 3 giải pháp khắc phục trong tháng tới.', {
                points: 3,
                rubric: 'Phát hiện tỷ lệ rớt mạnh ở bước Demo -> Báo giá (75% rớt): cần rà soát lại bước qualification nhu cầu/ngân sách/người quyết định trước khi demo và cách đóng gói giải pháp sau demo.'
            })
        ]
    },
    {
        id: 'tpl-econ-finance',
        domainCode: 'kinh-te',
        domainLabel: DOMAIN_LABELS['kinh-te'],
        title: 'Đánh giá Phân tích Tài chính, Dòng tiền & Kế toán Quản trị',
        description: 'Tập trung vào đọc hiểu báo cáo kết quả kinh doanh, dòng tiền hoạt động, kiểm soát công nợ và tối ưu chi phí vận hành.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('econ-f-1', 1, 'Trường hợp nào giải thích hợp lý nhất cho việc doanh nghiệp báo lãi ròng tăng mạnh nhưng Dòng tiền từ hoạt động kinh doanh (OCF) lại âm?', [
                { id: 'A', text: 'Doanh thu ghi nhận chủ yếu đang nằm ở khoản phải thu (khách chưa thanh toán) và tồn kho tăng cao' },
                { id: 'B', text: 'Khấu hao tài sản cố định quá lớn so với năm trước' },
                { id: 'C', text: 'Doanh nghiệp thu tiền mặt ngay 100% khi xuất hóa đơn' },
                { id: 'D', text: 'Không phát sinh bất kỳ chi phí lãi vay nào' }
            ], 'A', 2),
            qMcqMulti('econ-f-2', 2, 'Để cải thiện Chu kỳ chuyển đổi tiền mặt (Cash Conversion Cycle - CCC), những biện pháp nào có tác động tích cực trực tiếp?', [
                { id: 'A', text: 'Rút ngắn số ngày thu tiền bình quân (DSO) bằng chính sách nhắc nợ & ưu đãi thanh toán sớm' },
                { id: 'B', text: 'Tăng lượng hàng tồn kho chậm luân chuyển lên gấp đôi' },
                { id: 'C', text: 'Tối ưu vòng quay hàng tồn kho (giảm DIO) theo dự báo cầu thực tế' },
                { id: 'D', text: 'Đàm phán giãn kỳ hạn thanh toán hợp lý với nhà cung cấp (tăng DPO) mà không mất uy tín' }
            ], ['A', 'C', 'D'], 2),
            qText('econ-f-3', 3, 'Một công ty tăng trưởng doanh thu 30% trong 6 tháng nhưng số dư tiền mặt giảm từ 4 tỷ xuống còn 600 triệu. Bạn cần kiểm tra ngay những chỉ số và khoản mục nào để báo cáo Ban Giám đốc?', {
                points: 4,
                rubric: 'Kiểm tra aging phải thu (AR quá hạn), vòng quay tồn kho, biên lợi nhuận gộp từng dòng sản phẩm (có đang bán lỗ lấy thị phần không), chi phí cố định phình to, CAPEX và lịch trả nợ.'
            }),
            qText('econ-f-4', 4, 'Đề xuất 3 KPI tài chính/vận hành cốt lõi cần theo dõi hàng tuần cho một mô hình SaaS/Dịch vụ B2B tăng trưởng nhanh và giải thích ý nghĩa cảnh báo của từng chỉ số.', {
                points: 3,
                rubric: 'Ví dụ Burn rate / Cash runway, DSO / tỷ lệ thu hồi công nợ đúng hạn, Gross margin / CAC payback period với ngưỡng cảnh báo cụ thể.'
            })
        ]
    },

    // ================= 4. QUẢN LÝ NHÂN SỰ =================
    {
        id: 'tpl-hr-ta-hrbp',
        domainCode: 'quan-ly-nhan-su',
        domainLabel: DOMAIN_LABELS['quan-ly-nhan-su'],
        title: 'Đánh giá Tuyển dụng (TA), Pháp luật Lao động & HRBP',
        description: 'Kiểm tra kiến thức Bộ luật Lao động Việt Nam, kỹ thuật đánh giá ứng viên và giải quyết tình huống giữ chân nhân sự.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('hr-1', 1, 'Theo Bộ luật Lao động 2019 (Việt Nam), thời gian thử việc tối đa đối với công việc có chức danh nghề nghiệp cần trình độ chuyên môn, kỹ thuật từ Cao đẳng trở lên (trừ vị trí quản lý doanh nghiệp) là bao lâu?', [
                { id: 'A', text: 'Không quá 30 ngày' },
                { id: 'B', text: 'Không quá 60 ngày' },
                { id: 'C', text: 'Không quá 90 ngày' },
                { id: 'D', text: 'Không quá 180 ngày' }
            ], 'B', 2, 'Tối đa 60 ngày cho trình độ cao đẳng trở lên; 180 ngày chỉ áp dụng cho người quản lý doanh nghiệp.'),
            qMcqMulti('hr-2', 2, 'Trong phỏng vấn hành vi theo mô hình STAR, những biểu hiện nào chứng tỏ câu trả lời của ứng viên đáng tin cậy thay vì nói chung chung?', [
                { id: 'A', text: 'Nêu rõ hành động cụ thể của chính ứng viên ("Tôi đã...") tách biệt với việc của nhóm' },
                { id: 'B', text: 'Chỉ kể định nghĩa lý thuyết trong sách giáo trình' },
                { id: 'C', text: 'Có bối cảnh thực tế và kết quả đo lường được hoặc bài học rút ra rõ ràng' },
                { id: 'D', text: 'Trả lời nhất quán khi người phỏng vấn đào sâu các bước trung gian' }
            ], ['A', 'C', 'D'], 2),
            qText('hr-3', 3, 'Ứng viên cho vị trí chủ chốt vừa nhận offer nhưng sát ngày nhận việc xin từ chối vì công ty cũ đề nghị tăng lương 20% (counter-offer). Bạn xử lý tình huống này như thế nào và làm gì để giảm tỷ lệ rớt sau offer trong tương lai?', {
                points: 4,
                rubric: 'Lắng nghe nguyên nhân thật ngoài lương, trao đổi trung thực về lộ trình/giá trị dài hạn, chuẩn bị ứng viên backup (warm pipeline), thiết kế quy trình pre-boarding giữ kết nối trước ngày onboard.'
            }),
            qText('hr-4', 4, 'Một trưởng nhóm chuyên môn phản ánh nhân sự mới vào 3 tuần có dấu hiệu lệch kỳ vọng công việc và có ý định nghỉ việc. Là HRBP, bạn thiết kế cuộc trao đổi 3 bên và kế hoạch khắc phục như thế nào?', {
                points: 3,
                rubric: 'Thu thập thông tin khách quan từ 2 phía trước khi gặp chung, rà soát JD thực tế vs kỳ vọng onboarding, thống nhất mục tiêu 30 ngày rõ ràng và lịch check-in.'
            })
        ]
    },
    {
        id: 'tpl-hr-cnb',
        domainCode: 'quan-ly-nhan-su',
        domainLabel: DOMAIN_LABELS['quan-ly-nhan-su'],
        title: 'Đánh giá C&B, Chính sách Lương thưởng & Quan hệ Lao động',
        description: 'Kiểm tra nghiệp vụ tính lương, làm thêm giờ, BHXH, thuế TNCN và thiết kế chính sách đãi ngộ cân bằng ngân sách.',
        timeLimitMinutes: 35,
        difficulty: 'MID',
        questions: [
            qMcqSingle('hr-cnb-1', 1, 'Theo Bộ luật Lao động 2019, mức trả lương làm thêm giờ vào ngày nghỉ hằng tuần (ban ngày) ít nhất bằng bao nhiêu phần trăm tiền lương giờ thực trả của công việc đang làm?', [
                { id: 'A', text: 'Ít nhất bằng 150%' },
                { id: 'B', text: 'Ít nhất bằng 200%' },
                { id: 'C', text: 'Ít nhất bằng 250%' },
                { id: 'D', text: 'Ít nhất bằng 300%' }
            ], 'B', 2),
            qMcqMulti('hr-cnb-2', 2, 'Khi thiết kế khung lương 3P (Position - Person - Performance), những nguyên tắc nào giúp hệ thống vận hành công bằng và minh bạch?', [
                { id: 'A', text: 'Định giá giá trị công việc (Job Evaluation) rõ ràng theo cấp bậc vị trí' },
                { id: 'B', text: 'Công khai mức lương cá nhân của từng nhân viên lên bảng tin chung' },
                { id: 'C', text: 'Gắn phần thưởng hiệu suất với KPI đo lường được và chu kỳ đánh giá rõ ràng' },
                { id: 'D', text: 'Đối chiếu dữ liệu lương thị trường (Salary Benchmark) định kỳ để tránh tụt hậu' }
            ], ['A', 'C', 'D'], 2),
            qText('hr-cnb-3', 3, 'Trong kỳ trả lương tháng, một lỗi công thức bảng lương làm 12 nhân viên bị khấu trừ nhầm tiền công đoàn/thuế và họ phản ứng gay gắt trên nhóm nội bộ. Trình bày quy trình xử lý minh bạch, đúng luật và ổn định tâm lý nhân viên.', {
                points: 4,
                rubric: 'Thừa nhận sai sót nhanh chóng, rà soát toàn bộ bảng lương để không bỏ sót người khác, thông báo mốc hoàn trả cụ thể bằng văn bản, cập nhật checklist kiểm tra chéo 2 lớp.'
            }),
            qText('hr-cnb-4', 4, 'Ban Giám đốc yêu cầu giữ chân đội ngũ nòng cốt nhưng tổng quỹ lương cố định năm nay chỉ được tăng tối đa 5%. Bạn đề xuất cơ cấu đãi ngộ tổng thể (Total Rewards) như thế nào?', {
                points: 3,
                rubric: 'Phân bổ 5% trọng tâm vào các vị trí then chốt/dưới thị trường, kết hợp thưởng theo hiệu quả dự án/KPI, phụ cấp đào tạo, linh hoạt giờ làm và ghi nhận phi tài chính.'
            })
        ]
    },

    // ================= 5. GIÁO VIÊN =================
    {
        id: 'tpl-edu-pedagogy',
        domainCode: 'giao-vien',
        domainLabel: DOMAIN_LABELS['giao-vien'],
        title: 'Đánh giá Phương pháp Sư phạm, Dạy học Phân hóa & Quản lý Lớp học',
        description: 'Kiểm tra năng lực thiết kế hoạt động dạy học theo mục tiêu nhận thức, đánh giá học viên và phối hợp cùng phụ huynh.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('edu-p-1', 1, 'Hoạt động kiểm tra nhanh đầu giờ bằng 3 câu hỏi ngắn không lấy điểm nhằm phát hiện lỗ hổng kiến thức trước khi vào bài mới thuộc loại đánh giá nào?', [
                { id: 'A', text: 'Đánh giá quá trình / chẩn đoán (Formative / Diagnostic Assessment)' },
                { id: 'B', text: 'Đánh giá tổng kết cuối kỳ (Summative Assessment)' },
                { id: 'C', text: 'Đánh giá xếp hạng chuẩn hóa quốc gia' },
                { id: 'D', text: 'Đánh giá hành chính định kỳ' }
            ], 'A', 2),
            qMcqMulti('edu-p-2', 2, 'Khi áp dụng dạy học phân hóa trong một lớp có học viên chênh lệch trình độ, những cách làm nào mang lại hiệu quả thực tế?', [
                { id: 'A', text: 'Chuẩn bị nhiệm vụ học tập theo bậc thang độ khó (nền tảng -> vận dụng -> mở rộng)' },
                { id: 'B', text: 'Chỉ giảng cho nhóm giỏi để tiết kiệm thời gian' },
                { id: 'C', text: 'Kết hợp ghép cặp hỗ trợ (peer tutoring) có hướng dẫn vai trò rõ ràng' },
                { id: 'D', text: 'Cung cấp phiếu gợi ý/scaffolding cho nhóm cần hỗ trợ thêm mà không làm hộ kết quả' }
            ], ['A', 'C', 'D'], 2),
            qText('edu-p-3', 3, 'Hãy phác thảo kịch bản tổ chức một tiết học 45 phút cho chủ đề chuyên môn của bạn (tự chọn một chủ đề thuộc môn/khóa học ứng tuyển), nêu rõ: Mục tiêu đầu ra, Hoạt động khởi động, Hoạt động thực hành phân hóa và Cách kiểm tra mức độ hiểu bài cuối giờ.', {
                points: 4,
                rubric: 'Mục tiêu đo lường được (theo động từ Bloom), thời lượng thực tế, tỉ lệ học viên chủ động thực hành cao, có bước kiểm tra exit-ticket cuối tiết.'
            }),
            qText('edu-p-4', 4, 'Một phụ huynh nhắn tin bức xúc rằng điểm bài kiểm tra giữa kỳ của học viên giảm mạnh và nghi ngờ cách dạy trên lớp không phù hợp. Bạn sẽ phản hồi và triển khai kế hoạch hỗ trợ như thế nào?', {
                points: 3,
                rubric: 'Lắng nghe cầu thị, dùng dữ liệu bài làm cụ thể để chỉ ra kỹ năng học viên đang vướng (không chỉ trích), đề xuất lộ trình hỗ trợ 2-4 tuần giữa giáo viên - học viên - gia đình.'
            })
        ]
    },
    {
        id: 'tpl-edu-coaching',
        domainCode: 'giao-vien',
        domainLabel: DOMAIN_LABELS['giao-vien'],
        title: 'Đánh giá Thiết kế Học liệu, Rubric & Tương tác Lớp học Hiện đại',
        description: 'Đánh giá kỹ năng phản hồi xây dựng, thiết kế rubric chấm điểm khách quan và duy trì động lực học tập.',
        timeLimitMinutes: 35,
        difficulty: 'JUNIOR',
        questions: [
            qMcqSingle('edu-c-1', 1, 'Điểm cốt lõi nhất của kỹ thuật Scaffolding (giàn giáo sư phạm) trong giảng dạy kỹ năng phức tạp là gì?', [
                { id: 'A', text: 'Hỗ trợ có cấu trúc ở giai đoạn đầu rồi giảm dần trợ giúp khi học viên tự làm chủ được kỹ năng' },
                { id: 'B', text: 'Giải toàn bộ bài mẫu để học viên chép lại nguyên văn' },
                { id: 'C', text: 'Giao bài thật khó ngay từ buổi đầu mà không hướng dẫn gì' },
                { id: 'D', text: 'Chỉ kiểm tra trắc nghiệm ghi nhớ máy móc' }
            ], 'A', 2),
            qMcqMulti('edu-c-2', 2, 'Một Rubric chấm điểm bài tập/dự án chất lượng cần có những đặc điểm nào?', [
                { id: 'A', text: 'Tiêu chí đánh giá tách bạch rõ ràng theo mục tiêu học tập' },
                { id: 'B', text: 'Mô tả cụ thể biểu hiện ở từng mức điểm (Xuất sắc / Đạt / Cần cải thiện)' },
                { id: 'C', text: 'Giữ bí mật Rubric với học viên cho tới sau khi công bố điểm' },
                { id: 'D', text: 'Giúp nhiều giáo viên khác nhau chấm cùng một bài vẫn giữ độ nhất quán cao' }
            ], ['A', 'B', 'D'], 2),
            qText('edu-c-3', 3, 'Một học viên nộp bài tập có ý tưởng sáng tạo nhưng mắc lỗi lập luận cốt lõi nên chỉ đạt 5/10. Viết đoạn nhận xét phản hồi mẫu (khoảng 100-150 từ) giúp học viên giữ được tự tin nhưng hiểu chính xác chỗ cần sửa.', {
                points: 4,
                rubric: 'Ghi nhận cụ thể điểm tốt trước, chỉ ra lỗi lập luận khách quan với ví dụ chỉnh sửa gợi mở, nêu 1-2 hành động tiếp theo rõ ràng.'
            }),
            qText('edu-c-4', 4, 'Trong một buổi học trực tuyến 25 học viên mà đa số tắt camera và ít phát biểu, bạn sẽ dùng 3 kỹ thuật nào để kích hoạt tương tác thực chất mà không gây áp lực tiêu cực?', {
                points: 3,
                rubric: 'Breakout room nhỏ với nhiệm vụ rõ ràng, micro-poll/chat phản hồi nhanh trong 30s, kỹ thuật cold-call ấm áp kèm thời gian suy nghĩ trước (think-pair-share).'
            })
        ]
    },

    // ================= 6. BẤT ĐỘNG SẢN =================
    {
        id: 'tpl-re-brokerage',
        domainCode: 'bat-dong-san',
        domainLabel: DOMAIN_LABELS['bat-dong-san'],
        title: 'Đánh giá Pháp lý Giao dịch, Thẩm định & Tư vấn Môi giới Bất động sản',
        description: 'Kiểm tra kiến thức pháp lý chuyển nhượng, đặt cọc, phương pháp định giá và xử lý tranh chấp cọc.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('re-b-1', 1, 'Trước khi hướng dẫn khách hàng ký hợp đồng đặt cọc mua nhà đất riêng lẻ đã có Sổ hồng/Sổ đỏ, bước kiểm tra pháp lý nào KHÔNG THỂ bỏ qua?', [
                { id: 'A', text: 'Đối chiếu bản chính Giấy chứng nhận, thông tin chủ sở hữu/đồng sở hữu (vợ chồng), tình trạng thế chấp/ngăn chặn giao dịch và quy hoạch hiện hành' },
                { id: 'B', text: 'Chỉ xem ảnh chụp mặt trước Sổ đỏ qua tin nhắn là đủ ký cọc' },
                { id: 'C', text: 'Hỏi miệng hàng xóm mà không kiểm tra văn bản công chứng' },
                { id: 'D', text: 'Đặt cọc toàn bộ 90% giá trị trước khi kiểm tra quy hoạch' }
            ], 'A', 2),
            qMcqMulti('re-b-2', 2, 'Khi thẩm định giá chào bán một căn hộ/nhà phố cho khách hàng mua ở hoặc đầu tư, các yếu tố nào tạo nên khung định giá đáng tin cậy?', [
                { id: 'A', text: 'Dữ liệu các giao dịch thực tế thành công tương đồng trong khu vực 3-6 tháng gần nhất (Comparison)' },
                { id: 'B', text: 'Chỉ lấy giá tin rao cao nhất trên mạng cộng thêm 15%' },
                { id: 'C', text: 'Phân tích tỷ suất cho thuê ròng (Rental Yield), hiện trạng pháp lý và chi phí sửa chữa/nội thất' },
                { id: 'D', text: 'Đánh giá yếu tố vi mô: hẻm/lộ giới, hướng, ánh sáng, phí quản lý và hạ tầng kết nối' }
            ], ['A', 'C', 'D'], 2),
            qText('re-b-3', 3, 'Bên bán nhận cọc 200 triệu đồng, hẹn 20 ngày ra công chứng. Đến ngày thứ 15, giá khu vực tăng nên bên bán đòi trả lại 200 triệu và hủy giao dịch (từ chối phạt cọc). Là chuyên viên tư vấn giao dịch, bạn xử lý và tham mưu cho hai bên như thế nào để bảo vệ quyền lợi hợp pháp và uy tín?', {
                points: 4,
                rubric: 'Căn cứ hợp đồng đặt cọc & quy định Bộ luật Dân sự về phạt cọc, giải thích rõ nghĩa vụ và rủi ro kiện tụng/ngăn chặn giao dịch cho bên bán, tổ chức đàm phán thiện chí hoặc hỗ trợ khách thu thập chứng cứ lập vi bằng/khởi kiện.'
            }),
            qText('re-b-4', 4, 'Một khách hàng gia đình trẻ có tài chính sẵn có 1,5 tỷ và khả năng trả góp tối đa 18 triệu/tháng đang phân vân giữa căn hộ đã có sổ giá 3,1 tỷ và dự án hình thành trong tương lai giá 2,8 tỷ. Bạn cấu trúc bài tư vấn phân tích ưu/nhược điểm và dòng tiền như thế nào?', {
                points: 3,
                rubric: 'Kiểm tra an toàn đòn bẩy vay 50-55%, lãi suất thả nổi sau ưu đãi, tiến độ/pháp lý chủ đầu tư, chi phí thuê nhà song song khi chờ bàn giao để đưa ra khuyến nghị khách quan.'
            })
        ]
    },
    {
        id: 'tpl-re-leasing',
        domainCode: 'bat-dong-san',
        domainLabel: DOMAIN_LABELS['bat-dong-san'],
        title: 'Đánh giá Cho thuê Thương mại, Hợp đồng Mặt bằng & Vận hành Tòa nhà',
        description: 'Kiểm tra khái niệm diện tích NLA, điều khoản thương mại thuê mặt bằng và quy trình vận hành sự cố.',
        timeLimitMinutes: 35,
        difficulty: 'MID',
        questions: [
            qMcqSingle('re-l-1', 1, 'Trong hợp đồng thuê văn phòng/mặt bằng thương mại, thuật ngữ "Fit-out period" thường dùng để chỉ điều gì?', [
                { id: 'A', text: 'Khoảng thời gian khách thuê được bàn giao mặt bằng để thi công hoàn thiện nội thất (thường miễn tiền thuê cơ bản nhưng vẫn có thể tính phí dịch vụ/điện nước)' },
                { id: 'B', text: 'Thời gian chủ nhà giữ tiền đặt cọc sau khi thanh lý hợp đồng' },
                { id: 'C', text: 'Tỷ lệ tăng giá thuê định kỳ hằng năm' },
                { id: 'D', text: 'Diện tích hành lang chung không được sử dụng' }
            ], 'A', 2),
            qMcqMulti('re-l-2', 2, 'Khi đánh giá hiệu quả vận hành và thu hút khách thuê cho một tòa nhà văn phòng hạng B, những chỉ số/yếu tố nào cần quản trị chặt chẽ?', [
                { id: 'A', text: 'Tỷ lệ lấp đầy (Occupancy Rate) và tỷ lệ gia hạn hợp đồng (Renewal Rate)' },
                { id: 'B', text: 'Thời gian phản hồi xử lý sự cố kỹ thuật / PCCC / thang máy (SLA vận hành)' },
                { id: 'C', text: 'Cắt giảm toàn bộ ngân sách bảo trì PCCC để tăng lợi nhuận ngắn hạn' },
                { id: 'D', text: 'Minh bạch hóa cấu trúc phí dịch vụ (Service Charge) và chỉ số sử dụng điện lạnh' }
            ], ['A', 'B', 'D'], 2),
            qText('re-l-3', 3, 'Một khách thuê lớn chiếm 25% diện tích tòa nhà sắp hết hạn hợp đồng 3 năm và yêu cầu giảm 10% giá thuê hoặc miễn 2 tháng tiền thuê nếu ký gia hạn 3 năm tiếp theo. Bạn đề xuất phương án đàm phán cân bằng doanh thu hiệu quả (Effective Rent) thế nào?', {
                points: 4,
                rubric: 'So sánh chi phí trống mặt bằng + chi phí môi giới/fit-out nếu tìm khách mới vs nhượng bộ có điều kiện (ví dụ giữ đơn giá niêm yết tốt cho định giá tòa nhà và tặng rent-free rải đều kèm điều khoản tăng giá các năm sau).'
            }),
            qText('re-l-4', 4, 'Lúc 10h sáng thứ Hai, hệ thống điều hòa trung tâm tầng 6 gặp sự cố dừng hoạt động khiến 4 công ty thuê phản ánh gay gắt. Trình bày quy trình phối hợp giao tiếp khách hàng và xử lý hiện trường.', {
                points: 3,
                rubric: 'Thông báo minh bạch trong 15 phút đầu kèm mốc kiểm tra kỹ thuật, cung cấp giải pháp tạm thời (quạt công nghiệp/phòng họp trống), cập nhật tiến độ đều đặn và gửi báo cáo khắc phục phòng ngừa sau sự cố.'
            })
        ]
    },

    // ================= 7. LUẬT =================
    {
        id: 'tpl-law-contract',
        domainCode: 'luat',
        domainLabel: DOMAIN_LABELS['luat'],
        title: 'Đánh giá Pháp chế Doanh nghiệp, Rà soát Hợp đồng & Giải quyết Tranh chấp',
        description: 'Kiểm tra nắm vững Luật Thương mại/Dân sự Việt Nam, kỹ năng redline điều khoản rủi ro và soạn thảo Legal Memo.',
        timeLimitMinutes: 45,
        difficulty: 'MID',
        questions: [
            qMcqSingle('law-c-1', 1, 'Theo Luật Thương mại 2005 (Việt Nam), mức phạt đối với vi phạm nghĩa vụ hợp đồng thương mại do các bên thỏa thuận tối đa là bao nhiêu (trừ trường hợp giám định sai theo quy định riêng)?', [
                { id: 'A', text: 'Không quá 8% giá trị phần nghĩa vụ hợp đồng bị vi phạm' },
                { id: 'B', text: 'Không quá 12% tổng giá trị toàn bộ hợp đồng' },
                { id: 'C', text: 'Không giới hạn mức phạt miễn hai bên cùng ký tên' },
                { id: 'D', text: 'Không quá 5% tổng giá trị hợp đồng' }
            ], 'A', 2, 'Điều 301 Luật Thương mại 2005: tối đa 8% giá trị phần nghĩa vụ hợp đồng bị vi phạm.'),
            qMcqMulti('law-c-2', 2, 'Khi rà soát một Hợp đồng cung cấp dịch vụ dài hạn dưới góc độ bảo vệ Bên Sử dụng dịch vụ (Bên A), các rủi ro pháp lý nào cần thương lượng điều chỉnh ngay?', [
                { id: 'A', text: 'Điều khoản cho phép Nhà cung cấp đơn phương tăng giá hoặc thay đổi SLA bất kỳ lúc nào mà không cần thông báo hay quyền chấm dứt cho Bên A' },
                { id: 'B', text: 'Nhà cung cấp được miễn trừ mọi trách nhiệm ngay cả khi cố ý làm lộ dữ liệu mật của Bên A' },
                { id: 'C', text: 'Yêu cầu hai bên ký thỏa thuận bảo mật thông tin NDA và quy định hoàn trả/hủy dữ liệu khi chấm dứt hợp đồng' },
                { id: 'D', text: 'Điều khoản tự động gia hạn không cần xác nhận và phạt 100% giá trị cả năm nếu thông báo hủy chậm 1 ngày' }
            ], ['A', 'B', 'D'], 2),
            qText('law-c-3', 3, 'Rà soát và viết lại (Redline) điều khoản sau để bảo vệ hợp pháp quyền lợi của Công ty (Bên Mua) theo pháp luật Việt Nam:\n"Bên Bán không chịu bất kỳ trách nhiệm bồi thường nào trong mọi trường hợp phát sinh lỗi hệ thống. Nếu Bên Mua chậm thanh toán quá 03 ngày sẽ bị phạt 20% tổng giá trị hợp đồng và Bên Bán có quyền khóa vĩnh viễn toàn bộ dữ liệu của Bên Mua."', {
                points: 4,
                rubric: 'Chỉ ra điều khoản vô hiệu/vượt trần phạt 8% (LTM) hoặc bất công bằng theo BLDS, khôi phục nghĩa vụ bồi thường thiệt hại thực tế (có thể gắn trần hợp lý nhưng không miễn trừ lỗi cố ý/vi phạm nghiêm trọng), quy trình thông báo khắc phục (cure period) và nghĩa vụ bàn giao dữ liệu khi chấm dứt.'
            }),
            qText('law-c-4', 4, 'Ban Giám đốc dự định ký hợp đồng hợp tác trị giá 3 tỷ đồng với một đối tác mới thành lập, trong đó đối tác đề xuất áp dụng Luật điều chỉnh của Singapore và Trọng tài SIAC. Viết ngắn gọn Legal Memo nêu rủi ro chi phí/thực thi phán quyết và phương án đề xuất thay thế thực tế.', {
                points: 3,
                rubric: 'Phân tích chi phí trọng tài quốc tế bất cân xứng với giá trị 3 tỷ, vấn đề công nhận và cho thi hành phán quyết trọng tài nước ngoài tại Việt Nam; đề xuất áp dụng pháp luật Việt Nam và VIAC hoặc tòa án có thẩm quyền.'
            })
        ]
    },
    {
        id: 'tpl-law-compliance',
        domainCode: 'luat',
        domainLabel: DOMAIN_LABELS['luat'],
        title: 'Đánh giá Pháp luật Lao động, Bảo vệ Dữ liệu Cá nhân & Sở hữu Trí tuệ',
        description: 'Tập trung vào tuân thủ Nghị định 13/2023/NĐ-CP, xử lý kỷ luật lao động và bảo vệ tài sản trí tuệ doanh nghiệp.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('law-l-1', 1, 'Theo Bộ luật Lao động 2019, doanh nghiệp muốn áp dụng hình thức xử lý kỷ luật sa thải hoặc kéo dài thời hạn nâng lương hợp pháp bắt buộc phải có điều kiện nền tảng nào?', [
                { id: 'A', text: 'Hành vi vi phạm phải được quy định trong Nội quy lao động (đã đăng ký hợp lệ nếu từ 10 NLĐ trở lên) và tuân thủ đúng trình tự, thời hiệu, thành phần họp xử lý kỷ luật' },
                { id: 'B', text: 'Chỉ cần trưởng phòng trực tiếp gửi email thông báo nghỉ việc ngay trong ngày' },
                { id: 'C', text: 'Chỉ cần ghi chung chung trong sổ tay văn hóa mà không cần thông báo cho người lao động' },
                { id: 'D', text: 'Có thể vừa phạt trừ lương vừa sa thải cùng một hành vi' }
            ], 'A', 2),
            qMcqMulti('law-l-2', 2, 'Theo Nghị định 13/2023/NĐ-CP về Bảo vệ dữ liệu cá nhân, khi thu thập và lưu trữ CV của ứng viên trên hệ thống tuyển dụng, doanh nghiệp cần tuân thủ những nghĩa vụ nào?', [
                { id: 'A', text: 'Thông báo rõ mục đích xử lý dữ liệu và xin sự đồng ý rõ ràng, có thể kiểm chứng của ứng viên' },
                { id: 'B', text: 'Tự ý bán hoặc chia sẻ danh sách số điện thoại ứng viên cho đối tác quảng cáo bên ngoài' },
                { id: 'C', text: 'Áp dụng biện pháp bảo mật, kiểm soát phân quyền truy cập CV và có cơ chế xóa/rút lại đồng ý theo yêu cầu hợp lệ' },
                { id: 'D', text: 'Lập hồ sơ đánh giá tác động xử lý dữ liệu cá nhân theo quy định đối với chủ thể xử lý' }
            ], ['A', 'C', 'D'], 2),
            qText('law-l-3', 3, 'Một nhân sự kỹ thuật cũ sau khi nghỉ việc bị phát hiện sử dụng tài liệu thiết kế sản phẩm và danh sách khách hàng nội bộ để chào mời khách sang công ty đối thủ. Hãy đánh giá căn cứ pháp lý (Lao động, Dân sự, SHTT/Cạnh tranh không lành mạnh) và đề xuất các bước thu thập chứng cứ & hành động.', {
                points: 4,
                rubric: 'Kiểm tra NDA/cam kết bảo mật & điều khoản SHTT đã ký, phân biệt thông tin công khai vs bí mật kinh doanh, tiến hành lập vi bằng chứng cứ trước khi cảnh báo, đánh giá khởi kiện/khiếu nại cạnh tranh không lành mạnh.'
            }),
            qText('law-l-4', 4, 'Soạn tóm tắt các ý chính cần có trong Điều khoản Sở hữu Trí tuệ (IP Assignment) và Bàn giao sản phẩm công việc của Hợp đồng lao động cho nhân sự sáng tạo/công nghệ.', {
                points: 3,
                rubric: 'Khẳng định sản phẩm tạo ra theo nhiệm vụ được giao/dùng nguồn lực công ty thuộc sở hữu công ty; tách bạch SHTT có từ trước (background IP); nghĩa vụ bàn giao toàn bộ tài khoản/tài liệu và hỗ trợ đăng ký bảo hộ.'
            })
        ]
    },

    // ================= 8. LOGISTICS =================
    {
        id: 'tpl-log-incoterms',
        domainCode: 'logistics',
        domainLabel: DOMAIN_LABELS['logistics'],
        title: 'Đánh giá Xuất nhập khẩu, Incoterms 2020 & Thông quan Chuỗi cung ứng',
        description: 'Kiểm tra hiểu biết chính xác về điểm chuyển giao rủi ro/chi phí theo Incoterms 2020, bộ chứng từ và xử lý tắc nghẽn cảng.',
        timeLimitMinutes: 40,
        difficulty: 'MID',
        questions: [
            qMcqSingle('log-i-1', 1, 'Theo điều kiện CIF (Incoterms 2020), điểm chuyển giao RỦI RO đối với hàng hóa từ Người bán sang Người mua diễn ra khi nào?', [
                { id: 'A', text: 'Khi hàng hóa được xếp an toàn lên boong tàu (on board the vessel) tại cảng bốc hàng đi' },
                { id: 'B', text: 'Khi tàu cập cảng đích và dỡ xong container lên bãi cảng' },
                { id: 'C', text: 'Khi hàng về tới kho nội địa của người mua' },
                { id: 'D', text: 'Khi người bán phát hành hóa đơn thương mại' }
            ], 'A', 2, 'Theo nhóm C (CIF/CFR), người bán chịu cước/bảo hiểm tới cảng đích nhưng RỦI RO chuyển giao ngay khi hàng lên tàu tại cảng đi.'),
            qMcqMulti('log-i-2', 2, 'Trong một bộ chứng từ nhập khẩu đường biển chuẩn làm thủ tục hải quan & thanh toán L/C, những chứng từ nào thường đóng vai trò cốt lõi?', [
                { id: 'A', text: 'Vận đơn đường biển (Bill of Lading - B/L)' },
                { id: 'B', text: 'Hóa đơn thương mại (Commercial Invoice) & Phiếu đóng gói (Packing List)' },
                { id: 'C', text: 'Giấy chứng nhận xuất xứ (C/O) để hưởng ưu đãi thuế quan nếu đủ điều kiện' },
                { id: 'D', text: 'Biên bản họp giao ban nội bộ phòng kinh doanh' }
            ], ['A', 'B', 'C'], 2),
            qText('log-i-3', 3, 'Một lô nguyên vật liệu nhập khẩu gấp cho nhà máy bị hệ thống hải quan phân luồng Đỏ do nghi ngờ sai khác mô tả/mã HS trên tờ khai, khiến nguy cơ thiếu vật tư chạy chuyền sau 48 giờ. Bạn điều phối xử lý sự cố này như thế nào?', {
                points: 4,
                rubric: 'Phối hợp ngay với đội chứng từ/forwarder rà lại catalog kỹ thuật và bản khai trước khi kiểm hóa thực tế, thông báo sớm cho bộ phận Kế hoạch sản xuất để điều chuyển tồn kho an toàn/đổi lịch chuyền, dự trù phí DEM/DET.'
            }),
            qText('log-i-4', 4, 'Một tuyến hàng linh kiện từ Thượng Hải về Hải Phòng: đi đường biển mất 8 ngày với chi phí 1.200 USD/lô, đi đường hàng không mất 2 ngày với chi phí 4.800 USD/lô. Nếu mỗi ngày dừng chuyền sản xuất gây thiệt hại 1.500 USD, hãy phân tích khi nào nên chọn Air hoặc giải pháp kết hợp.', {
                points: 3,
                rubric: 'So sánh chênh lệch 3.600 USD cước vs 6 ngày * 1.500 USD = 9.000 USD thiệt hại nếu thiếu vật tư -> chọn Air cho phần đủ chạy 6 ngày (split shipment), phần còn lại đi Sea để tối ưu tổng chi phí.'
            })
        ]
    },
    {
        id: 'tpl-log-warehouse',
        domainCode: 'logistics',
        domainLabel: DOMAIN_LABELS['logistics'],
        title: 'Đánh giá Quản trị Kho vận (WMS), Tồn kho & Điều phối Vận tải',
        description: 'Kiểm tra nguyên lý xuất kho FEFO/FIFO, đo lường OTIF, xử lý chênh lệch kiểm kê và tối ưu tuyến giao hàng.',
        timeLimitMinutes: 35,
        difficulty: 'MID',
        questions: [
            qMcqSingle('log-w-1', 1, 'Với kho hàng thực phẩm/dược phẩm có hạn sử dụng khác nhau giữa các lô nhập, quy tắc xuất kho nào giúp giảm tối đa rủi ro hàng hết hạn (expired)?', [
                { id: 'A', text: 'FEFO (First Expired, First Out — Hết hạn trước xuất trước)' },
                { id: 'B', text: 'LIFO (Last In, First Out — Nhập sau xuất trước)' },
                { id: 'C', text: 'Xuất ngẫu nhiên theo vị trí gần cửa nhất' },
                { id: 'D', text: 'Chỉ ưu tiên xuất hàng có kích thước nhỏ nhất' }
            ], 'A', 2),
            qMcqMulti('log-w-2', 2, 'Để đánh giá chất lượng giao hàng và hiệu suất kho vận một cách toàn diện, những KPI nào thường được dùng song song?', [
                { id: 'A', text: 'OTIF (On-Time In-Full — Giao đúng giờ và đủ số lượng)' },
                { id: 'B', text: 'Inventory Accuracy (Độ chính xác tồn kho giữa hệ thống WMS và thực tế)' },
                { id: 'C', text: 'Order Picking Error Rate & Dock-to-Stock Time' },
                { id: 'D', text: 'Số lượng cuộc họp nội bộ trong tuần' }
            ], ['A', 'B', 'C'], 2),
            qText('log-w-3', 3, 'Trước đợt cao điểm bán hàng, kiểm kê mẫu phát hiện tồn kho thực tế của nhóm hàng bán chạy lệch giảm 4% so với số liệu trên WMS. Trình bày các bước truy tìm nguyên nhân gốc rễ và ngăn tái diễn.', {
                points: 4,
                rubric: 'Khoanh vùng giao dịch nhập-xuất-trả hàng gần nhất của các SKU lệch, kiểm tra lỗi quét barcode/chứng từ xuất tay chưa nhập hệ thống/hư hỏng không lập biên bản, thực hiện cycle count và khóa quyền điều chỉnh kho.'
            }),
            qText('log-w-4', 4, 'Chi phí vận tải nội đô chặng cuối (last-mile) đang chiếm tỷ trọng cao do xe tải đi nhiều chuyến không đầy tải (low load factor) và quay đầu giờ cấm. Bạn đề xuất những giải pháp điều phối nào để giảm 10-15% chi phí/đơn?', {
                points: 3,
                rubric: 'Gom đơn theo cụm địa lý (clustering) & tối ưu lộ trình (VRP), quy định cut-off time cố định, ghép giao nhận 2 chiều hoặc đổi loại phương tiện linh hoạt theo khung giờ cấm tải.'
            })
        ]
    }
];

export const normalizeDomainCode = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
};

export const isSupportedDomain = (domainCode) => {
    const code = normalizeDomainCode(domainCode);
    return Object.hasOwn(DOMAIN_LABELS, code);
};

export const domainLabelOf = (domainCode, fallbackName = null) => {
    const code = normalizeDomainCode(domainCode);
    if (Object.hasOwn(DOMAIN_LABELS, code)) return DOMAIN_LABELS[code];
    if (typeof fallbackName === 'string' && fallbackName.trim()) return fallbackName.trim();
    return code || 'Chưa xác định lĩnh vực';
};

const clone = (value) => JSON.parse(JSON.stringify(value));

// Chi tra ve mau thuoc DUNG domainCode duoc yeu cau. Tuyet doi khong fallback sang nganh khac.
export const getTemplatesForDomain = (domainCode) => {
    const code = normalizeDomainCode(domainCode);
    if (!code) return [];
    return RAW_TEMPLATES.filter((tpl) => tpl.domainCode === code).map(clone);
};

export const findTemplateById = (templateId) => {
    if (typeof templateId !== 'string' || !templateId.trim()) return null;
    const found = RAW_TEMPLATES.find((tpl) => tpl.id === templateId.trim());
    return found ? clone(found) : null;
};

export const listAllDomainTemplates = () => RAW_TEMPLATES.map(clone);

export const normalizeQuestion = (raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`Câu hỏi #${index + 1} không hợp lệ`);
    }
    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    if (!QUESTION_TYPES.includes(type)) {
        throw new Error(`Loại câu hỏi "${type}" ở câu #${index + 1} không được hỗ trợ`);
    }
    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
    if (!prompt || prompt.length > 4000) {
        throw new Error(`Nội dung câu hỏi #${index + 1} phải từ 1 đến 4000 ký tự`);
    }
    const points = Number(raw.points ?? (type.startsWith('mcq') ? 2 : 4));
    if (!Number.isFinite(points) || points <= 0 || points > 100) {
        throw new Error(`Điểm tối đa của câu #${index + 1} phải nằm trong khoảng (0, 100]`);
    }
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(raw.id.trim())
        ? raw.id.trim()
        : `q-${index + 1}`;
    const order = Number.isInteger(raw.order) && raw.order > 0 ? raw.order : index + 1;

    if (type === 'mcq_single' || type === 'mcq_multi') {
        if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 8) {
            throw new Error(`Câu trắc nghiệm #${index + 1} cần từ 2 đến 8 đáp án`);
        }
        const seenOptionIds = new Set();
        const options = raw.options.map((opt, optIdx) => {
            if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
                throw new Error(`Đáp án #${optIdx + 1} của câu #${index + 1} không hợp lệ`);
            }
            const optId = typeof opt.id === 'string' && opt.id.trim()
                ? opt.id.trim().slice(0, 16)
                : String.fromCharCode(65 + optIdx);
            const optText = typeof opt.text === 'string' ? opt.text.trim() : '';
            if (!optText || optText.length > 1000) {
                throw new Error(`Nội dung đáp án ${optId} ở câu #${index + 1} không hợp lệ`);
            }
            if (seenOptionIds.has(optId)) {
                throw new Error(`Trùng mã đáp án "${optId}" ở câu #${index + 1}`);
            }
            seenOptionIds.add(optId);
            return { id: optId, text: optText };
        });

        const correctList = Array.isArray(raw.correctOptionIds)
            ? [...new Set(raw.correctOptionIds.map((v) => String(v).trim()).filter(Boolean))]
            : [];
        if (type === 'mcq_single' && correctList.length !== 1) {
            throw new Error(`Câu trắc nghiệm 1 đáp án #${index + 1} phải chọn đúng 1 đáp án đúng`);
        }
        if (type === 'mcq_multi' && correctList.length < 1) {
            throw new Error(`Câu trắc nghiệm nhiều đáp án #${index + 1} phải có ít nhất 1 đáp án đúng`);
        }
        for (const cid of correctList) {
            if (!seenOptionIds.has(cid)) {
                throw new Error(`Đáp án đúng "${cid}" không tồn tại trong danh sách đáp án câu #${index + 1}`);
            }
        }
        const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim().slice(0, 2000) : '';
        return { id, order, type, prompt, points: Number(points.toFixed(2)), options, correctOptionIds: correctList, explanation };
    }

    const rubric = typeof raw.rubric === 'string' ? raw.rubric.trim().slice(0, 3000) : '';
    const sampleAnswer = typeof raw.sampleAnswer === 'string' ? raw.sampleAnswer.trim().slice(0, 10000) : '';

    if (type === 'code') {
        const language = CODE_LANGUAGES.includes(raw.language) ? raw.language : 'javascript';
        const starterCode = typeof raw.starterCode === 'string' ? raw.starterCode.slice(0, 10000) : '';
        return { id, order, type, prompt, points: Number(points.toFixed(2)), language, starterCode, rubric, sampleAnswer };
    }

    const placeholder = typeof raw.placeholder === 'string' && raw.placeholder.trim()
        ? raw.placeholder.trim().slice(0, 300)
        : 'Nhập câu trả lời chi tiết của bạn...';
    const maxLength = Number.isInteger(raw.maxLength) && raw.maxLength >= 50 && raw.maxLength <= 15000
        ? raw.maxLength
        : 8000;
    return { id, order, type, prompt, points: Number(points.toFixed(2)), placeholder, maxLength, rubric, sampleAnswer };
};

export const normalizeQuestions = (questions) => {
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 25) {
        throw new Error('Bài test cần có từ 1 đến 25 câu hỏi');
    }
    const normalized = questions.map((q, idx) => normalizeQuestion(q, idx));
    const ids = new Set(normalized.map((q) => q.id));
    if (ids.size !== normalized.length) {
        throw new Error('Mã câu hỏi (question.id) trong bài test không được trùng lặp');
    }
    return normalized;
};

// Loai bo hoan toan dap an dung, rubric va goi y cham diem truoc khi gui xuong ung vien dang lam bai.
export const sanitizeQuestionsForCandidate = (questions, { includeSolutions = false } = {}) => {
    if (!Array.isArray(questions)) return [];
    return questions.map((q) => {
        if (includeSolutions) return clone(q);
        const base = { id: q.id, order: q.order, type: q.type, prompt: q.prompt, points: q.points };
        if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
            return { ...base, options: clone(q.options || []) };
        }
        if (q.type === 'code') {
            return { ...base, language: q.language || 'javascript', starterCode: q.starterCode || '' };
        }
        return { ...base, placeholder: q.placeholder || '', maxLength: q.maxLength || 8000 };
    });
};

export const computeMcqAutoEvaluation = (questions = [], answers = {}) => {
    let mcqScore = 0;
    let mcqMaxScore = 0;
    let openMaxScore = 0;
    const perQuestion = [];

    for (const q of questions) {
        const pts = Number(q.points || 0);
        const answer = answers && typeof answers === 'object' ? answers[q.id] : null;
        if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
            mcqMaxScore += pts;
            const selected = Array.isArray(answer?.selectedOptionIds)
                ? [...new Set(answer.selectedOptionIds.map((v) => String(v).trim()).filter(Boolean))].sort()
                : [];
            const expected = [...new Set((q.correctOptionIds || []).map((v) => String(v).trim()))].sort();
            const isCorrect = selected.length === expected.length && selected.every((v, i) => v === expected[i]);
            const earned = isCorrect ? pts : 0;
            mcqScore += earned;
            perQuestion.push({
                questionId: q.id,
                type: q.type,
                autoGraded: true,
                isCorrect,
                earnedPoints: Number(earned.toFixed(2)),
                maxPoints: Number(pts.toFixed(2)),
                selectedOptionIds: selected
            });
        } else {
            openMaxScore += pts;
            perQuestion.push({
                questionId: q.id,
                type: q.type,
                autoGraded: false,
                isCorrect: null,
                earnedPoints: null,
                maxPoints: Number(pts.toFixed(2))
            });
        }
    }

    const totalMaxScore = mcqMaxScore + openMaxScore;
    return {
        mcqScore: Number(mcqScore.toFixed(2)),
        mcqMaxScore: Number(mcqMaxScore.toFixed(2)),
        openMaxScore: Number(openMaxScore.toFixed(2)),
        totalMaxScore: Number(totalMaxScore.toFixed(2)),
        perQuestion
    };
};

export const toTenScale = (earnedPoints, maxPoints) => {
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, Number(earnedPoints || 0) / maxPoints));
    return Number((ratio * 10).toFixed(2));
};
