import axios from "../axios";

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
            query.append(key, value);
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

// Boc tach CV tu file PDF thanh du lieu co cau truc.
const parseResumeAi = (fileBase64, fileName) =>
    axios.post(`/api/ai/parse-resume`, { fileBase64, fileName });

// Cham diem do khop giua CV va mot tin tuyen dung.
const matchCvAi = (resumeText, jobId) =>
    axios.post(`/api/ai/match-cv`, { resumeText, jobId });

// Sinh thu ung tuyen.
const coverLetterAi = (resumeText, jobId, language = "en") =>
    axios.post(`/api/ai/cover-letter`, { resumeText, jobId, language });

// Hoi ket qua cua mot tac vu AI.
const getAiTask = (taskId) => axios.get(`/api/ai/tasks/${taskId}`);

// Hoi lai theo chu ky cho toi khi co ket qua. Tra ve ket qua hoac nem loi khi
// het thoi gian cho.
const waitForAiTask = async (taskId, { intervalMs = 2000, timeoutMs = 120000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await getAiTask(taskId);
        if (res && res.errCode === 0) {
            if (res.data.status === "done") return res.data.result;
            if (res.data.status === "failed") {
                throw new Error(res.data.error || "Xử lý AI thất bại");
            }
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error("Quá thời gian chờ kết quả AI");
};

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
    parseResumeAi, matchCvAi, coverLetterAi, getAiTask, waitForAiTask,
    getMyProfile, updateMyProfile,
    listMyCvs, createMyCv, updateMyCv, deleteMyCv, importParsedCv,
    getSystemStatus
};
