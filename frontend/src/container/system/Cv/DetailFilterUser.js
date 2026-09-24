import React from "react";
import { useEffect, useState } from "react";
import {
    getDetailUserById,
    getAllSkillByJobCode,
} from "../../../service/userService";
import {
    checkSeeCandiate,
    getAllListCvByUserIdService,
} from "../../../service/cvService";
import moment from "moment";

import { useFetchAllcode } from "../../../util/fetch";
import { toast } from "react-toastify";
import "react-image-lightbox/style.css";
import { Select } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import PdfPreviewButton from "../../../components/documents/PdfPreviewButton";
import { SESSION_ENDED_EVENT } from "../../../auth/sessionExpiry";
import RecruiterAiReview from './RecruiterAiReview';

const DetailFilterUser = () => {
    const [listSkills, setListSkills] = useState([]);
    // Truoc day trang nay chi hien TIEU CHI TIM VIEC (linh vuc, luong, ky nang...).
    // Nha tuyen dung khong xem duoc thong tin lien he lan lich su ung tuyen cua
    // ung vien, phai lan sang trang khac. Gom het ve mot cho.
    const [hoSo, setHoSo] = useState(null);
    const [dsCv, setDsCv] = useState([]);
    const [inputValues, setInputValues] = useState({
        jobType: "",
        salary: "",
        skills: [],
        jobProvince: "",
        exp: "",
        file: "",
    });
    const { id } = useParams();
    const navigate = useNavigate();
    const token = localStorage.getItem('token_user');
    const sessionUser = localStorage.getItem('userData');
    const scope = JSON.stringify([id, token, sessionUser]);
    const [loadState, setLoadState] = useState(null);
    const [ended, setEnded] = useState(false);

    useEffect(() => {
        const end = () => setEnded(true);
        const storage = event => { if (event.key === null || ['userData', 'token_user'].includes(event.key)) end(); };
        window.addEventListener(SESSION_ENDED_EVENT, end);
        window.addEventListener('storage', storage);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', storage); };
    }, []);

    useEffect(() => {
        let active = true, redirect;
        const isCurrent = () => active && !ended && localStorage.getItem('token_user') === token && localStorage.getItem('userData') === sessionUser;
        setLoadState({ scope, loading: true });
        setHoSo(null);
        setDsCv([]);
        setListSkills([]);
        const getListSkill = async (jobType) => {
            try {
                const res = await getAllSkillByJobCode(jobType);
                if (isCurrent()) setListSkills((res?.data || []).map((item) => ({ value: item.id, label: item.name })));
            } catch { if (isCurrent()) setListSkills([]); }
        };

        const setStateUser = (data) => {
            const settings = data?.userAccountData?.userSettingData || {};
            if (settings.categoryJobCode) getListSkill(settings.categoryJobCode);
            const skills = Array.isArray(data.listSkills)
                ? data.listSkills.map((item) => item.SkillId)
                : [];
            setInputValues((currentValues) => ({
                ...currentValues,
                jobType: settings.categoryJobCode || "",
                salary: settings.salaryJobCode || "",
                skills,
                jobProvince: settings.addressCode || "",
                exp: settings.experienceJobCode || "",
                isFindJob: settings.isFindJob,
                isTakeMail: settings.isTakeMail,
                file: settings.file || "",
            }));
        };

        if (id && !ended) {
            let fetchUser = async () => {
                try {
                    const check = await checkSeeCandiate({ candidateId: id });
                    if (!isCurrent()) return;
                    if (check?.errCode !== 0 || check.httpStatus >= 400) {
                        const message = check?.errMessage || 'Không có quyền xem hồ sơ này.';
                        setLoadState({ scope, error: message });
                        toast.error(message);
                        redirect = setTimeout(() => { if (isCurrent()) navigate("/admin/list-candiate/"); }, 1000);
                        return;
                    }
                    const user = await getDetailUserById(id);
                    if (!isCurrent()) return;
                    if (user?.errCode === 0 && !(user.httpStatus >= 400) && user.data) {
                        setStateUser(user.data);
                        setHoSo(user.data);
                    } else throw new Error(user?.errMessage || 'Không tải được hồ sơ ứng viên.');
                    const cv = await getAllListCvByUserIdService({ userId: id, limit: 20, offset: 0 });
                    if (!isCurrent()) return;
                    if (cv?.errCode === 0) setDsCv(cv.data || []);
                    setLoadState({ scope, loading: false });
                } catch (error) {
                    if (isCurrent()) setLoadState({ scope, error: error.message || 'Không tải được hồ sơ ứng viên.' });
                }
            };
            fetchUser();
        }
        return () => { active = false; clearTimeout(redirect); };
    }, [id, navigate, scope, token, sessionUser, ended]);

    let { data: dataProvince } = useFetchAllcode("PROVINCE");
    let { data: dataExp } = useFetchAllcode("EXPTYPE");
    let { data: dataSalary } = useFetchAllcode("SALARYTYPE");
    let { data: dataJobType } = useFetchAllcode("JOBTYPE");

    dataProvince = dataProvince.map((item) => ({
        value: item.code,
        label: item.value,
    }));

    dataExp = dataExp.map((item) => ({
        value: item.code,
        label: item.value,
    }));

    dataSalary = dataSalary.map((item) => ({
        value: item.code,
        label: item.value,
    }));

    dataJobType = dataJobType.map((item) => ({
        value: item.code,
        label: item.value,
    }));
    if (ended) return <p role="alert">Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại để xem hồ sơ.</p>;
    if (loadState?.scope !== scope || loadState.loading) return <p role="status">Đang tải hồ sơ ứng viên…</p>;
    if (loadState.error) return <p role="alert">{loadState.error}</p>;
    return (
        <div className="">
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <div
                            onClick={() => navigate(-1)}
                            className="mb-2 hover-pointer"
                            style={{ color: "red" }}
                        >
                            <i className="fa-solid fa-arrow-left mr-2"></i>Quay lại
                        </div>

                        <h4 className="card-title">
                            Thông tin chi tiết ứng viên
                        </h4>

                        {/* ---- Thông tin liên hệ ---- */}
                        {hoSo && hoSo.userAccountData && (
                            <div className="ho-so-ung-vien">
                                <img
                                    className="ho-so-avatar"
                                    src={hoSo.userAccountData.image}
                                    alt=""
                                />
                                <div className="ho-so-thong-tin">
                                    <h5 className="ho-so-ten">
                                        {hoSo.userAccountData.firstName}{" "}
                                        {hoSo.userAccountData.lastName}
                                    </h5>
                                    <div className="ho-so-dong">
                                        <span>
                                            <i className="fas fa-phone"></i>
                                            {hoSo.phonenumber || "Chưa có"}
                                        </span>
                                        <span>
                                            <i className="far fa-envelope"></i>
                                            {hoSo.userAccountData.email || "Chưa có"}
                                        </span>
                                        <span>
                                            <i className="fas fa-map-marker-alt"></i>
                                            {hoSo.userAccountData.address || "Chưa có"}
                                        </span>
                                        <span>
                                            <i className="far fa-calendar"></i>
                                            {hoSo.userAccountData.dob || "Chưa có"}
                                        </span>
                                        {hoSo.userAccountData.genderData && (
                                            <span>
                                                <i className="fas fa-venus-mars"></i>
                                                {hoSo.userAccountData.genderData.value}
                                            </span>
                                        )}
                                    </div>
                                    {hoSo.listSkills && hoSo.listSkills.length > 0 && (
                                        <div className="ho-so-ky-nang">
                                            {hoSo.listSkills.map((item, index) => (
                                                <span className="the-ky-nang" key={index}>
                                                    {item.Skill ? item.Skill.name : ""}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <RecruiterAiReview key={JSON.stringify([scope, inputValues.file])} source={inputValues.file}
                            candidateId={id} token={token} sessionUser={sessionUser} />

                        {/* ---- Lịch sử ứng tuyển ---- */}
                        <div className="ho-so-muc">
                            <h5 className="ho-so-muc-tieu-de">
                                Lịch sử ứng tuyển
                                <span className="ho-so-dem">{dsCv.length}</span>
                            </h5>
                            {dsCv.length > 0 ? (
                                <div className="table-responsive">
                                    <table className="table table-hover">
                                        <thead>
                                            <tr>
                                                <th>Tin tuyển dụng</th>
                                                <th>Lời nhắn của ứng viên</th>
                                                <th>Ngày nộp</th>
                                                <th>Trạng thái</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dsCv.map((cv) => (
                                                <tr key={cv.id}>
                                                    <td>
                                                        {cv.postCvData &&
                                                        cv.postCvData.postDetailData
                                                            ? cv.postCvData.postDetailData.name
                                                            : "Tin đã bị xóa"}
                                                    </td>
                                                    <td>{cv.description}</td>
                                                    <td>
                                                        {moment(cv.createdAt).format(
                                                            "DD/MM/YYYY"
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span
                                                            className={
                                                                "nhan-trang-thai " +
                                                                (+cv.isChecked === 1
                                                                    ? "da-xem"
                                                                    : "chua-xem")
                                                            }
                                                        >
                                                            {+cv.isChecked === 1
                                                                ? "Đã xem"
                                                                : "Chưa xem"}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="ho-so-trong">
                                    Ứng viên chưa nộp CV cho tin tuyển dụng nào.
                                </p>
                            )}
                        </div>

                        <h5 className="ho-so-muc-tieu-de">Tiêu chí tìm việc</h5>
                        <form className="form-sample">
                            <div className="row">
                                <div className="col-md-6">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Lĩnh vực
                                        </label>
                                        <div className="col-sm-9 mt-3">
                                            <Select
                                                allowClear
                                                style={{
                                                    width: "100%",
                                                }}
                                                placeholder="Chọn lĩnh vực"
                                                disabled
                                                options={dataJobType}
                                                value={inputValues.jobType}
                                            ></Select>
                                        </div>
                                    </div>
                                </div>
                                <div className="col-md-6">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Mức lương
                                        </label>
                                        <div className="col-sm-9 mt-3">
                                            <Select
                                                allowClear
                                                style={{
                                                    width: "100%",
                                                }}
                                                placeholder="Chọn mức lương"
                                                disabled
                                                options={dataSalary}
                                                value={inputValues.salary}
                                            ></Select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-12">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Kĩ năng
                                        </label>
                                        <div
                                            className="col-sm-9 mt-3"
                                            style={{ marginLeft: "-115px" }}
                                        >
                                            <Select
                                                disabled
                                                mode="multiple"
                                                allowClear
                                                style={{
                                                    width: "calc(100% + 115px)",
                                                }}
                                                placeholder="Chọn kĩ năng của bạn"
                                                options={listSkills}
                                                value={inputValues.skills}
                                            ></Select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-6">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Khu vực làm việc
                                        </label>
                                        <div className="col-sm-9 mt-3">
                                            <Select
                                                allowClear
                                                style={{
                                                    width: "100%",
                                                }}
                                                placeholder="Chọn nơi làm việc"
                                                disabled
                                                options={dataProvince}
                                                value={inputValues.jobProvince}
                                            ></Select>
                                        </div>
                                    </div>
                                </div>
                                <div className="col-md-6">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Kinh nghiệm làm việc
                                        </label>
                                        <div className="col-sm-9 mt-3">
                                            <Select
                                                allowClear
                                                style={{
                                                    width: "100%",
                                                }}
                                                placeholder="Chọn khoảng kinh nghiệm"
                                                disabled
                                                options={dataExp}
                                                value={inputValues.exp}
                                            ></Select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {inputValues.file && (
                                <div className="col-md-12">
                                    <div className="form-group row">
                                        <div>
                                            <PdfPreviewButton key={scope} source={inputValues.file} fileName={`CV-ung-vien-${id}.pdf`} label="Xem CV của ứng viên" />
                                            <p className="mt-2">Đây là CV hiện tại trong hồ sơ tìm việc của ứng viên.</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DetailFilterUser;
