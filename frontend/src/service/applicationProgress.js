export const applicationProgressEnabled = () => process.env.REACT_APP_APPLICATION_PROGRESS_ENABLED === 'true';
export const STAGE_LABELS = Object.freeze({ moi_ung_tuyen:'Mới ứng tuyển', dang_xem_xet:'Đang xem xét', phong_van:'Phỏng vấn',
    de_nghi:'Đề nghị nhận việc', nhan_viec:'Đã nhận việc', tu_choi:'Từ chối' });
const positiveId = value => ['string','number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));

// PostgreSQL application IDs and MySQL CV IDs are different namespaces.
export const progressByLegacyCv = response => {
    if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)) throw new Error('Không tải được tiến trình tuyển dụng.');
    const result = new Map();
    for (const row of response.data) {
        if (!row || !Object.prototype.hasOwnProperty.call(row,'legacy_cv_id')) throw new Error('Dịch vụ tiến trình cần được cập nhật trước khi sử dụng.');
        if (row.legacy_cv_id === null) continue;
        if (!positiveId(row.legacy_cv_id) || !positiveId(row.id) || !positiveId(row.job_id)
            || !Object.prototype.hasOwnProperty.call(STAGE_LABELS,row.stage) || result.has(String(row.legacy_cv_id))) throw new Error('Dữ liệu tiến trình tuyển dụng không hợp lệ.');
        result.set(String(row.legacy_cv_id), { jobId:String(row.job_id), label:STAGE_LABELS[row.stage] });
    }
    return result;
};
export const applicationStage = (cv, progress) => {
    const match = progress.get(String(cv.id));
    if (!match) return 'Đang chờ đồng bộ';
    const jobId = cv.postId ?? cv.postCvData?.id;
    return String(jobId) === match.jobId ? match.label : 'Chưa đối chiếu được công việc';
};
