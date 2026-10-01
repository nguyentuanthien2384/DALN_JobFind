/* global globalThis */
import axios from "../axios";
import { pollAiTask } from './aiTaskPolling';

// Cac API moi do he thong microservice cung cap, goi qua API Gateway.
// Cac ham cu trong userService.js / cvService.js van giu nguyen: Gateway dinh tuyen
// chung ve backend cu, nen phan giao dien da co khong phai sua gi.

//================== TIM KIEM (Search Service - Elasticsearch) ==================

// Tim viec lam. Nhanh hon get-filter-post cu vi chay tren Elasticsearch chu khong
// phai LIKE '%...%' tren MySQL, va co xep hang theo do lien quan.
const searchJobs = (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            if (Array.isArray(value)) value.forEach(item => query.append(key, item));
            else query.append(key, value);
        }
    });
    return axios.get(`/api/search/jobs?${query.toString()}`);
};

// Goi y tu khoa khi nguoi dung dang go vao o tim kiem.
const suggestJobs = (keyword) =>
    axios.get(`/api/search/suggest?q=${encodeURIComponent(keyword)}`);

// Dem so tin theo nganh nghe / tinh thanh / muc luong - dung cho khoi danh muc.
const getSearchFacets = () => axios.get(`/api/search/facets`);

// Tin lien quan toi tin dang xem.
const getRelatedJobs = (jobId, limit = 6) =>
    axios.get(`/api/search/related/${jobId}?limit=${limit}`);

//================== AI (AI Worker - Claude) ==================
// Cac API AI chay bat dong bo: goi xong nhan ve taskId, sau do hoi ket qua bang
// getAiTask. Lam vay vi mot lan goi model mat vai giay den vai chuc giay, giu
// ket noi HTTP cho ca quang do se lam nghen may chu.

// Create once per user action, then keep these options for every retry of it.
// Keep the key in UI state; do not persist the CV or infer identity from its text.
const createAiRequestOptions = () => {
    if (!globalThis.crypto?.getRandomValues) throw new Error("Trình duyệt chưa hỗ trợ tạo mã yêu cầu an toàn");
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Object.freeze({
        idempotencyKey: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
    });
};

const postAi = async (path, body, options = createAiRequestOptions()) => {
    const { idempotencyKey } = options;
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey)) {
        throw new Error("Mã gửi lại yêu cầu không hợp lệ");
    }
    try {
        const result = await axios.post(path, body, { headers: { "Idempotency-Key": idempotencyKey }, timeout: 15000, ...(options.signal && { signal: options.signal }) });
        // The shared Axios adapter returns errors as data. Include the key on both
        // success and failure so callers can retry after an uncertain response.
        return { ...result, idempotencyKey };
    } catch (error) {
        error.idempotencyKey = idempotencyKey;
        throw error;
    }
};

// Boc tach CV tu file PDF thanh du lieu co cau truc.
const parseResumeAi = (fileBase64, fileName, options) =>
    postAi(`/api/ai/parse-resume`, { fileBase64, fileName }, options);

// Tao ban nhap CV tu thong tin that ung vien cung cap; cong viec muc tieu la tuy chon.
const generateCvAi = (sourceText, jobId, language = "vi", options) =>
    postAi(`/api/ai/generate-cv`, { sourceText, ...(jobId !== undefined && jobId !== null && { jobId }), language }, options);

// Cham diem do khop giua CV va mot tin tuyen dung.
const matchCvAi = (resumeText, jobId, options) =>
    postAi(`/api/ai/match-cv`, { resumeText, jobId }, options);

const matchCvPdfAi = (fileBase64, jobId, options) =>
    postAi(`/api/ai/match-cv`, { fileBase64, jobId }, options);

// Sinh thu ung tuyen.
const coverLetterAi = (resumeText, jobId, language = "en", options) =>
    postAi(`/api/ai/cover-letter`, { resumeText, jobId, language }, options);

// Loi gioi thieu ngan (<= 255 ky tu) tu CV PDF dang chon khi nop ho so.
const applicationIntroAi = (fileBase64, jobId, language = "vi", options) =>
    postAi(`/api/ai/application-intro`, { fileBase64, jobId: Number(jobId), language }, options);

// Nha tuyen dung: loi nhan them cho email moi phong van / trung tuyen / tu choi.
const candidateMessageAi = ({ jobId, emailType, candidateName, recruiterNotes, interviewed, language = "vi" }, options) =>
    postAi(`/api/ai/candidate-message`, {
        jobId: Number(jobId), emailType, language,
        ...(candidateName ? { candidateName: String(candidateName).slice(0, 255) } : {}),
        ...(recruiterNotes ? { recruiterNotes } : {}),
        ...(emailType === "rejection" && typeof interviewed === "boolean" ? { interviewed } : {})
    }, options);

// Goi y tra loi (mode "suggest") hoac viet lai ban nhap (mode "polish") trong chat.
const chatAssistAi = ({ mode, messages = [], draft, language = "vi" }, options) =>
    postAi(`/api/ai/chat-assist`, mode === "suggest"
        ? { mode, messages, language }
        : { mode, draft, language, ...(messages.length ? { messages } : {}) }, options);

// Nha tuyen dung: AI cham CV da nop (doc tep tai may chu) va danh sach ket qua theo tin.
const screenApplicationAi = (cvId, options) =>
    postAi(`/api/ai/screen-application`, { cvId: Number(cvId) }, options);
const getJobScreenings = (jobId) =>
    axios.get(`/api/ai/jobs/${encodeURIComponent(jobId)}/screenings`);

// Hoi ket qua cua mot tac vu AI.
const getAiTask = (taskId, options) => options
    ? axios.get(`/api/ai/tasks/${encodeURIComponent(taskId)}`, options)
    : axios.get(`/api/ai/tasks/${encodeURIComponent(taskId)}`);

// Hoi lai theo chu ky cho toi khi co ket qua. Tra ve ket qua hoac nem loi khi
// het thoi gian cho.
const waitForAiTask = (taskId, options) => pollAiTask(getAiTask, taskId, options);

//================== HO SO & CV BUILDER (Identity Service - MongoDB) ==================
const getMyProfile = () => axios.get(`/api/profile`);
const updateMyProfile = (data) => axios.put(`/api/profile`, data);
const listMyCvs = () => axios.get(`/api/profile/cvs`);
const createMyCv = (data) => axios.post(`/api/profile/cvs`, data);
const updateMyCv = (cvId, data) => axios.put(`/api/profile/cvs/${cvId}`, data);
const deleteMyCv = (cvId) => axios.delete(`/api/profile/cvs/${cvId}`);
const importParsedCv = (parsed, fileName) =>
    axios.post(`/api/profile/cvs/import`, { parsed, fileName });

//================== GIAM SAT ==================
// Trang thai cac service va circuit breaker - huu ich cho man hinh quan tri.
const getSystemStatus = () => axios.get(`/status`);

export {
    searchJobs, suggestJobs, getSearchFacets, getRelatedJobs,
    createAiRequestOptions, parseResumeAi, generateCvAi, matchCvAi, matchCvPdfAi, coverLetterAi, getAiTask, waitForAiTask,
    applicationIntroAi, candidateMessageAi, chatAssistAi, screenApplicationAi, getJobScreenings,
    getMyProfile, updateMyProfile,
    listMyCvs, createMyCv, updateMyCv, deleteMyCv, importParsedCv,
    getSystemStatus
};
