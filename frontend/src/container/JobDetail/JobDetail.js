import React from "react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import SendCvModal from "../../components/modal/SendCvModal";
import {
    getDetailPostByIdService,
    toggleFavoritePostService,
    checkFavoritePostService,
    getRelatedPostService,
} from "../../service/userService";
import { Link } from "react-router-dom";
import moment from "moment";
import CommonUtils from "../../util/CommonUtils";
const JobDetail = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [isActiveModal, setAcitveModal] = useState(false);
    const [dataPost, setDataPost] = useState({});
    const [isFavorite, setIsFavorite] = useState(false);
    const [relatedPost, setRelatedPost] = useState([]);
    useEffect(() => {
        if (id) {
            fetchPost(id);
            fetchRelatedPost(id);
            const userData = JSON.parse(localStorage.getItem("userData"));
            if (userData) {
                fetchCheckFavorite(id, userData.id);
            }
        }
        window.scrollTo(0, 0);
    }, [id]);

    let fetchPost = async (id) => {
        let res = await getDetailPostByIdService(id);
        if (res && res.errCode === 0) {
            setDataPost(res.data);
        }
    };

    let fetchRelatedPost = async (id) => {
        let res = await getRelatedPostService({ postId: id, limit: 5 });
        if (res && res.errCode === 0) {
            setRelatedPost(res.data);
        }
    };

    let fetchCheckFavorite = async (postId, userId) => {
        let res = await checkFavoritePostService({ postId, userId });
        if (res && res.errCode === 0) {
            setIsFavorite(res.isFavorite);
        }
    };

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
            if (userData) setAcitveModal(true);
            else {
                toast.error("Xin hãy đăng nhập để có thể thực hiện nộp CV");
                setTimeout(() => {
                    localStorage.setItem("lastUrl", window.location.href);
                    navigate("/login");
                }, 1000);
            }
        } else toast.error("Hạn ứng tuyển đã hết");
    };
    return (
        <>
            {/* <div id="preloader-active">
        <div className="preloader d-flex align-items-center justify-content-center">
            <div className="preloader-inner position-relative">
                <div className="preloader-circle"></div>
                <div className="preloader-img pere-text">
                    <img src="assets/img/logo/logo.png" alt="">
                </div>
            </div>
        </div>
    </div>
    <!-- Preloader Start --> */}
            {dataPost.companyData && (
                <main>
                    <div className="slider-area ">
                        <div
                            className="single-slider slider-height2 d-flex align-items-center"
                            style={{
                                backgroundImage: `url(${dataPost.companyData.coverimage})`,
                            }}
                        >
                            <div className="container">
                                <div className="row">
                                    <div className="col-xl-12">
                                        <div className="hero-cap text-center"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="job-post-company pt-120 pb-120">
                        <div className="container">
                            <div className="row justify-content-between">
                                <div className="col-xl-7 col-lg-8">
                                    <div className="single-job-items mb-30">
                                        <div className="job-items">
                                            <div className="company-img company-img-details">
                                                <img
                                                    src={
                                                        dataPost.companyData
                                                            .thumbnail
                                                    }
                                                    alt="Ảnh bị lỗi"
                                                    width={100}
                                                    height={100}
                                                />
                                            </div>
                                            <div className="job-tittle">
                                                <h4>
                                                    {
                                                        dataPost.postDetailData
                                                            .name
                                                    }
                                                </h4>

                                                <ul>
                                                    <li>
                                                        {
                                                            dataPost
                                                                .postDetailData
                                                                .workTypePostData
                                                                .value
                                                        }
                                                    </li>
                                                    <li>
                                                        <i className="fas fa-map-marker-alt"></i>
                                                        {
                                                            dataPost
                                                                .postDetailData
                                                                .provincePostData
                                                                .value
                                                        }
                                                    </li>
                                                    <li>
                                                        {
                                                            dataPost
                                                                .postDetailData
                                                                .salaryTypePostData
                                                                .value
                                                        }
                                                    </li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>

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
                                            {relatedPost.map((item, index) => {
                                                return (
                                                    <Link
                                                        key={index}
                                                        to={`/detail-job/${item.id}`}
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
                                        <div
                                            className="btn"
                                            onClick={() => handleOpenModal()}
                                        >
                                            Ứng tuyển ngay
                                        </div>
                                        <div
                                            className="btn"
                                            style={{
                                                marginLeft: "10px",
                                                background: isFavorite
                                                    ? "#fff"
                                                    : "",
                                                color: isFavorite
                                                    ? "#fb246a"
                                                    : "",
                                                border: "1px solid #fb246a",
                                            }}
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
                                                style={{ marginRight: "6px" }}
                                            ></i>
                                            {isFavorite
                                                ? "Đã lưu tin"
                                                : "Lưu tin"}
                                        </div>
                                        <div
                                            className="btn"
                                            style={{
                                                marginTop: "10px",
                                                background: "#fff",
                                                color: "#1c86ee",
                                                border: "1px solid #1c86ee",
                                                display: "block",
                                            }}
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
                                            <i
                                                className="far fa-comment-dots"
                                                style={{ marginRight: "6px" }}
                                            ></i>
                                            Nhắn tin cho nhà tuyển dụng
                                        </div>
                                    </div>
                                    <div className="post-details4  mb-50">
                                        <div className="small-section-tittle">
                                            <h4>Thông tin công ty</h4>
                                        </div>
                                        <span>
                                            Tên công ty :{" "}
                                            {dataPost.companyData.name}
                                        </span>
                                        <ul>
                                            <li>
                                                Website :{" "}
                                                <span>
                                                    {
                                                        dataPost.companyData
                                                            .website
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Địa chỉ :{" "}
                                                <span>
                                                    {
                                                        dataPost.companyData
                                                            .address
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Điện thoại :{" "}
                                                <span>
                                                    {
                                                        dataPost.companyData
                                                            .phonenumber
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Mã số thuế :{" "}
                                                <span>
                                                    {
                                                        dataPost.companyData
                                                            .taxnumber
                                                    }
                                                </span>
                                            </li>
                                            <li>
                                                Số nhân viên:{" "}
                                                <span>
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
            )}
        </>
    );
};

export default JobDetail;
