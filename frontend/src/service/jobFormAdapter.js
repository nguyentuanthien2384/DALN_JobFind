// One explicit mapping for flat Job Core data and nested legacy Sequelize data.
// Raw codes take precedence, including null: a missing Allcode join must not
// silently replace a stored code with the first option in a dropdown.
export const JOB_CLASSIFICATIONS = Object.freeze([
    ['categoryJobCode', 'categoryJobCode', 'jobTypePostData', 'JOBTYPE'],
    ['addressCode', 'addressCode', 'provincePostData', 'PROVINCE'],
    ['salaryJobCode', 'salaryJobCode', 'salaryTypePostData', 'SALARYTYPE'],
    ['categoryJoblevelCode', 'categoryJoblevelCode', 'jobLevelPostData', 'JOBLEVEL'],
    ['categoryWorktypeCode', 'categoryWorktypeCode', 'workTypePostData', 'WORKTYPE'],
    ['experienceJobCode', 'experienceJobCode', 'expTypePostData', 'EXPTYPE'],
    ['genderCode', 'genderPostCode', 'genderPostData', 'GENDERPOST']
].map(Object.freeze));
const own = (object, field) => Object.prototype.hasOwnProperty.call(object, field);
const strings = ['name', 'descriptionHTML', 'descriptionMarkdown'];

export const jobDeadlineDate = value => {
    if (!['string', 'number'].includes(typeof value) || !/^[1-9][0-9]*$/.test(String(value))) return null;
    const time = Number(value);
    return Number.isSafeInteger(time) && time <= 8640000000000000 ? new Date(time) : null;
};

const hotFlag = value => {
    if ([0, '0', false, undefined, null].includes(value)) return 0;
    if ([1, '1', true].includes(value)) return 1;
    throw new Error('Loại tin tuyển dụng không hợp lệ');
};

export const jobToForm = job => {
    if (!job || typeof job !== 'object' || !['string', 'number'].includes(typeof job.id) || !/^[1-9][0-9]*$/.test(String(job.id))
        || !Number.isSafeInteger(Number(job.id))) throw new Error('Không đọc được dữ liệu tin tuyển dụng');
    const detail = own(job, 'postDetailData') ? job.postDetailData : job;
    if (!detail || typeof detail !== 'object' || typeof detail.name !== 'string') {
        throw new Error('Không đọc được nội dung tin tuyển dụng');
    }
    return {
        ...Object.fromEntries(strings.map(field => [field, typeof detail[field] === 'string' ? detail[field] : ''])),
        ...Object.fromEntries(JOB_CLASSIFICATIONS.map(([form, raw, relation]) => {
            const value = own(detail, raw) ? detail[raw] : detail[relation]?.code;
            return [form, typeof value === 'string' ? value : ''];
        })),
        amount: detail.amount == null ? '' : String(detail.amount),
        timeEnd: job.timeEnd ?? '', id: job.id, isHot: hotFlag(job.isHot),
        statusCode: job.statusCode ?? job.statusPostData?.code ?? null, isActionADD: false
    };
};

export const jobClassificationOptions = (items, current) => {
    const options = (Array.isArray(items) ? items : []).filter(item => typeof item?.code === 'string' && item.code);
    const distinct = [...new Map(options.map(item => [item.code, { code: item.code, value: item.value || item.code }])).values()];
    if (distinct.some(item => item.code === current)) return distinct;
    return [{ code: current || '', value: current ? `Mã đang lưu: ${current} (không có trong danh mục)` : 'Chưa chọn' }, ...distinct];
};

const statusLabels = Object.freeze({
    PS1: 'Đã duyệt', PS2: 'Bị từ chối', PS3: 'Chờ kiểm duyệt', PS4: 'Đã gỡ hoặc bị chặn'
});
export const jobStatusLabel = code => own(statusLabels, code) ? statusLabels[code] : 'Chưa xác định';

const formDetail = form => ({
    ...Object.fromEntries(strings.map(field => [field, form[field] ?? ''])),
    ...Object.fromEntries(JOB_CLASSIFICATIONS.map(([field, raw]) => [raw, form[field] === '' || form[field] == null ? null : form[field]])),
    amount: form.amount
});

const validateField = (field, value) => {
    if (field === 'amount') {
        if (!['string', 'number'].includes(typeof value) || !/^(100000|[1-9][0-9]{0,4})$/.test(String(value))) {
            throw new Error('Số lượng nhân viên phải là số nguyên từ 1 đến 100000');
        }
        return Number(value);
    }
    const required = ['name', 'descriptionHTML', 'categoryJobCode'].includes(field);
    const max = field === 'name' ? 255 : field.startsWith('description') ? 200000 : 64;
    if ((required && (typeof value !== 'string' || !value.trim()))
        || (value !== null && typeof value !== 'string') || (typeof value === 'string' && value.length > max)
        || (field === 'descriptionMarkdown' && value === null)) {
        throw new Error(`Thông tin ${field} không hợp lệ`);
    }
    return value;
};

// Prepare once before assigning an action key. Never add identity/status/labels.
export const buildJobCreate = (form, deadline = form.timeEnd) => {
    const timeEnd = deadline instanceof Date ? String(deadline.getTime()) : String(deadline);
    if (!jobDeadlineDate(timeEnd) || Number(timeEnd) <= Date.now()) throw new Error('Ngày kết thúc phải hơn ngày hiện tại');
    return Object.freeze({
        ...Object.fromEntries(Object.entries(formDetail(form)).map(([field, value]) => [field, validateField(field, value)])),
        timeEnd, isHot: hotFlag(form.isHot)
    });
};

// Diff against the loaded form, not the latest server data. No change -> null,
// so callers skip PUT. This reduces full-form overwrites, but is NOT If-Match.
export const buildJobUpdate = (form, initial) => {
    if (!initial || !['string', 'number'].includes(typeof initial.id) || !/^[1-9][0-9]*$/.test(String(initial.id))
        || !Number.isSafeInteger(Number(initial.id)) || String(form.id) !== String(initial.id)) throw new Error('Cần tải lại tin trước khi sửa');
    if (String(form.timeEnd) !== String(initial.timeEnd) || hotFlag(form.isHot) !== hotFlag(initial.isHot)) {
        throw new Error('Không thể đổi ngày hết hạn hoặc loại tin khi sửa');
    }
    const next = formDetail(form), previous = formDetail(initial);
    const changes = Object.entries(next).filter(([field, value]) => field === 'amount'
        ? String(value) !== String(previous[field]) : value !== previous[field]);
    return changes.length ? Object.freeze(Object.fromEntries(changes.map(([field, value]) => [field, validateField(field, value)]))) : null;
};
