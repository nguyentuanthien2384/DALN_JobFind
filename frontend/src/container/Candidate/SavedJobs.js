import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { formatJobTime, jobLabel } from '../../util/jobLocale';
import ReactPaginate from "react-paginate";
import {
    getFavoritePostByUserService,
    toggleFavoritePostService,
} from "../../service/userService";
import CommonUtils from "../../util/CommonUtils";
import useListQuery, { clampListPage } from '../../util/useListQuery';
import StableList from '../../components/common/StableList';
import useReferenceDataRevision from '../../util/useReferenceDataRevision';

const SavedJobs = () => {
    const [dataFavorite, setDataFavorite] = useState([]);
    const [count, setCount] = useState(0);
    const [{ page: numberPage }, setQuery] = useListQuery({ page: 0 });
    const [refresh, setRefresh] = useState(0);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [settledRequest, setSettledRequest] = useState('');
    const referenceRevision = useReferenceDataRevision();
    const requestKey = JSON.stringify([numberPage, refresh, referenceRevision]);
    const busy = loading || settledRequest !== requestKey;
    const [userData] = useState(() => JSON.parse(localStorage.getItem("userData")));

    useEffect(() => {
        let active = true;
        if (!userData) { setLoading(false); setSettledRequest(requestKey); return; }
        setError(''); setLoading(true);
        (async () => {
            try {
                const res = await getFavoritePostByUserService({ userId: userData.id, limit: 10, offset: numberPage * 10 });
                if (!active) return;
                if (res?.errCode !== 0) throw Error();
                const validPage = clampListPage(numberPage, res.count, 10);
                if (validPage !== numberPage) { setQuery({ page: validPage }, { replace: true }); return; }
                setDataFavorite(res.data); setCount(Math.ceil(res.count / 10));
            } catch { if (active) { setDataFavorite([]); setError('Không tải được việc làm đã lưu. Vui lòng tải lại.'); } }
            finally { if (active) { setLoading(false); setSettledRequest(requestKey); } }
        })();
        return () => { active = false; };
    }, [userData, numberPage, refresh, requestKey, setQuery]);

    const handleChangePage = number => setQuery({ page: number.selected });

    const handleUnsave = async (postId) => {
        let res = await toggleFavoritePostService({
            userId: userData.id,
            postId: postId,
        });
        if (res && res.errCode === 0) {
            toast.success(res.errMessage);
            setRefresh(value => value + 1);
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
                    <StableList busy={busy} resetKey={userData?.id} label="Đang tải việc làm đã lưu…">
                    {error && <p role="alert">{error}</p>}
                    {dataFavorite && dataFavorite.length > 0 ? (
                        dataFavorite.map((item, index) => {
                            const post = item.postFavoriteData;
                            const isExpired =
                                CommonUtils.formatDate(post.timeEnd) <= 0;
                            return (
                                <div
                                    key={index}
                                    className="saved-job"
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
                                    <div className="saved-job__details">
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
                                            {jobLabel(post.postDetailData.salaryTypePostData)}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: "12px",
                                                marginTop: "4px",
                                            }}
                                        >
                                            <span style={{ color: "#999" }}>
                                                Đã lưu{" "}
                                                {formatJobTime(item.createdAt)}
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
                    ) : !busy && !error ? (
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
                    ) : null}
                    </StableList>
                    {count > 1 && (
                        <ReactPaginate
                            forcePage={numberPage}
                            previousLabel={"Quay lại"}
                            nextLabel={"Tiếp"}
                            breakLabel={"..."}
                            pageCount={Math.max(numberPage + 1, count)}
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
