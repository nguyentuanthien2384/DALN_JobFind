import React from "react";
import { useCallback, useEffect, useState, useRef } from "react";
import { toast } from "react-toastify";
import DatePicker from "react-datepicker";
import {
    createPostService,
    updatePostService,
    getDetailPostByIdService,
    reupPostService,
    getDetailCompanyByUserId,
} from "../../../service/userService";
import MarkdownIt from "markdown-it";
import MdEditor from "react-markdown-editor-lite";
import "react-markdown-editor-lite/lib/index.css";
import { useFetchAllcode } from "../../../util/fetch";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner, Modal } from "reactstrap";
import { jobToForm, jobDeadlineDate, jobClassificationOptions, jobStatusLabel, isJobRevision } from "../../../service/jobFormAdapter";
import "../../../components/modal/modal.css";
import ReupPostModal from "../../../components/modal/ReupPostModal";
const emptyPostForm = () => ({
    name: "",
    categoryJobCode: "",
    addressCode: "",
    salaryJobCode: "",
    amount: "",
    timeEnd: "",
    categoryJoblevelCode: "",
    categoryWorktypeCode: "",
    experienceJobCode: "",
    genderCode: "",
    descriptionHTML: "",
    descriptionMarkdown: "",
    isActionADD: true,
    id: "",
    isHot: 0,
});
const AddPost = () => {
    const mdParser = new MarkdownIt();
    const [user, setUser] = useState({});
    const [timeEnd, settimeEnd] = useState(new Date());
    const [isChangeDate, setisChangeDate] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const { id } = useParams();
    const [companyPostAllow, setCompanyPostAllow] = useState({
        hot: 0,
        nonHot: 0,
    });
    const [inputValues, setInputValues] = useState(() => ({ ...emptyPostForm(), isActionADD: !id }));
    const [propsModal, setPropsModal] = useState({
        isActive: false,
        handlePost: () => {},
    });
    const fetchCompany = useCallback(async (userId, companyId = null) => {
        let res = await getDetailCompanyByUserId(userId, companyId);
        if (res && res.errCode === 0) {
            setCompanyPostAllow({
                hot: res.data.allowHotPost,
                nonHot: res.data.allowPost,
            });
        }
    }, []);

    const [loadError, setLoadError] = useState('');
    const [editWarning, setEditWarning] = useState('');
    const [confirmReload, setConfirmReload] = useState(false);
    const [reloadVersion, setReloadVersion] = useState(0);
    const editAttempt = useRef(null);
    const reupBlocked = useRef(false);
    const [reupWarning, setReupWarning] = useState('');
    const [reupCreatedId, setReupCreatedId] = useState(null);
    useEffect(() => { reupBlocked.current = false; setReupWarning(''); setReupCreatedId(null); }, [id]);
    const viewEpoch = useRef(0);
    const readyToEdit = !id || (!inputValues.isActionADD && String(inputValues.id) === String(id));
    const validDeadline = jobDeadlineDate(inputValues.timeEnd);
    useEffect(() => {
        let active = true;
        viewEpoch.current += 1;
        editAttempt.current = null;
        setIsLoading(false);
        setEditWarning('');
        setConfirmReload(false);
        let userData;
        try { userData = JSON.parse(localStorage.getItem("userData")) || {}; } catch { userData = {}; }
        setUser(userData);
        setLoadError('');
        setisChangeDate(false);
        setPropsModal({ isActive: false, handlePost: () => {} });
        if (userData.id && userData.roleCode !== "ADMIN" && !id) {
            fetchCompany(userData.id, userData.companyId);
        }
        if (id) {
            setInputValues({ ...emptyPostForm(), isActionADD: false });
            const load = async () => {
                try {
                    const res = await getDetailPostByIdService(id);
                    if (!active) return;
                    if (!res || res.errCode !== 0 || !res.data) throw new Error(res?.errMessage || 'Không đọc được tin tuyển dụng');
                    const form = jobToForm(res.data);
                    if (String(form.id) !== String(id)) throw new Error('Dữ liệu tin không khớp, vui lòng tải lại');
                    setInputValues(form);
                    settimeEnd(jobDeadlineDate(form.timeEnd));
                } catch (error) {
                    if (active) setLoadError(error.message || 'Không đọc được tin tuyển dụng');
                }
            };
            load();
        } else {
            setInputValues(emptyPostForm());
            settimeEnd(new Date());
        }
        return () => { active = false; viewEpoch.current += 1; };
    }, [fetchCompany, id, reloadVersion]);

    const { data: dataGenderPost } = useFetchAllcode("GENDERPOST");
    const { data: dataJobType } = useFetchAllcode("JOBTYPE");
    const { data: dataJobLevel } = useFetchAllcode("JOBLEVEL");
    const { data: dataSalaryType } = useFetchAllcode("SALARYTYPE");
    const { data: dataExpType } = useFetchAllcode("EXPTYPE");
    const { data: dataWorkType } = useFetchAllcode("WORKTYPE");
    const { data: dataProvince } = useFetchAllcode("PROVINCE");

    useEffect(() => {
        if (id) return; // Never fill null/unknown historical codes while editing.
        const defaults = { genderCode: dataGenderPost, categoryJobCode: dataJobType,
            categoryJoblevelCode: dataJobLevel, salaryJobCode: dataSalaryType,
            experienceJobCode: dataExpType, categoryWorktypeCode: dataWorkType, addressCode: dataProvince };
        setInputValues(current => {
            const changes = Object.fromEntries(Object.entries(defaults)
                .filter(([field, items]) => current[field] === '' && items?.[0]?.code)
                .map(([field, items]) => [field, items[0].code]));
            return Object.keys(changes).length ? { ...current, ...changes } : current;
        });
    }, [id, dataGenderPost, dataJobType, dataJobLevel, dataSalaryType, dataExpType, dataWorkType, dataProvince,
        inputValues.genderCode, inputValues.categoryJobCode, inputValues.categoryJoblevelCode,
        inputValues.salaryJobCode, inputValues.experienceJobCode, inputValues.categoryWorktypeCode, inputValues.addressCode]);
    const handleOnChange = (event) => {
        const { name, value } = event.target;
        setInputValues({ ...inputValues, [name]: value });
    };
    let handleIsHot = (e) => {
        setInputValues({
            ...inputValues,
            isHot: e.target.checked ? 1 : 0,
        });
    };
    let handleEditorChange = ({ html, text }) => {
        setInputValues({
            ...inputValues,
            "descriptionMarkdown": text,
            "descriptionHTML": html,
        });
    };
    let handleOnChangeDatePicker = (date) => {
        settimeEnd(date);
        setisChangeDate(true);
    };
    let handleSavePost = async () => {
        if (!readyToEdit || isLoading || loadError || editWarning || editAttempt.current || inputValues.statusCode === 'PS4') return;
        if (id && !isJobRevision(inputValues.editRevision)) return;
        if (id && !validDeadline) { toast.error('Ngày hết hạn đang lưu không hợp lệ; vui lòng liên hệ quản trị viên'); return; }
        setIsLoading(true);
        if (inputValues.isActionADD === true) {
            if (new Date().getTime() > new Date(timeEnd).getTime()) {
                toast.error("Ngày kết thúc phải hơn ngày hiện tại");
                setIsLoading(false);
            } else {
                const epoch = viewEpoch.current;
                const attempt = {};
                editAttempt.current = attempt;
                const uncertain = () => setEditWarning('Chưa xác định được tin đã tạo hay chưa. Bản nháp được giữ lại; hãy sao chép nội dung và kiểm tra danh sách tin trước khi tạo thêm để tránh trừ lượt hai lần.');
                try {
                    const res = await createPostService({
                        name: inputValues.name,
                        descriptionHTML: inputValues.descriptionHTML,
                        descriptionMarkdown: inputValues.descriptionMarkdown,
                        categoryJobCode: inputValues.categoryJobCode,
                        addressCode: inputValues.addressCode,
                        salaryJobCode: inputValues.salaryJobCode,
                        amount: inputValues.amount,
                        timeEnd: new Date(timeEnd).getTime(),
                        categoryJoblevelCode: inputValues.categoryJoblevelCode,
                        categoryWorktypeCode: inputValues.categoryWorktypeCode,
                        experienceJobCode: inputValues.experienceJobCode,
                        genderPostCode: inputValues.genderCode,
                        userId: user.id,
                        isHot: inputValues.isHot,
                    });
                    if (epoch !== viewEpoch.current) return;
                    if (res && res.errCode === 0) {
                        // A quota refresh failure must not reinterpret a committed creation.
                        fetchCompany(user.id).catch(() => {});
                        toast.success(res.errMessage);
                        setInputValues({
                            ...inputValues,
                            "name": "",
                            "descriptionHTML": "",
                            "descriptionMarkdown": "",
                            "categoryJobCode": "",
                            "addressCode": "",
                            "salaryJobCode": "",
                            "amount": "",
                            "timeEnd": "",
                            "categoryJoblevelCode": "",
                            "categoryWorktypeCode": "",
                            "experienceJobCode": "",
                            "genderCode": "",
                            "isHot": 0,
                        });
                        settimeEnd(new Date());
                    } else {
                        toast.error(res?.errMessage || 'Không tạo được tin');
                        if (!res || ![1, 2, 3].includes(res.errCode) || res.httpStatus >= 500 ||
                            ['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(res.errorType)) uncertain();
                    }
                } catch {
                    if (epoch === viewEpoch.current) uncertain();
                } finally {
                    if (editAttempt.current === attempt) editAttempt.current = null;
                    if (epoch === viewEpoch.current) setIsLoading(false);
                }
            }
        } else {
            const epoch = viewEpoch.current;
            const attempt = {};
            editAttempt.current = attempt;
            try {
                const res = await updatePostService({
                    name: inputValues.name,
                    descriptionHTML: inputValues.descriptionHTML,
                    descriptionMarkdown: inputValues.descriptionMarkdown,
                    categoryJobCode: inputValues.categoryJobCode,
                    addressCode: inputValues.addressCode,
                    salaryJobCode: inputValues.salaryJobCode,
                    amount: inputValues.amount,
                    timeEnd: isChangeDate === false ? inputValues.timeEnd : new Date(timeEnd).getTime(),
                    categoryJoblevelCode: inputValues.categoryJoblevelCode,
                    categoryWorktypeCode: inputValues.categoryWorktypeCode,
                    experienceJobCode: inputValues.experienceJobCode,
                    genderPostCode: inputValues.genderCode,
                    id: inputValues.id,
                    userId: user.id,
                    expectedRevision: inputValues.editRevision,
                }, {});
                if (epoch !== viewEpoch.current) return;
                if (res?.errCode === 0) {
                    toast.success(res.errMessage || 'Đã lưu tin');
                    if (isJobRevision(res.editRevision)) {
                        setInputValues(current => ({ ...current, editRevision: res.editRevision,
                            statusCode: res.changed === false ? current.statusCode : 'PS3' }));
                    } else {
                        setEditWarning('Tin đã lưu nhưng chưa nhận được phiên bản mới. Hãy tải lại trước khi sửa tiếp.');
                    }
                } else {
                    toast.error(res?.errMessage || 'Không lưu được tin');
                    if (res?.conflict || res?.errorType === 'conflict' || res?.httpStatus === 409) {
                        setEditWarning('Tin đã thay đổi. Phần bạn đang nhập được giữ nguyên; hãy sao chép nội dung cần giữ trước khi tải lại.');
                    } else if (!res || ['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(res.errorType) || res.httpStatus >= 500 || res.errCode === -1) {
                        setEditWarning('Chưa xác định được tin đã lưu hay chưa. Phần đang nhập vẫn được giữ; hãy tải lại để đối chiếu trước khi lưu tiếp.');
                    }
                }
            } catch {
                if (epoch === viewEpoch.current) setEditWarning('Chưa xác định được tin đã lưu hay chưa. Hãy giữ lại nội dung cần thiết và tải lại để đối chiếu.');
            } finally {
                if (editAttempt.current === attempt) editAttempt.current = null;
                if (epoch === viewEpoch.current) setIsLoading(false);
            }
        }
    };
    let handleReupPost = async (timeEnd) => {
        if (!id || !readyToEdit || loadError || editWarning || isLoading || editAttempt.current || reupBlocked.current
            || inputValues.statusCode === 'PS4' || !validDeadline || !isJobRevision(inputValues.editRevision)) return false;
        const epoch = viewEpoch.current, attempt = {};
        editAttempt.current = attempt;
        const uncertain = () => {
            reupBlocked.current = true;
            setReupWarning('Chưa xác định được tin đã đăng lại hay chưa. Hãy giữ nội dung, ngày đã chọn và kiểm tra danh sách tin trước khi đăng lại để tránh trừ lượt hai lần. Tải lại tin gốc không xác nhận được kết quả này.');
        };
        try {
            const res = await reupPostService({ userId: user.id, postId: id, timeEnd,
                expectedRevision: inputValues.editRevision });
            if (epoch !== viewEpoch.current) return false;
            if (res?.errCode === 0) {
                reupBlocked.current = true;
                setReupWarning('Đã đăng lại thành công. Tin gốc và phần đang nhập được giữ nguyên. Hãy sao chép phần cần giữ trước khi mở tin mới.');
                toast.success(res.errMessage || 'Đã đăng lại tin');
                const newId = Number(res.postId);
                if (Number.isSafeInteger(newId) && newId > 0 && newId !== Number(id)) setReupCreatedId(newId);
                return true;
            }
            toast.error(res?.errMessage || 'Không đăng lại được tin');
            if (res?.conflict || res?.httpStatus === 409 || res?.errorType === 'conflict') {
                setEditWarning('Tin gốc đã thay đổi. Hãy giữ nội dung cần thiết và tải lại trước khi đăng lại.');
            } else if (!res || ![1, 2, 3].includes(res.errCode) || res.httpStatus >= 500 ||
                ['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(res.errorType)) uncertain();
            return false;
        } catch {
            if (epoch === viewEpoch.current) uncertain();
            return false;
        } finally {
            if (editAttempt.current === attempt) editAttempt.current = null;
        }
    };
    const navigate = useNavigate();
    return (
        <>
            <div className="">
                <div className="col-12 grid-margin">
                    <div className="card">
                        <div className="card-body">
                            <div
                                onClick={() => navigate(-1)}
                                className="mb-2 hover-pointer"
                                style={{ color: "red" }}
                            >
                                <i className="fa-solid fa-arrow-left mr-2"></i>Quay
                                lại
                            </div>
                            <h4 className="card-title">
                                {inputValues.isActionADD === true
                                    ? "Thêm mới bài đăng"
                                    : user?.roleCode === "ADMIN"
                                    ? "Xem thông tin bài đăng"
                                    : "Cập nhật bài đăng"}
                            </h4>
                            <br></br>
                            {inputValues.isActionADD === true &&
                                user.roleCode !== "ADMIN" && (
                                    <div className="mb-5">
                                        <h4>Công ty còn:</h4>
                                        <p>
                                            {companyPostAllow.nonHot} bài bình
                                            thường
                                        </p>
                                        <p>
                                            {companyPostAllow.hot} bài nổi bật
                                        </p>
                                    </div>
                                )}
                            {id && !readyToEdit && !loadError && <p role="status">Đang tải thông tin tin...</p>}
                            {loadError && <p role="alert">{loadError}. Vui lòng tải lại trang.</p>}
                            {id && readyToEdit && <p>Trạng thái lúc tải: {jobStatusLabel(inputValues.statusCode)}</p>}
                            {id && readyToEdit && !isJobRevision(inputValues.editRevision) && <p role="alert">Chưa có thông tin phiên bản của tin. Vui lòng tải lại hoặc liên hệ quản trị viên để sửa an toàn.</p>}
                            {editWarning && <p role="alert">{editWarning}</p>}
                            {reupWarning && <p role="status">{reupWarning}</p>}
                            {reupCreatedId && <button type="button" onClick={() => navigate(`/admin/edit-post/${reupCreatedId}/`)}>Xem tin đăng lại</button>}
                            {id && (editWarning || loadError || (readyToEdit && !isJobRevision(inputValues.editRevision))) &&
                                <button type="button" onClick={() => setConfirmReload(true)}>Tải lại tin</button>}
                            {confirmReload && <div role="alertdialog" aria-label="Xác nhận tải lại tin">
                                <p>Tải lại sẽ bỏ phần chưa lưu trên biểu mẫu. Bạn nên sao chép nội dung cần giữ trước khi tiếp tục.</p>
                                <button type="button" onClick={() => setReloadVersion(value => value + 1)}>Bỏ phần chưa lưu và tải lại</button>
                                <button type="button" onClick={() => setConfirmReload(false)}>Giữ biểu mẫu</button>
                            </div>}
                            {id && readyToEdit && !validDeadline && <p role="alert">Ngày hết hạn đang lưu không hợp lệ; vui lòng liên hệ quản trị viên.</p>}
                            <form className="form-sample">
                                <div className="row">
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Tên bài đăng
                                            </label>
                                            <div className="col-sm-9">
                                                <input
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    value={inputValues.name}
                                                    name="name"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                    type="text"
                                                    className="form-control"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Địa chỉ
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.addressCode
                                                    }
                                                    name="addressCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataProvince, inputValues.addressCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="row">
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                SL nhân viên
                                            </label>
                                            <div className="col-sm-9">
                                                <input
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    value={inputValues.amount}
                                                    name="amount"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                    type="number"
                                                    className="form-control"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Thời gian KT
                                            </label>
                                            <div className="col-sm-9">
                                                <DatePicker
                                                    disabled={
                                                        !inputValues.isActionADD
                                                    }
                                                    className="form-control"
                                                    onChange={
                                                        handleOnChangeDatePicker
                                                    }
                                                    selected={timeEnd}
                                                />
                                                {!inputValues.isActionADD && (
                                                    <small className="text-muted d-block mt-1">
                                                        Ngày hết hạn giữ nguyên khi sửa tin. Muốn gia hạn, hãy dùng Đăng lại.
                                                    </small>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="row">
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Giới tính
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.genderCode
                                                    }
                                                    name="genderCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataGenderPost, inputValues.genderCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Kinh nghiệm
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.experienceJobCode
                                                    }
                                                    name="experienceJobCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataExpType, inputValues.experienceJobCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="row">
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Ngành
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.categoryJobCode
                                                    }
                                                    name="categoryJobCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataJobType, inputValues.categoryJobCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Chức vụ
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.categoryJoblevelCode
                                                    }
                                                    name="categoryJoblevelCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataJobLevel, inputValues.categoryJoblevelCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="row">
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Lương
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.salaryJobCode
                                                    }
                                                    name="salaryJobCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataSalaryType, inputValues.salaryJobCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-md-6">
                                        <div className="form-group row">
                                            <label className="col-sm-3 col-form-label">
                                                Hình thức LV
                                            </label>
                                            <div className="col-sm-9">
                                                <select
                                                    disabled={
                                                        user?.roleCode ===
                                                        "ADMIN"
                                                            ? true
                                                            : false
                                                    }
                                                    style={{ color: "black" }}
                                                    className="form-control"
                                                    value={
                                                        inputValues.categoryWorktypeCode
                                                    }
                                                    name="categoryWorktypeCode"
                                                    onChange={(event) =>
                                                        handleOnChange(event)
                                                    }
                                                >
                                                    {jobClassificationOptions(dataWorkType, inputValues.categoryWorktypeCode).map(
                                                            (item, index) => {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {inputValues.isActionADD && (
                                    <>
                                        <div className="row">
                                            <div className="col-md-6">
                                                <div className="form-group row">
                                                    <label className="col-sm-3 col-form-label">
                                                        Bài viết nổi bật
                                                    </label>
                                                    <div className="col-sm-9">
                                                        <input
                                                            disabled={
                                                                user?.roleCode ===
                                                                "ADMIN"
                                                                    ? true
                                                                    : false
                                                            }
                                                            onChange={
                                                                handleIsHot
                                                            }
                                                            checked={
                                                                inputValues.isHot
                                                            }
                                                            style={{
                                                                marginTop:
                                                                    "20px",
                                                            }}
                                                            type={"checkbox"}
                                                        ></input>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                                <div className="row">
                                    <div className="col-md-12">
                                        <label className="form-label">
                                            Mô tả công việc
                                        </label>
                                        <div className="form-group">
                                            <MdEditor
                                                style={{ height: "500px" }}
                                                renderHTML={(text) =>
                                                    mdParser.render(text)
                                                }
                                                onChange={handleEditorChange}
                                                value={
                                                    inputValues.descriptionMarkdown
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                                {user.roleCode !== "ADMIN" && (
                                    <>
                                        <button
                                            disabled={!readyToEdit || !!loadError || !!editWarning || isLoading || inputValues.statusCode === 'PS4' || (!!id && (!validDeadline || !isJobRevision(inputValues.editRevision)))}
                                            onClick={() => handleSavePost()}
                                            type="button"
                                            className="btn1 btn1-primary1 btn1-icon-text"
                                        >
                                            <i className="ti-file btn1-icon-prepend"></i>
                                            Lưu
                                        </button>
                                    </>
                                )}
                                {id && readyToEdit && !loadError && validDeadline && inputValues.statusCode !== 'PS4' &&
                                    user.roleCode !== "ADMIN" &&
                                    new Date().getTime() >
                                        new Date(timeEnd).getTime() && (
                                        <>
                                            <button
                                                disabled={!!editWarning || !!reupWarning || isLoading || !isJobRevision(inputValues.editRevision)}
                                                onClick={() =>
                                                    setPropsModal({
                                                        ...propsModal,
                                                        isActive: true,
                                                        handlePost:
                                                            handleReupPost,
                                                    })
                                                }
                                                type="button"
                                                className="ml-2 btn1 btn1-primary1 btn1-icon-text"
                                            >
                                                <i className="ti-file btn1-icon-prepend"></i>
                                                Đăng lại
                                            </button>
                                        </>
                                    )}
                            </form>
                        </div>
                    </div>
                </div>
            </div>
            {isLoading && (
                <Modal isOpen="true" centered contentClassName="closeBorder">
                    <div
                        style={{
                            position: "absolute",
                            right: "50%",
                            justifyContent: "center",
                            alignItems: "center",
                        }}
                    >
                        <Spinner animation="border"></Spinner>
                    </div>
                </Modal>
            )}
            <ReupPostModal
                key={id || 'create'}
                isOpen={propsModal.isActive}
                blocked={!!editWarning || !!reupWarning}
                feedback={reupWarning || editWarning}
                onHide={() =>
                    setPropsModal({
                        ...propsModal,
                        isActive: false,
                    })
                }
                id={propsModal.postId}
                handleFunc={propsModal.handlePost}
            />
        </>
    );
};

export default AddPost;
