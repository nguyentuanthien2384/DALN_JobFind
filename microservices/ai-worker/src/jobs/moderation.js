import { askForJson } from '../libs/claude.js';

// AI Content Moderation: quet tin tuyen dung xem co vi pham/lua dao khong.

const schema = {
    type: 'object',
    properties: {
        approved: {
            type: 'boolean',
            description: 'true nếu tin được phép đăng, false nếu phải chặn'
        },
        riskLevel: {
            type: 'string',
            enum: ['an_toan', 'can_xem_lai', 'nguy_hiem']
        },
        violations: {
            type: 'array',
            items: {
                type: 'string',
                enum: [
                    'lua_dao', 'da_cap', 'thu_phi_ung_vien', 'phan_biet_doi_xu',
                    'noi_dung_nguoi_lon', 'thong_tin_gia_mao', 'tuyen_dung_bat_hop_phap',
                    'spam', 'thieu_thong_tin'
                ]
            },
            description: 'Các loại vi phạm phát hiện được, để mảng rỗng nếu không có'
        },
        reason: {
            type: 'string',
            description: 'Giải thích ngắn gọn bằng tiếng Việt cho quyết định'
        }
    },
    required: ['approved', 'riskLevel', 'violations', 'reason'],
    additionalProperties: false
};

const system = `Bạn là bộ phận kiểm duyệt nội dung của một sàn tuyển dụng Việt Nam.
Nhiệm vụ: quyết định một tin tuyển dụng có được phép đăng hay không.

CHẶN tin khi có dấu hiệu:
- Lừa đảo: hứa lương cao bất thường cho việc không đòi hỏi kỹ năng, "việc nhẹ lương cao", làm tại nhà thu nhập lớn không rõ nội dung công việc.
- Thu phí ứng viên: yêu cầu nộp tiền cọc, phí hồ sơ, phí đào tạo, mua tài liệu, giữ giấy tờ gốc.
- Đa cấp / tuyển dụng theo mô hình kim tự tháp.
- Phân biệt đối xử trái luật: loại trừ theo giới tính, vùng miền, tôn giáo, tình trạng hôn nhân, ngoại hình khi không phải yêu cầu thực chất của công việc.
- Nội dung người lớn, công việc bất hợp pháp.
- Thông tin giả mạo: mạo danh doanh nghiệp có thật.

CHO QUA những tin tuyển dụng bình thường, kể cả khi trình bày sơ sài hoặc mô tả ngắn.
Nêu yêu cầu giới tính/độ tuổi là thực tế phổ biến ở thị trường Việt Nam: chỉ đánh dấu
"phan_biet_doi_xu" khi rõ ràng vô lý so với tính chất công việc, không chặn máy móc.

Thận trọng theo cả hai chiều: chặn nhầm tin hợp lệ làm nhà tuyển dụng mất niềm tin,
bỏ lọt tin lừa đảo làm ứng viên mất tiền.`;

const stripHtml = (html) =>
    String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const moderateJob = async ({ name, descriptionHTML }) => {
    const prompt = `Kiểm duyệt tin tuyển dụng sau.

Tiêu đề: ${name}

Nội dung:
${stripHtml(descriptionHTML).slice(0, 15000)}`;

    return askForJson({
        system,
        prompt,
        schema,
        // Kiem duyet chay tren moi tin dang len nen uu tien re va nhanh.
        effort: 'low',
        maxTokens: 4000
    });
};
