import { askAboutPdf } from '../libs/claude.js';

// AI Resume Parser: doc file PDF -> boc tach thanh cau truc JSON.

const schema = {
    type: 'object',
    properties: {
        fullName: { type: ['string', 'null'], description: 'Họ tên đầy đủ của ứng viên' },
        email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        title: { type: ['string', 'null'], description: 'Vị trí ứng tuyển hoặc chức danh hiện tại' },
        summary: { type: ['string', 'null'], description: 'Tóm tắt ngắn về ứng viên, tối đa 3 câu' },
        yearsOfExperience: { type: ['number', 'null'] },
        skills: {
            type: 'array',
            items: { type: 'string' },
            description: 'Danh sách kỹ năng, mỗi kỹ năng một mục ngắn gọn'
        },
        experiences: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    company: { type: ['string', 'null'] },
                    position: { type: ['string', 'null'] },
                    duration: { type: ['string', 'null'] },
                    description: { type: ['string', 'null'] }
                },
                required: ['company', 'position', 'duration', 'description'],
                additionalProperties: false
            }
        },
        educations: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    school: { type: ['string', 'null'] },
                    major: { type: ['string', 'null'] },
                    degree: { type: ['string', 'null'] },
                    year: { type: ['string', 'null'] }
                },
                required: ['school', 'major', 'degree', 'year'],
                additionalProperties: false
            }
        },
        languages: { type: 'array', items: { type: 'string' } }
    },
    required: [
        'fullName', 'email', 'phone', 'address', 'title', 'summary',
        'yearsOfExperience', 'skills', 'experiences', 'educations', 'languages'
    ],
    additionalProperties: false
};

const system = `Bạn là công cụ bóc tách CV cho một sàn tuyển dụng Việt Nam.
Chỉ trích xuất thông tin thực sự có trong tài liệu. Không suy đoán, không bịa thêm.
Trường nào tài liệu không nêu thì để null (hoặc mảng rỗng).
Giữ nguyên tiếng Việt có dấu như trong CV gốc.`;

export const parseResume = async ({ fileBase64, fileName }) => {
    const data = await askAboutPdf({
        system,
        prompt: `Bóc tách CV này thành dữ liệu có cấu trúc.${fileName ? ` Tên file: ${fileName}.` : ''}`,
        base64Pdf: fileBase64,
        schema,
        // Boc tach la doc-va-chep, khong can suy luan sau; effort thap de tiet kiem.
        effort: 'low',
        maxTokens: 8000
    });
    return data;
};
