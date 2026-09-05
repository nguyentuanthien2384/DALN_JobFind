import React from "react";
import { useCallback, useEffect, useState } from "react";
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
import { jobToForm, jobDeadlineDate, jobClassificationOptions, jobStatusLabel } from "../../../service/jobFormAdapter";
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
    const readyToEdit = !id || (!inputValues.isActionADD && String(inputValues.id) === String(id));
    const validDeadline = jobDeadlineDate(inputValues.timeEnd);
    useEffect(() => {
        let active = true;
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
        return () => { active = false; };
    }, [fetchCompany, id]);

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
        if (!readyToEdit || isLoading || loadError || inputValues.statusCode === 'PS4') return;
        if (id && !validDeadline) { toast.error('Ngày hết hạn đang lưu không hợp lệ; vui lòng liên hệ quản trị viên'); return; }
        setIsLoading(true);
        if (inputValues.isActionADD === true) {
            if (new Date().getTime() > new Date(timeEnd).getTime()) {
                toast.error("Ngày kết thúc phải hơn ngày hiện tại");
                setIsLoading(false);
            } else {
                let res = await createPostService({
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
                setTimeout(() => {
                    setIsLoading(false);
                    if (res && res.errCode === 0) {
                        fetchCompany(user.id);
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
                        toast.error(res.errMessage);
                    }
                }, 1000);
            }
        } else {
            let res = await updatePostService({
                name: inputValues.name,
                descriptionHTML: inputValues.descriptionHTML,
                descriptionMarkdown: inputValues.descriptionMarkdown,
                categoryJobCode: inputValues.categoryJobCode,
                addressCode: inputValues.addressCode,
                salaryJobCode: inputValues.salaryJobCode,
                amount: inputValues.amount,
                timeEnd:
                    isChangeDate === false
                        ? inputValues.timeEnd
                        : new Date(timeEnd).getTime(),
                categoryJoblevelCode: inputValues.categoryJoblevelCode,
                categoryWorktypeCode: inputValues.categoryWorktypeCode,
                experienceJobCode: inputValues.experienceJobCode,
                genderPostCode: inputValues.genderCode,
                id: inputValues.id,
                userId: user.id,
            });
            setTimeout(() => {
                setIsLoading(false);
                if (res && res.errCode === 0) {
                    toast.success(res.errMessage);
                } else {
                    toast.error(res.errMessage);
                }
            }, 1000);
        }
    };
    let handleReupPost = async (timeEnd) => {
        if (!readyToEdit || loadError || inputValues.statusCode === 'PS4' || !validDeadline) return;
        let res = await reupPostService({
            userId: user.id,
            postId: id,
            timeEnd: timeEnd,
        });
        if (res && res.errCode === 0) {
            toast.success(res.errMessage);
        } else {
            toast.error(res.errMessage);
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
                                            disabled={!readyToEdit || !!loadError || isLoading || inputValues.statusCode === 'PS4' || (!!id && !validDeadline)}
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
                isOpen={propsModal.isActive}
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
