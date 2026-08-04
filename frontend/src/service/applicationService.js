import axios from "../axios";

// Quan ly ho so ung tuyen - Application & Workflow Service (PostgreSQL).
// Goi qua API Gateway, Gateway da chan san: chi EMPLOYER/COMPANY/ADMIN vao duoc.

// Bang Kanban: ho so da gom san theo tung cot.
const getApplicationBoard = (jobId) =>
    axios.get(`/api/applications/board${jobId ? `?jobId=${jobId}` : ""}`);

// Danh sach cac buoc trong quy trinh, dung de ve dau cot.
const getStages = () => axios.get(`/api/applications/stages`);

// Danh sach dang bang, co loc va phan trang.
const getApplications = (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") q.append(k, v);
    });
    return axios.get(`/api/applications?${q.toString()}`);
};

const getApplicationDetail = (id) => axios.get(`/api/applications/${id}`);

// Keo tha tren Kanban: chuyen ho so sang buoc khac.
const moveApplicationStage = (id, stage, reason) =>
    axios.patch(`/api/applications/${id}/stage`, { stage, reason });

const rateApplication = (id, rating) =>
    axios.patch(`/api/applications/${id}/rating`, { rating });

// Ghi chu noi bo giua nhung nguoi tuyen dung - ung vien khong xem duoc.
const addApplicationNote = (id, body) =>
    axios.post(`/api/applications/${id}/notes`, { body });

// Thong ke pheu tuyen dung: bao nhieu ho so o moi buoc, ty le chuyen doi.
const getFunnel = (jobId) =>
    axios.get(`/api/applications/funnel${jobId ? `?jobId=${jobId}` : ""}`);

// Kho ung vien.
const getTalentPool = (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") q.append(k, v);
    });
    return axios.get(`/api/talent-pool?${q.toString()}`);
};
const saveToTalentPool = (data) => axios.post(`/api/talent-pool`, data);
const removeFromTalentPool = (candidateId) =>
    axios.delete(`/api/talent-pool/${candidateId}`);

// Ung vien xem lich su ung tuyen cua chinh minh.
const getMyApplications = () => axios.get(`/api/my-applications`);

export {
    getApplicationBoard, getStages, getApplications, getApplicationDetail,
    moveApplicationStage, rateApplication, addApplicationNote, getFunnel,
    getTalentPool, saveToTalentPool, removeFromTalentPool,
    getMyApplications
};
