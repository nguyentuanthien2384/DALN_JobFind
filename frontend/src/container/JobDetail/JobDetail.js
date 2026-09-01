import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import SendCvModal from "../../components/modal/SendCvModal";
import { toggleFavoritePostService } from "../../service/userService";
import moment from "moment";
import CommonUtils from "../../util/CommonUtils";
import { hasPermission, PERMISSIONS } from "../../auth/accessControl";
import { readJsonStorage } from "../../util/storage";
import {
    getCachedJobDetail,
    loadFavoriteState,
    loadJobDetail,
    loadRelatedJobs,
    prefetchJobDetail,
} from "./jobDetailResource";

const JobDetailSkeleton = () => (
    <div className="job-detail-skeleton" role="status" aria-label="Đang tải chi tiết công việc">
        <div className="job-detail-cover" aria-hidden="true">
            <div className="container">
                <div className="cover-wrapper job-detail-skeleton__surface" />
                <div className="job-detail-overview job-detail-skeleton__overview">
                    <div className="job-logo">
                        <div className="job-image-logo job-detail-skeleton__surface" />
                    </div>
                    <div className="job-info job-detail-skeleton__info">
                        <span className="job-detail-skeleton__surface job-detail-skeleton__line job-detail-skeleton__line--title" />
                        <span className="job-detail-skeleton__surface job-detail-skeleton__line job-detail-skeleton__line--company" />
                        <span className="job-detail-skeleton__surface job-detail-skeleton__line job-detail-skeleton__line--meta" />
                    </div>
                </div>
            </div>
        </div>
        <div className="job-post-company pb-120" aria-hidden="true">
            <div className="container">
                <div className="row justify-content-between">
                    <div className="col-xl-7 col-lg-8">
                        <div className="job-post-details job-detail-skeleton__content-card">
                            <span className="job-detail-skeleton__surface job-detail-skeleton__line job-detail-skeleton__line--heading" />
                            {[100, 92, 96, 78, 88, 64].map((width) => (
                                <span
                                    key={width}
                                    className="job-detail-skeleton__surface job-detail-skeleton__line"
                                    style={{ width: `${width}%` }}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="col-xl-4 col-lg-4">
                        <div className="post-details3 mb-50 job-detail-skeleton__side-card">
                            <span className="job-detail-skeleton__surface job-detail-skeleton__line job-detail-skeleton__line--heading" />
                            {[82, 94, 76, 88, 70].map((width) => (
                                <span
                                    key={width}
                                    className="job-detail-skeleton__surface job-detail-skeleton__line"
                                    style={{ width: `${width}%` }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <span className="job-detail-skeleton__label">Đang tải thông tin công việc…</span>
    </div>
);

const JobDetail = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [isActiveModal, setAcitveModal] = useState(false);
    const [detailState, setDetailState] = useState(() => {
        const cachedData = getCachedJobDetail(id);
        return { data: cachedData, isLoading: !cachedData, hasError: false };
    });
    const [isFavorite, setIsFavorite] = useState(false);
    const [relatedPost, setRelatedPost] = useState([]);
    const preparedJobIdRef = useRef(id);
    const scrolledJobIdRef = useRef(null);
    const dataPost = detailState.data;
    const currentUser = readJsonStorage("userData");
    // Khach van thay CTA de duoc dua toi trang dang nhap. Sau khi dang nhap,
    // cac thao tac tren trang viec lam chi danh cho CANDIDATE.
    const canApply = !currentUser || hasPermission(currentUser, PERMISSIONS.APPLY_TO_JOB);
    const canSocialInteract = !currentUser || hasPermission(currentUser, PERMISSIONS.SOCIAL_INTERACT);
    const canStartChat = canSocialInteract;
    const currentUserId = currentUser?.id;
    const shouldCheckFavorite = Boolean(
        currentUserId && hasPermission(currentUser, PERMISSIONS.SOCIAL_INTERACT)
    );

    // Đặt lại vị trí cuộn và khung tải trước khi trình duyệt vẽ frame mới.
    // Nhờ vậy người dùng không nhìn thấy trang cũ rồi mới bị kéo lên đầu trang.
    useLayoutEffect(() => {
        if (preparedJobIdRef.current !== id) {
            const cachedData = getCachedJobDetail(id);
            preparedJobIdRef.current = id;
            setDetailState({ data: cachedData, isLoading: !cachedData, hasError: false });
            setRelatedPost([]);
            setIsFavorite(false);
            setAcitveModal(false);
        }

        if (scrolledJobIdRef.current !== id) {
            window.scrollTo(0, 0);
            scrolledJobIdRef.current = id;
        }
    }, [id]);

    useEffect(() => {
        if (!id) return undefined;

        let active = true;

        loadJobDetail(id)
            .then((res) => {
                if (!active) return;
                if (res?.errCode === 0 && res.data?.companyData) {
                    setDetailState({ data: res.data, isLoading: false, hasError: false });
                } else {
                    setDetailState({ data: null, isLoading: false, hasError: true });
                }
            })
            .catch(() => {
                if (active) setDetailState({ data: null, isLoading: false, hasError: true });
            });

        loadRelatedJobs(id)
            .then((res) => {
                if (active && res?.errCode === 0) setRelatedPost(res.data || []);
            })
            .catch(() => {
                if (active) setRelatedPost([]);
            });

        if (shouldCheckFavorite) {
            loadFavoriteState(id, currentUserId)
                .then((res) => {
                    if (active && res?.errCode === 0) setIsFavorite(Boolean(res.isFavorite));
                })
                .catch(() => {
                    if (active) setIsFavorite(false);
                });
        }

        return () => {
            active = false;
        };
    }, [id, currentUserId, shouldCheckFavorite]);

    const handleToggleFavorite = async () => {
        const userData = JSON.parse(localStorage.getItem("userData"));
        if (!userData) {
            toast.error("Xin hãy đăng nhập để có thể lưu tin tuyển dụng");
            setTimeout(() => {
                localStorage.setItem("lastUrl", window.location.href);
                navigate("/login");
            }, 1000);
            return;
        }
        if (!hasPermission(userData, PERMISSIONS.SOCIAL_INTERACT)) {
            toast.error("Chỉ ứng viên mới có thể lưu tin tuyển dụng");
            return;
        }
        let res = await toggleFavoritePostService({
            userId: userData.id,
            postId: id,
        });
        if (res && res.errCode === 0) {
            setIsFavorite(res.isFavorite);
            toast.success(res.errMessage);
        } else {
            toast.error(res && res.errMessage ? res.errMessage : "Có lỗi xảy ra");
        }
    };

    const handleOpenModal = () => {
        if (dataPost.timeEnd && CommonUtils.formatDate(dataPost.timeEnd) > 0) {
            const userData = JSON.parse(localStorage.getItem("userData"));
            if (userData && hasPermission(userData, PERMISSIONS.APPLY_TO_JOB)) setAcitveModal(true);
            else if (userData) {
                toast.error("Chỉ ứng viên mới có thể nộp CV");
            }
            else {
                toast.error("Xin hãy đăng nhập để có thể thực hiện nộp CV");
                setTimeout(() => {
                    localStorage.setItem("lastUrl", window.location.href);
                    navigate("/login");
                }, 1000);
            }
        } else toast.error("Hạn ứng tuyển đã hết");
    };

    if (!dataPost?.companyData) {
        return (
            <main
                className="job-detail-page"
                aria-busy={detailState.isLoading ? "true" : "false"}
            >
                {detailState.hasError ? (
                    <div className="container job-detail-error" role="alert">
                        <i className="fas fa-exclamation-circle" aria-hidden="true" />
                        <h1>Không thể tải thông tin công việc</h1>
                        <p>Vui lòng kiểm tra kết nối và thử tải lại trang.</p>
                        <button type="button" onClick={() => window.location.reload()}>
                            Thử lại
                        </button>
                    </div>
                ) : (
                    <JobDetailSkeleton />
                )}
            </main>
        );
    }

    return (
        <main className="job-detail-page" aria-busy="false">
                    {/* Header dung chung kieu voi trang chi tiet cong ty:
                        anh bia chieu cao co dinh + thanh trang co logo dat de len anh bia. */}
                    <div className="job-detail-cover">
                        <div className="container">
                            <div className="cover-wrapper">
                                <img
                                    src={dataPost.companyData.coverimage}
                                    alt=""
                                    className="cover-img"
                                    width="1140"
                                    height="236"
                                    decoding="async"
                                />
                            </div>
                            <div className="job-detail-overview">
                                <div className="job-logo">
                                    <div className="job-image-logo">
                                        <img
                                            src={dataPost.companyData.thumbnail}
                                            alt={dataPost.companyData.name}
                                            width="140"
                                            height="140"
                                            decoding="async"
                                        />
                                    </div>
                                </div>
                                <div className="job-info">
                                    <h1 className="job-detail-name">
                                        {dataPost.postDetailData.name}
                                    </h1>
                                    <Link
                                        to={`/detail-company/${dataPost.companyData.id}`}
                                        className="job-company-name"
                                    >
                                        <i className="far fa-building"></i>
                                        {dataPost.companyData.name}
                                    </Link>
                                    <div className="job-meta">
                                        <span>
                                            <i className="far fa-clock"></i>
                                            {
                                                dataPost.postDetailData
                                                    .workTypePostData.value
                                            }
                                        </span>
                                        <span>
                                            <i className="fas fa-map-marker-alt"></i>
                                            {
                                                dataPost.postDetailData
                                                    .provincePostData.value
                                            }
                                        </span>
                                        <span>
                                            <i className="fas fa-money-bill-wave"></i>
                                            {
                                                dataPost.postDetailData
                                                    .salaryTypePostData.value
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="job-post-company pb-120">
                        <div className="container">
                            <div className="row justify-content-between">
                                <div className="col-xl-7 col-lg-8">

                                    <div className="job-post-details">
                                        <div className="post-details1 mb-50">
                                            <div className="small-section-tittle">
                                                <h4>Mô tả công việc</h4>
                                            </div>
                                        </div>
                                        <div
                                            dangerouslySetInnerHTML={{
                                                __html: dataPost.postDetailData
                                                    .descriptionHTML,
                                            }}
                                        />
                                    </div>

                                    {relatedPost && relatedPost.length > 0 && (
                                        <div className="job-post-details">
                                            <div className="post-details1 mb-50">
                                                <div className="small-section-tittle">
                                                    <h4>Việc làm tương tự</h4>
                                                </div>
                                            </div>
                                            {relatedPost.map((item) => {
                                                return (
                                                    <Link
                                                        key={item.id}
                                                        to={`/detail-job/${item.id}`}
                                                        onMouseEnter={() => prefetchJobDetail(item.id)}
                                                        onFocus={() => prefetchJobDetail(item.id)}
                                                        onTouchStart={() => prefetchJobDetail(item.id)}
                                                        style={{
                                                            display: "flex",
                                                            alignItems:
                                                                "center",
                                                            gap: "15px",
                                                            padding: "12px",
                                                            border: "1px solid #eee",
                                                            borderRadius:
                                                                "8px",
                                                            marginBottom:
                                                                "12px",
                                                            color: "inherit",
                                                        }}
                                                    >
                                                        <img
                                                            src={
                                                                item
                                                                    .userPostData
                                                                    .userCompanyData
                                                                    .thumbnail
                                                            }
                                                            alt=""
                                                            width="60"
                                                            height="60"
                                                            loading="lazy"
                                                            decoding="async"
                                                            style={{
                                                                width: "60px",
                                                                height: "60px",
                                                                objectFit:
                                                                    "cover",
                                                                borderRadius:
                                                                    "6px",
                                                            }}
                                                        />
                                                        <div>
                                                            <h6
                                                                style={{
                                                                    marginBottom:
                                                                        "4px",
                                                                }}
                                                            >
                                                                {
                                                                    item
                                                                        .postDetailData
                                                                        .name
                                                                }
                                                            </h6>
                                                            <div
                                                                style={{
                                                                    fontSize:
                                                                        "13px",
                                                                    color: "#666",
                                                                }}
                                                            >
                                                                {
                                                                    item
                                                                        .userPostData
                                                                        .userCompanyData
                                                                        .name
                                                                }
                                                                {" · "}
                                                                {
                                                                    item
                                                                        .postDetailData
                                                                        .provincePostData
                                                                        .value
                                                                }
                                                                {" · "}
                                                                {
                                                                    item
                                                                        .postDetailData
                                                                        .salaryTypePostData
                                                                        .value
                                                                }
                                                            </div>
                                                        </div>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="col-xl-4 col-lg-4">
                                    <div className="post-details3  mb-50">
                                        <div className="small-section-tittle">
                                            <h4>Thông tin công việc</h4>
                                        </div>
                                        <ul>
                                            <li>
                                                Lĩnh vực :{" "}
                                                <span>
                                                    {
                                                        dataPost.postDetailData
                                                            .jobTypePostData
                                                            .value
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Nơi làm việc :{" "}
                                                <span>
                                                    {
                                                        dataPost.postDetailData
                                                            .provincePostData
                                                            .value
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Hình thức làm việc :{" "}
                                                <span>
                                                    {
                                                        dataPost.postDetailData
                                                            .workTypePostData
                                                            .value
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Kinh nghiệm:{" "}
                                                <span>
                                                    {
                                                        dataPost.postDetailData
                                                            .expTypePostData
                                                            .value
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Lương :{" "}
                                                <span>
                                                    {
                                                        dataPost.postDetailData
                                                            .salaryTypePostData
                                                            .value
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Hạn nộp :{" "}
                                                <span>
                                                    {moment
                                                        .unix(
                                                            dataPost.timeEnd /
                                                                1000
                                                        )
                                                        .format("DD/MM/YYYY")}
                                                </span>
                                            </li>
                                        </ul>
                                        <div className="job-actions">
                                            {canApply && <button
                                                type="button"
                                                className="job-action-btn job-action-btn--primary"
                                                onClick={() => handleOpenModal()}
                                            >
                                                <i className="far fa-paper-plane"></i>
                                                Ứng tuyển ngay
                                            </button>}
                                            {canSocialInteract && <button
                                                type="button"
                                                className={
                                                    "job-action-btn job-action-btn--secondary" +
                                                    (isFavorite ? " is-active" : "")
                                                }
                                                onClick={() =>
                                                    handleToggleFavorite()
                                                }
                                            >
                                                <i
                                                    className={
                                                        isFavorite
                                                            ? "fas fa-heart"
                                                            : "far fa-heart"
                                                    }
                                                ></i>
                                                {isFavorite
                                                    ? "Đã lưu tin"
                                                    : "Lưu tin"}
                                            </button>}
                                            {canStartChat && <button
                                                type="button"
                                                className="job-action-btn job-action-btn--ghost"
                                                onClick={() => {
                                                    const userData = JSON.parse(
                                                        localStorage.getItem(
                                                            "userData"
                                                        )
                                                    );
                                                    if (!userData) {
                                                        toast.error(
                                                            "Xin hãy đăng nhập để nhắn tin với nhà tuyển dụng"
                                                        );
                                                        setTimeout(() => {
                                                            localStorage.setItem(
                                                                "lastUrl",
                                                                window.location
                                                                    .href
                                                            );
                                                            navigate("/login");
                                                        }, 1000);
                                                        return;
                                                    }
                                                    if (
                                                        +userData.id ===
                                                        +dataPost.userId
                                                    ) {
                                                        toast.error(
                                                            "Đây là tin đăng của bạn"
                                                        );
                                                        return;
                                                    }
                                                    navigate(
                                                        `/chat/${dataPost.userId}`
                                                    );
                                                }}
                                            >
                                                <i className="far fa-comment-dots"></i>
                                                Nhắn tin cho nhà tuyển dụng
                                            </button>}
                                        </div>
                                    </div>
                                    <div className="post-details3 company-details-card mb-50">
                                        <div className="small-section-tittle">
                                            <h4>Thông tin công ty</h4>
                                        </div>
                                        <ul className="company-details-list">
                                            <li>
                                                <span className="company-details-label">
                                                    Tên công ty :
                                                </span>
                                                <span className="company-details-value">
                                                    {dataPost.companyData.name}
                                                </span>
                                            </li>
                                            <li>
                                                <span className="company-details-label">
                                                    Website :
                                                </span>
                                                <span className="company-details-value">
                                                    {
                                                        dataPost.companyData
                                                            .website
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                <span className="company-details-label">
                                                    Địa chỉ :
                                                </span>
                                                <span className="company-details-value">
                                                    {
                                                        dataPost.companyData
                                                            .address
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                <span className="company-details-label">
                                                    Điện thoại :
                                                </span>
                                                <span className="company-details-value">
                                                    {
                                                        dataPost.companyData
                                                            .phonenumber
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                <span className="company-details-label">
                                                    Mã số thuế :
                                                </span>
                                                <span className="company-details-value">
                                                    {
                                                        dataPost.companyData
                                                            .taxnumber
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                <span className="company-details-label">
                                                    Số nhân viên :
                                                </span>
                                                <span className="company-details-value">
                                                    {
                                                        dataPost.companyData
                                                            .amountEmployer
                                                    }
                                                </span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* <!-- job post company End --> */}
                    <SendCvModal
                        isOpen={isActiveModal}
                        onHide={() => setAcitveModal(false)}
                        postId={id}
                    />
        </main>
    );
};

export default JobDetail;
