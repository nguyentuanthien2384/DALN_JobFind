import axios from "../axios";
import { readJsonStorage } from "../util/storage";

// Quan ly ho so ung tuyen - Application & Workflow Service (PostgreSQL).
// Goi qua API Gateway, Gateway da chan san: chi EMPLOYER/COMPANY/ADMIN vao duoc.

// Share only a pending read in the same authenticated workspace. Settled reads
// are removed so returning to the board always fetches current applications.
const pendingBoardReads = new Map();
const boardSnapshotScope = () => {
    const user = readJsonStorage('userData') || {};
    let session = '';
    try { session = localStorage.getItem('token_user') || ''; } catch { /* Storage may be unavailable. */ }
    return JSON.stringify([session, user.id ?? user.userId, user.roleCode, user.companyId,
        user.companyStatusCode, user.companyCensorCode]);
};
const invalidateBoardSnapshotScope = (scope) => {
    for (const [key, pending] of pendingBoardReads) {
        if (pending.scope === scope) pendingBoardReads.delete(key);
    }
};
const invalidateApplicationSnapshots = () => invalidateBoardSnapshotScope(boardSnapshotScope());

const readBoardSnapshot = (url) => {
    const scope = boardSnapshotScope();
    const key = JSON.stringify([scope, url]);
    if (pendingBoardReads.has(key)) return pendingBoardReads.get(key).request;
    const request = axios.get(url, { timeout: 15000 }).finally(() => {
        if (pendingBoardReads.get(key)?.request === request) pendingBoardReads.delete(key);
    });
    pendingBoardReads.set(key, { scope, request });
    return request;
};

const mutateApplication = (send) => {
    const scope = boardSnapshotScope();
    return send().then(result => {
        if (result?.errCode === 0) invalidateBoardSnapshotScope(scope);
        return result;
    });
};

// Bang Kanban: ho so da gom san theo tung cot.
const getApplicationBoard = (jobId) =>
    readBoardSnapshot(`/api/applications/board${jobId ? `?jobId=${jobId}` : ""}`);

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
    mutateApplication(() => axios.patch(`/api/applications/${id}/stage`, { stage, reason }));

// Gui thu moi nhan viec hoac thong bao tu choi; thu moi cho ung vien phan hoi.
// `interviewed` chi dung cho tu choi: false = khong cam on "da tham gia phong van".
const sendApplicationDecision = (id, decision, message, offer, interviewed) =>
    mutateApplication(() => axios.post(`/api/applications/${id}/decision-notification`, {
        decision, message, ...(offer ? { offer } : {}), ...(typeof interviewed === 'boolean' ? { interviewed } : {})
    }));

// Thu moi phong van: chuyen ho so sang buoc phong van va gui email co ngay gio, dia diem.
const sendInterviewInvitation = (id, message, interview) =>
    mutateApplication(() => axios.post(`/api/applications/${id}/interview-invitation`, { message, interview }));

const rateApplication = (id, rating) =>
    mutateApplication(() => axios.patch(`/api/applications/${id}/rating`, { rating }));

// Ghi chu noi bo giua nhung nguoi tuyen dung - ung vien khong xem duoc.
const addApplicationNote = (id, body) =>
    mutateApplication(() => axios.post(`/api/applications/${id}/notes`, { body }));

// Thong ke pheu tuyen dung: bao nhieu ho so o moi buoc, ty le chuyen doi.
const getFunnel = (jobId) =>
    readBoardSnapshot(`/api/applications/funnel${jobId ? `?jobId=${jobId}` : ""}`);

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
    moveApplicationStage, sendApplicationDecision, sendInterviewInvitation, rateApplication, addApplicationNote, getFunnel,
    getTalentPool, saveToTalentPool, removeFromTalentPool,
    getMyApplications, invalidateApplicationSnapshots
};
