import { askForJson } from '../libs/claude.js';

// AI Smart Matching: cham diem % do khop giua CV va mo ta cong viec.

const schema = {
    type: 'object',
    properties: {
        score: {
            type: 'integer',
            description: 'Điểm khớp tổng thể từ 0 đến 100'
        },
        verdict: {
            type: 'string',
            enum: ['rat_phu_hop', 'phu_hop', 'can_can_nhac', 'chua_phu_hop'],
            description: 'Kết luận ngắn gọn'
        },
        matchedSkills: {
            type: 'array',
            items: { type: 'string' },
            description: 'Kỹ năng tin tuyển dụng yêu cầu mà ứng viên có'
        },
        missingSkills: {
            type: 'array',
            items: { type: 'string' },
            description: 'Kỹ năng tin tuyển dụng yêu cầu mà ứng viên chưa thể hiện'
        },
        strengths: { type: 'array', items: { type: 'string' } },
        concerns: { type: 'array', items: { type: 'string' } },
        summary: {
            type: 'string',
            description: 'Nhận xét 2-3 câu bằng tiếng Việt dành cho nhà tuyển dụng'
        }
    },
    required: ['score', 'verdict', 'matchedSkills', 'missingSkills', 'strengths', 'concerns', 'summary'],
    additionalProperties: false
};

const system = `Bạn là chuyên viên tuyển dụng giàu kinh nghiệm, đang sàng lọc hồ sơ cho một sàn việc làm Việt Nam.

Cách chấm điểm:
- Chỉ căn cứ vào những gì CV thực sự nêu. Không suy đoán kỹ năng từ chức danh.
- Kỹ năng bắt buộc của tin tuyển dụng nặng hơn kỹ năng "ưu tiên có".
- Số năm kinh nghiệm thiếu so với yêu cầu là điểm trừ đáng kể, không phải lỗi nhỏ.
- Chấm trung thực. Điểm cao chỉ dành cho hồ sơ thực sự khớp; đừng nới tay cho dễ nhìn.

Viết nhận xét bằng tiếng Việt, thẳng thắn và cụ thể, tránh khen chung chung.`;

const stripHtml = (html) =>
    String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const matchCv = async ({ resumeText, jobTitle, jobDescription }) => {
    const prompt = `# Tin tuyển dụng
Vị trí: ${jobTitle}

Mô tả và yêu cầu:
${stripHtml(jobDescription).slice(0, 12000)}

# Hồ sơ ứng viên
${String(resumeText).slice(0, 12000)}

Hãy chấm độ khớp giữa hồ sơ này và tin tuyển dụng trên.`;

    return askForJson({
        system,
        prompt,
        schema,
        // Cham diem doi hoi can nhac giua nhieu tieu chi nen de effort cao hon.
        effort: 'high',
        maxTokens: 8000
    });
};
