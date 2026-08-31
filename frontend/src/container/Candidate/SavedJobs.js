import React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import moment from "moment";
import ReactPaginate from "react-paginate";
import {
    getFavoritePostByUserService,
    toggleFavoritePostService,
} from "../../service/userService";
import CommonUtils from "../../util/CommonUtils";

const SavedJobs = () => {
    const [dataFavorite, setDataFavorite] = useState([]);
    const [count, setCount] = useState(0);
    const [numberPage, setNumberPage] = useState(0);
    const [userData] = useState(() => JSON.parse(localStorage.getItem("userData")));

    const fetchData = useCallback(async (page) => {
        let res = await getFavoritePostByUserService({
            userId: userData.id,
            limit: 10,
            offset: page * 10,
        });
        if (res && res.errCode === 0) {
            setDataFavorite(res.data);
            setCount(Math.ceil(res.count / 10));
        }
    }, [userData]);

    useEffect(() => {
        if (userData) {
            fetchData(0);
        }
    }, [fetchData, userData]);

    const handleChangePage = (number) => {
        setNumberPage(number.selected);
        fetchData(number.selected);
    };

    const handleUnsave = async (postId) => {
        let res = await toggleFavoritePostService({
            userId: userData.id,
            postId: postId,
        });
        if (res && res.errCode === 0) {
            toast.success(res.errMessage);
            fetchData(numberPage);
        } else {
            toast.error(res && res.errMessage ? res.errMessage : "Có lỗi xảy ra");
        }
    };

    return (
        <div className="col-12 grid-margin stretch-card">
            <div className="card">
                <div className="card-body">
                    <h4 className="card-title">
                        <i
                            className="fas fa-heart"
                            style={{ color: "#fb246a", marginRight: "8px" }}
                        ></i>
                        Việc làm đã lưu
                    </h4>
                    {dataFavorite && dataFavorite.length > 0 ? (
                        dataFavorite.map((item, index) => {
                            const post = item.postFavoriteData;
                            const isExpired =
                                CommonUtils.formatDate(post.timeEnd) <= 0;
                            return (
                                <div
                                    key={index}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "15px",
                                        padding: "15px",
                                        border: "1px solid #eee",
                                        borderRadius: "8px",
                                        marginBottom: "12px",
                                    }}
                                >
                                    <img
                                        src={
                                            post.userPostData.userCompanyData
                                                .thumbnail
                                        }
                                        alt=""
                                        style={{
                                            width: "70px",
                                            height: "70px",
                                            objectFit: "cover",
                                            borderRadius: "6px",
                                        }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <Link to={`/detail-job/${post.id}`}>
                                            <h5 style={{ marginBottom: "4px" }}>
                                                {post.postDetailData.name}
                                            </h5>
                                        </Link>
                                        <div
                                            style={{
                                                fontSize: "13px",
                                                color: "#666",
                                            }}
                                        >
                                            {
                                                post.userPostData
                                                    .userCompanyData.name
                                            }
                                            {" · "}
                                            {
                                                post.postDetailData
                                                    .provincePostData.value
                                            }
                                            {" · "}
                                            {
                                                post.postDetailData
                                                    .salaryTypePostData.value
                                            }
                                        </div>
                                        <div
                                            style={{
                                                fontSize: "12px",
                                                marginTop: "4px",
                                            }}
                                        >
                                            <span style={{ color: "#999" }}>
                                                Đã lưu{" "}
                                                {moment(
                                                    item.createdAt
                                                ).fromNow()}
                                            </span>
                                            {" · "}
                                            {isExpired ? (
                                                <span
                                                    style={{ color: "#dc3545" }}
                                                >
                                                    Hết hạn ứng tuyển
                                                </span>
                                            ) : (
                                                <span
                                                    style={{ color: "#28a745" }}
                                                >
                                                    Còn{" "}
                                                    {CommonUtils.formatDate(
                                                        post.timeEnd
                                                    )}{" "}
                                                    ngày để ứng tuyển
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-outline-danger btn-sm"
                                        onClick={() => handleUnsave(post.id)}
                                    >
                                        <i className="fas fa-heart-broken"></i>{" "}
                                        Bỏ lưu
                                    </button>
                                </div>
                            );
                        })
                    ) : (
                        <div
                            style={{
                                textAlign: "center",
                                color: "#999",
                                padding: "30px 0",
                            }}
                        >
                            Bạn chưa lưu tin tuyển dụng nào.{" "}
                            <Link to="/job">Tìm việc ngay</Link>
                        </div>
                    )}
                    {count > 1 && (
                        <ReactPaginate
                            previousLabel={"Quay lại"}
                            nextLabel={"Tiếp"}
                            breakLabel={"..."}
                            pageCount={count}
                            marginPagesDisplayed={3}
                            containerClassName={
                                "pagination justify-content-center pb-3"
                            }
                            pageClassName={"page-item"}
                            pageLinkClassName={"page-link"}
                            previousClassName={"page-item"}
                            previousLinkClassName={"page-link"}
                            nextClassName={"page-item"}
                            nextLinkClassName={"page-link"}
                            breakLinkClassName={"page-link"}
                            breakClassName={"page-item"}
                            activeClassName={"active"}
                            onPageChange={handleChangePage}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default SavedJobs;
