/* global globalThis */
import { createAiRequestOptions } from './aiSearchService';

export const candidateAiEnabled = () => process.env.REACT_APP_CANDIDATE_AI_ENABLED === 'true';
const TYPES = ['parse_resume', 'match_cv', 'cover_letter'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const MONGO_ID = /^[a-f0-9]{24}$/i;
export const intentStorageKey = userId => `jobfind.ai.intent.v1.${userId}`;
export const mutationStorageKey = userId => `jobfind.cv.mutation.v1.${userId}`;
const fail = message => { throw new Error(message); };
const validIntent = value => value && value.version === 1 && TYPES.includes(value.type)
    && /^[a-f0-9]{32}$/.test(value.key) && /^[a-f0-9]{64}$/.test(value.digest)
    && (value.taskId === null || (typeof value.taskId === 'string' && ID.test(value.taskId)));
export const readIntent = userId => {
    const raw = sessionStorage.getItem(intentStorageKey(userId));
    if (!raw) return null;
    let value; try { value = JSON.parse(raw); } catch { fail('Mã tác vụ đã lưu bị hỏng. Không thể tự tạo yêu cầu thay thế.'); }
    if (!validIntent(value)) fail('Mã tác vụ đã lưu không hợp lệ. Không thể tự tạo yêu cầu thay thế.');
    return value;
};
export const saveIntent = (userId, value) => {
    if (!validIntent(value)) fail('Không lưu được mã tác vụ.');
    const old = readIntent(userId);
    if (old && old.key !== value.key) fail('Một yêu cầu khác đang được giữ. Hãy đối chiếu trước.');
    sessionStorage.setItem(intentStorageKey(userId), JSON.stringify(value));
};
export const clearIntent = (userId, key) => {
    if (readIntent(userId)?.key !== key) fail('Yêu cầu đang giữ đã thay đổi.');
    sessionStorage.removeItem(intentStorageKey(userId));
};
export const fingerprint = async (type, payload) => {
    if (!globalThis.crypto?.subtle) fail('Trình duyệt cần HTTPS hoặc localhost để bảo vệ mã yêu cầu.');
    const bytes = new TextEncoder().encode(JSON.stringify([type, payload]));
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
};
export const prepareIntent = async (userId, type, payload, allowChangedRejectedInput = true) => {
    if (!TYPES.includes(type)) fail('Loại tác vụ không hợp lệ.');
    const digest = await fingerprint(type, payload);
    const previous = readIntent(userId);
    if (previous) {
        if (previous.taskId || previous.type !== type || ((!previous.rejected || !allowChangedRejectedInput) && previous.digest !== digest)) {
            fail('Hãy chọn lại đúng tệp/nội dung, công việc và ngôn ngữ đã gửi để đối chiếu yêu cầu cũ.');
        }
        return { ...previous, digest, rejected: false };
    }
    return { version: 1, type, digest, key: createAiRequestOptions().idempotencyKey, taskId: null };
};
export const acceptTask = (response, intent) => {
    if (response?.errCode !== 0 || response.httpStatus >= 400 || typeof response.taskId !== 'string' || !ID.test(response.taskId)) {
        fail(response?.errMessage || 'Chưa xác nhận được tác vụ đã tạo. Giữ nguyên yêu cầu để đối chiếu.');
    }
    return { ...intent, taskId: response.taskId };
};
export const validateTaskResponse = (response, intent) => {
    if (response?.errCode === 0 && (response.data?.id !== intent.taskId || response.data?.type !== intent.type)) {
        return { errCode: 400, httpStatus: 400, errMessage: 'Phản hồi không thuộc tác vụ đang xem.' };
    }
    return response;
};
export const readPdf = file => new Promise((resolve, reject) => {
    if (!file || !/\.pdf$/i.test(file.name) || file.size <= 0 || file.size > 5 * 1024 * 1024 || file.name.length > 255) {
        reject(new Error('Chọn tệp PDF không quá 5 MiB, tên không quá 255 ký tự.')); return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp PDF.'));
    reader.onload = () => {
        const base64 = String(reader.result).split(',')[1];
        if (!base64 || !atob(base64.slice(0, 12)).startsWith('%PDF-')) { reject(new Error('Tệp không có định dạng PDF hợp lệ.')); return; }
        resolve({ fileBase64: base64, fileName: file.name });
    };
    reader.readAsDataURL(file);
});

const string = (value, max) => value == null ? '' : typeof value === 'string' && value.length <= max ? value : fail('Dữ liệu CV/AI không hợp lệ.');
const strings = (values, max = 100) => {
    if (!Array.isArray(values) || values.length > max) fail('Danh sách CV/AI không hợp lệ.');
    return values.map(value => string(value, 255));
};
export const emptyCv = () => ({ title: '', fullName: '', email: '', phone: '', address: '', summary: '', skills: [], languages: [], experiences: [], educations: [] });
export const cvPayload = cv => {
    if (!cv || typeof cv !== 'object' || Array.isArray(cv)) fail('Dữ liệu CV không hợp lệ.');
    const value = {};
    for (const [field, max] of Object.entries({ title:255, fullName:255, email:320, phone:100, address:1000, summary:20000 })) value[field] = string(cv[field], max);
    for (const field of ['skills','languages']) value[field] = strings(cv[field] || []).map(item => item.trim()).filter(Boolean);
    for (const [field, fields] of Object.entries({ experiences: { company:255, position:255, from:100, to:100, description:10000 }, educations: { school:255, major:255, degree:255, year:100 } })) {
        if (!Array.isArray(cv[field] || []) || cv[field]?.length > 100) fail('Danh sách CV không hợp lệ.');
        value[field] = (cv[field] || []).map(row => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Mục CV không hợp lệ.');
            return Object.fromEntries(Object.entries(fields).map(([key,max]) => [key,string(row[key], max)]));
        });
    }
    return value;
};
export const validateCvList = response => {
    if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)) fail('Không tải được danh sách CV.');
    const seen = new Set();
    return response.data.map(cv => {
        if (!MONGO_ID.test(cv?._id || '') || seen.has(cv._id)) fail('Danh sách CV không hợp lệ.');
        seen.add(cv._id);
        return { ...cvPayload(cv), _id: cv._id };
    });
};
export const parsedToCv = result => cvPayload({ ...result, title: result.title || `CV của ${result.fullName || 'tôi'}`,
    experiences: (result.experiences || []).map(row => ({ ...row, from: string(row.duration, 255).slice(0,100), to: '' })) });
export const validateAiResult = (type, result) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail('Kết quả AI không hợp lệ.');
    if (type === 'parse_resume') return parsedToCv(result);
    if (type === 'cover_letter') {
        if (typeof result.letter !== 'string' || !result.letter.trim() || result.letter.length > 100000) fail('Thư ứng tuyển không hợp lệ.');
        return { letter: result.letter };
    }
    if (!Number.isInteger(result.score) || result.score < 0 || result.score > 100) fail('Điểm phù hợp không hợp lệ.');
    return { score: result.score, summary: string(result.summary, 20000),
        ...Object.fromEntries(['matchedSkills','missingSkills','strengths','concerns'].map(field => [field, strings(result[field])])) };
};
export const cvText = cv => {
    const value = cvPayload(cv);
    return [value.fullName, value.summary, value.skills.join(', '), value.languages.join(', '),
        ...value.experiences.map(row => Object.values(row).join(' — ')), ...value.educations.map(row => Object.values(row).join(' — '))].filter(Boolean).join('\n');
};
