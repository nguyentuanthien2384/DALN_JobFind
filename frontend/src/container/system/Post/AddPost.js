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
import { readLegacyCreateAttempt, prepareLegacyCreateAttempt, settleLegacyCreateAttempt,
    clearSuccessfulLegacyCreate, assertLegacyCreateIdentity, assertPendingLegacyCreate, isLegacyCreateReceipt } from '../../../service/legacyCreateAttempt';
import { readLegacyRepostAttempt, prepareLegacyRepostAttempt, assertPendingLegacyRepost,
    settleLegacyRepostAttempt, isLegacyRepostReceipt } from '../../../service/legacyRepostAttempt';
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
    const [repostAttempt, setRepostAttempt] = useState(null);
    const [repostError, setRepostError] = useState('');
    const reupWarning = repostAttempt?.status === 'pending'
        ? 'Chưa xác định được kết quả đăng lại. Mã, phiên bản và ngày đã gửi được giữ; hãy đối chiếu cùng mã hoặc kiểm tra danh sách tin. Tải lại tin gốc không xác nhận kết quả này.'
        : repostAttempt?.status === 'blocked' ? 'Phản hồi đăng lại không khớp mã/tin gốc. Hãy giữ thông tin và liên hệ hỗ trợ; không gửi bằng mã mới.'
        : repostAttempt?.status === 'succeeded' ? 'Đã đăng lại thành công. Tin gốc và phần đang nhập được giữ nguyên; hãy sao chép phần cần giữ trước khi mở tin mới.' : '';
    const reupCreatedId = repostAttempt?.status === 'succeeded' ? repostAttempt.postId : null;
    const [createAttempt, setCreateAttempt] = useState(null);
    const [createError, setCreateError] = useState('');
    const createLocked = !id && (!!createError || (!!createAttempt && createAttempt.status !== 'rejected') || isLoading);
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
        setCreateAttempt(null);
        setCreateError('');
        setRepostAttempt(null);
        setRepostError('');
        setisChangeDate(false);
        setPropsModal({ isActive: false });
        if (userData.id && userData.roleCode !== "ADMIN" && !id) {
            fetchCompany(userData.id, userData.companyId);
        }
        if (id) {
            if (userData.id && userData.companyId) {
                try { setRepostAttempt(readLegacyRepostAttempt(userData, id)); }
                catch { setRepostError('Không đọc được thao tác đăng lại đã lưu. Hãy liên hệ hỗ trợ trước khi đăng lại.'); }
            }
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
            if (userData.id) {
                try {
                    const saved = readLegacyCreateAttempt(userData);
                    if (saved) {
                        setCreateAttempt(saved);
                        setInputValues({ ...emptyPostForm(), ...saved.payload, genderCode: saved.payload.genderPostCode });
                        settimeEnd(new Date(saved.payload.timeEnd));
                    }
                } catch {
                    setCreateError('Không đọc được thao tác đăng tin đã lưu. Hãy giữ nội dung và liên hệ hỗ trợ trước khi tạo thêm.');
                }
            }
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
        if (createLocked) return;
        const { name, value } = event.target;
        setInputValues({ ...inputValues, [name]: value });
    };
    let handleIsHot = (e) => {
        if (createLocked) return;
        setInputValues({
            ...inputValues,
            isHot: e.target.checked ? 1 : 0,
        });
    };
    let handleEditorChange = ({ html, text }) => {
        if (createLocked) return;
        setInputValues({
            ...inputValues,
            "descriptionMarkdown": text,
            "descriptionHTML": html,
        });
    };
    let handleOnChangeDatePicker = (date) => {
        if (createLocked) return;
        settimeEnd(date);
        setisChangeDate(true);
    };
    const sendCreateAttempt = async (sent) => {
        if (editAttempt.current || createError || !sent || sent.status !== 'pending') return;
        try { assertPendingLegacyCreate(user, sent); }
        catch (error) { setCreateError(error.message); return; }
        const epoch = viewEpoch.current, attempt = {};
        editAttempt.current = attempt;
        setIsLoading(true);
        try {
            assertLegacyCreateIdentity(user);
            const res = await createPostService(sent.payload, { idempotencyKey: sent.key });
            let patch;
            if (isLegacyCreateReceipt(res, sent)) patch = { status: 'succeeded', postId: Number(res.postId) };
            else if (res?.errCode === 0 || res?.httpStatus === 409 || res?.conflict || res?.errorType === 'conflict') patch = { status: 'blocked' };
            else if ([1, 2, 3].includes(res?.errCode) && !(res.httpStatus >= 500) &&
                !['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(res.errorType)) patch = { status: 'rejected' };
            else patch = { status: 'pending' };
            const saved = settleLegacyCreateAttempt(user, sent, patch);
            if (epoch !== viewEpoch.current) return;
            assertLegacyCreateIdentity(user);
            setCreateAttempt(saved);
            if (saved.status === 'succeeded') {
                fetchCompany(user.id).catch(() => {});
                toast.success(res?.errMessage || 'Đã tạo tin; không trừ thêm lượt khi đối chiếu');
            } else toast.error(res?.errMessage || 'Chưa xác nhận được kết quả tạo tin');
        } catch (error) {
            if (epoch === viewEpoch.current) {
                // A thrown transport error leaves the already-persisted payload/key
                // untouched. No automatic retry and no clearing of the draft.
                try { assertLegacyCreateIdentity(user); readLegacyCreateAttempt(user); }
                catch { setCreateError('Không đối chiếu được tài khoản hoặc mã đã lưu. Hãy tải lại trang và liên hệ hỗ trợ nếu lỗi còn tiếp diễn.'); }
                toast.error('Chưa xác nhận được kết quả; giữ nguyên mã thao tác để đối chiếu.');
            }
        } finally {
            if (editAttempt.current === attempt) editAttempt.current = null;
            if (epoch === viewEpoch.current) setIsLoading(false);
        }
    };
    let handleSavePost = async () => {
        if (!readyToEdit || isLoading || loadError || editWarning || editAttempt.current || inputValues.statusCode === 'PS4') return;
        if (id && !isJobRevision(inputValues.editRevision)) return;
        if (id && !validDeadline) { toast.error('Ngày hết hạn đang lưu không hợp lệ; vui lòng liên hệ quản trị viên'); return; }
        if (inputValues.isActionADD === true) {
            if (createLocked) return;
            if (!Number.isFinite(new Date(timeEnd).getTime()) || Date.now() >= new Date(timeEnd).getTime()) {
                toast.error("Ngày kết thúc phải hơn ngày hiện tại");
            } else {
                try {
                    assertLegacyCreateIdentity(user);
                    const saved = prepareLegacyCreateAttempt(user, {
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
                    }, createAttempt);
                    setCreateAttempt(saved);
                    await sendCreateAttempt(saved);
                } catch (error) {
                    setCreateError(error.message || 'Không lưu được mã thao tác. Tin chưa được gửi.');
                }
            }
        } else {
            setIsLoading(true);
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
    const sendRepostAttempt = async sent => {
        if (!id || !sent || sent.status !== 'pending' || editAttempt.current || isLoading || repostError) return false;
        try { assertPendingLegacyRepost(user, id, sent); }
        catch (error) { setRepostError(error.message); return false; }
        const epoch = viewEpoch.current, attempt = {};
        editAttempt.current = attempt;
        setIsLoading(true);
        try {
            // Replay intentionally ignores the newly loaded source revision or
            // deadline. The server decides whether this is a receipt or a write.
            const res = await reupPostService(sent.payload, { idempotencyKey: sent.key });
            const conflict = res?.conflict || res?.httpStatus === 409 || res?.errorType === 'conflict';
            let patch;
            if (isLegacyRepostReceipt(res, sent)) patch = { status: 'succeeded', postId: Number(res.postId) };
            else if (res?.errCode === 0) patch = { status: 'blocked' };
            else if (conflict || ([1, 2, 3].includes(res?.errCode) && !(res.httpStatus >= 500)
                && !['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(res.errorType))) patch = { status: 'rejected' };
            else patch = { status: 'pending' };
            const saved = settleLegacyRepostAttempt(user, id, sent, patch);
            if (epoch !== viewEpoch.current) return false;
            assertLegacyCreateIdentity(user);
            setRepostAttempt(saved);
            if (saved.status === 'succeeded') {
                toast.success(res.errMessage || 'Đã đăng lại tin');
                return true;
            }
            toast.error(res?.errMessage || 'Không đăng lại được tin');
            if (conflict) setEditWarning('Tin gốc hoặc mã thao tác đã thay đổi. Hãy giữ nội dung và tải lại trước khi thử tiếp; vẫn dùng mã cũ để tránh tạo trùng.');
            return false;
        } catch {
            if (epoch === viewEpoch.current) {
                try { assertPendingLegacyRepost(user, id, sent); }
                catch { setRepostError('Không đối chiếu được tài khoản hoặc mã đã lưu. Hãy tải lại và liên hệ hỗ trợ nếu lỗi còn tiếp diễn.'); }
                toast.error('Chưa xác nhận được kết quả đăng lại; giữ nguyên mã thao tác để đối chiếu.');
            }
            return false;
        } finally {
            if (editAttempt.current === attempt) editAttempt.current = null;
            if (epoch === viewEpoch.current) setIsLoading(false);
        }
    };
    let handleReupPost = async (timeEnd) => {
        if (!id || !readyToEdit || loadError || editWarning || isLoading || editAttempt.current || reupWarning || repostError
            || !['PS1', 'PS2', 'PS3'].includes(inputValues.statusCode) || !validDeadline
            || validDeadline.getTime() > Date.now() || !isJobRevision(inputValues.editRevision)) return false;
        if (!Number.isSafeInteger(timeEnd) || timeEnd <= Date.now()) return false;
        try {
            const saved = prepareLegacyRepostAttempt(user, id, { userId: user.id, postId: id, timeEnd,
                expectedRevision: inputValues.editRevision }, repostAttempt);
            setRepostAttempt(saved);
            return await sendRepostAttempt(saved);
        } catch (error) {
            setRepostError(error.message || 'Không lưu được mã thao tác; chưa gửi yêu cầu đăng lại');
            return false;
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
                            {!id && createError && <p role="alert">{createError}</p>}
                            {!id && createAttempt?.status === 'pending' && <div role="alert">
                                <p>Đã giữ mã và nội dung gửi trong tab này. Nếu chưa rõ kết quả, hãy đối chiếu bằng cùng mã hoặc kiểm tra danh sách tin. Không mở thao tác mới để gửi lại cùng tin.</p>
                                <button type="button" disabled={isLoading || !!createError} onClick={() => sendCreateAttempt(createAttempt)}>Đối chiếu / gửi lại cùng mã</button>
                            </div>}
                            {!id && createAttempt?.status === 'blocked' && <p role="alert">Mã thao tác hoặc phản hồi không khớp. Nội dung được giữ lại; hãy kiểm tra danh sách tin và liên hệ hỗ trợ. Không gửi bằng mã mới.</p>}
                            {!id && createAttempt?.status === 'rejected' && <p role="status">Yêu cầu bị từ chối. Bạn có thể sửa nội dung rồi lưu; mã thao tác vẫn được giữ để tránh tạo trùng.</p>}
                            {!id && createAttempt?.status === 'succeeded' && <div role="status">
                                <p>Đã tạo tin #{createAttempt.postId}. Nội dung được giữ lại; gửi lại cùng mã không trừ thêm lượt.</p>
                                <button type="button" onClick={() => navigate(`/admin/edit-post/${createAttempt.postId}/`)}>Xem tin đã tạo</button>
                                <button type="button" disabled={!!createError} onClick={() => {
                                    try {
                                        assertLegacyCreateIdentity(user); clearSuccessfulLegacyCreate(user);
                                        setCreateAttempt(null); setInputValues(emptyPostForm()); settimeEnd(new Date());
                                    } catch (error) { setCreateError(error.message); }
                                }}>Tạo tin khác</button>
                            </div>}
                            {reupWarning && <p role="status">{reupWarning}</p>}
                            {repostError && <p role="alert">{repostError}</p>}
                            {id && repostAttempt && <p>Ngày kết thúc đã gửi khi đăng lại: {new Date(repostAttempt.payload.timeEnd).toLocaleString('vi-VN')}</p>}
                            {id && repostAttempt?.status === 'pending' && <button type="button" disabled={isLoading || !!repostError}
                                onClick={() => sendRepostAttempt(repostAttempt)}>Đối chiếu đăng lại cùng mã</button>}
                            {id && repostAttempt?.status === 'rejected' && <p role="status">Yêu cầu đăng lại bị từ chối. Ngày đã gửi và mã cũ được giữ; lần sửa ngày/phiên bản tiếp theo vẫn dùng cùng mã.</p>}
                            {reupCreatedId && <button type="button" onClick={() => navigate(`/admin/edit-post/${reupCreatedId}/`)}>Xem tin đăng lại</button>}
                            {id && (editWarning || loadError || (readyToEdit && !isJobRevision(inputValues.editRevision))) &&
                                <button type="button" onClick={() => setConfirmReload(true)}>Tải lại tin</button>}
                            {confirmReload && <div role="alertdialog" aria-label="Xác nhận tải lại tin">
                                <p>Tải lại sẽ bỏ phần chưa lưu trên biểu mẫu. Bạn nên sao chép nội dung cần giữ trước khi tiếp tục.</p>
                                <button type="button" onClick={() => setReloadVersion(value => value + 1)}>Bỏ phần chưa lưu và tải lại</button>
                                <button type="button" onClick={() => setConfirmReload(false)}>Giữ biểu mẫu</button>
                            </div>}
                            {id && readyToEdit && !validDeadline && <p role="alert">Ngày hết hạn đang lưu không hợp lệ; vui lòng liên hệ quản trị viên.</p>}
                            {id && readyToEdit && !loadError && <p className="text-muted">
                                Thay đổi bất kỳ thông tin tuyển dụng nào sẽ đưa tin về chờ duyệt; lưu khi không có thay đổi sẽ giữ nguyên trạng thái.
                            </p>}
                            <form className="form-sample">
                                <fieldset disabled={createLocked}>
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
                                                        Ngày hết hạn giữ nguyên khi sửa tin. Khi tin đã hết hạn, dùng Đăng lại trong cùng công ty để tạo bản mới và trừ một lượt đăng.
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
                                </fieldset>
                                {user.roleCode !== "ADMIN" && (
                                    <>
                                        <button
                                            disabled={createLocked || !readyToEdit || !!loadError || !!editWarning || isLoading || inputValues.statusCode === 'PS4' || (!!id && (!validDeadline || !isJobRevision(inputValues.editRevision)))}
                                            onClick={() => handleSavePost()}
                                            type="button"
                                            className="btn1 btn1-primary1 btn1-icon-text"
                                        >
                                            <i className="ti-file btn1-icon-prepend"></i>
                                            Lưu
                                        </button>
                                    </>
                                )}
                                {id && readyToEdit && !loadError && validDeadline && ['PS1', 'PS2', 'PS3'].includes(inputValues.statusCode) &&
                                    user.roleCode !== "ADMIN" &&
                                    Date.now() >= validDeadline.getTime() && (
                                        <>
                                            <button
                                                disabled={!!editWarning || !!reupWarning || !!repostError || isLoading || !isJobRevision(inputValues.editRevision)}
                                                onClick={() =>
                                                    setPropsModal({
                                                        ...propsModal,
                                                        isActive: true,
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
            {isLoading && !propsModal.isActive && (
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
                blocked={!!editWarning || !!reupWarning || !!repostError}
                feedback={repostError || reupWarning || editWarning}
                initialTimeEnd={repostAttempt?.payload.timeEnd}
                onHide={() =>
                    setPropsModal({
                        ...propsModal,
                        isActive: false,
                    })
                }
                handleFunc={handleReupPost}
            />
        </>
    );
};

export default AddPost;
