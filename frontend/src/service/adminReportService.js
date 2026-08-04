import axios from "../axios";

// Bao cao & quan tri - Admin & Reporting Service (MongoDB).
// Gateway da chan san: chi tai khoan ADMIN goi duoc cac API nay.

const qs = (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") q.append(k, v);
    });
    const s = q.toString();
    return s ? `?${s}` : "";
};

// ===== BAO CAO =====
// Cac con so lon tren dau trang.
const getOverview = (params) => axios.get(`/api/admin/reports/overview${qs(params)}`);
// Chuoi thoi gian de ve bieu do duong.
const getTimeseries = (params) => axios.get(`/api/admin/reports/timeseries${qs(params)}`);
// Phan bo theo nganh nghe / tinh thanh / muc luong / vai tro.
const getDistribution = () => axios.get(`/api/admin/reports/distribution`);
// Pheu tuyen dung toan he thong.
const getSystemFunnel = () => axios.get(`/api/admin/reports/funnel`);
// Thong ke hoat dong lay tu nhat ky.
const getActivity = (params) => axios.get(`/api/admin/reports/activity${qs(params)}`);

// ===== NHAT KY HOAT DONG =====
const getAuditLogs = (params) => axios.get(`/api/admin/audit${qs(params)}`);
// Toan bo dau vet cua mot doi tuong, vi du tat ca thao tac len tin #51.
const getTargetHistory = (type, id) => axios.get(`/api/admin/audit/target/${type}/${id}`);

// ===== MASTER DATA =====
const getMasterData = (type) => axios.get(`/api/admin/master-data${qs({ type })}`);
const saveMasterDataTag = (data) => axios.post(`/api/admin/master-data`, data);
const deleteMasterDataTag = (id) => axios.delete(`/api/admin/master-data/${id}`);

export {
    getOverview, getTimeseries, getDistribution, getSystemFunnel, getActivity,
    getAuditLogs, getTargetHistory,
    getMasterData, saveMasterDataTag, deleteMasterDataTag
};
