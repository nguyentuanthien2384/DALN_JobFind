import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import useListQuery, { clampListPage } from "../../util/useListQuery";
import { toast } from "react-toastify";
import {
    getStatisticalTypePost,
    getStatisticalPackagePost,
    getStatisticalPackageCv,
} from "../../service/userService";
import { getStatisticalCv } from "../../service/cvService";
import { PAGINATION } from "../../util/constant";
import { PieChart } from "react-minimal-pie-chart";
import ReactPaginate from "react-paginate";
import { DatePicker } from "antd";
import CommonUtils from "../../util/CommonUtils";
import useAutoRefresh from "../../util/useAutoRefresh";
import AutoRefreshInfo from "./AutoRefreshInfo";
const useStatisticsQuery = (defaults, prefix) => {
    const [savedQuery, setQuery] = useListQuery(defaults, { prefix, persistDefaults: ['fromDate', 'toDate'] });
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid() && dayjs(value).format('YYYY-MM-DD') === value;
    const validRange = validDate(savedQuery.fromDate) && validDate(savedQuery.toDate) && savedQuery.fromDate <= savedQuery.toDate;
    const { fromDate, toDate } = defaults;
    useEffect(() => {
        if (!validRange) setQuery({ fromDate, toDate }, { replace: true });
    }, [validRange, fromDate, toDate, setQuery]);
    return [validRange ? savedQuery : { ...savedQuery, fromDate, toDate }, setQuery];
};

// Each table owns its request sequence so a slow response cannot replace a
// newer page, including requests made by dashboard auto-refresh.
const useStatisticsTable = (query, setQuery, service, enabled, companyId) => {
    const [result, setResult] = useState({ data: [], count: 0, sum: 0 });
    const [failure, setFailure] = useState(null);
    const sequence = useRef(0);
    const key = JSON.stringify([query.page, query.fromDate, query.toDate, enabled, companyId]);
    const currentKey = useRef(key);
    currentKey.current = key;
    const reload = useCallback(async () => {
        if (!enabled) return;
        const request = ++sequence.current;
        setFailure(null);
        try {
            const response = await service({
                limit: PAGINATION.pagerow,
                offset: query.page * PAGINATION.pagerow,
                fromDate: query.fromDate,
                toDate: query.toDate,
                ...(companyId ? { companyId } : {}),
            });
            if (request !== sequence.current || currentKey.current !== key) return;
            if (response?.errCode !== 0) throw Error('statistics-unavailable');
            const page = clampListPage(query.page, response.count, PAGINATION.pagerow);
            if (page !== query.page) {
                setQuery({ page }, { replace: true });
                return;
            }
            setResult({ key, data: response.data || [], count: Math.ceil(response.count / PAGINATION.pagerow), sum: response.sum || 0 });
        } catch {
            if (request === sequence.current && currentKey.current === key) {
                setFailure({ key, message: 'Không tải được dữ liệu thống kê. Vui lòng thử Làm mới.' });
            }
        }
    }, [query.page, query.fromDate, query.toDate, enabled, companyId, service, setQuery, key]);
    useEffect(() => {
        reload();
        return () => { sequence.current += 1; };
    }, [reload]);
    // Same-query refreshes may show the last good result; a new page/date never
    // displays rows belonging to a previous query, even if its request fails.
    return {
        ...(result.key === key ? result : { data: [], count: 0, sum: 0 }),
        error: failure?.key === key ? failure.message : '',
        reload,
    };
};

const Home = () => {
    const { RangePicker } = DatePicker;
    const today = new Date();
    const yyyy = today.getFullYear();
    let mm = today.getMonth() + 1; // Months start at 0!
    let dd = today.getDate();
    if (dd < 10) dd = "0" + dd;
    if (mm < 10) mm = "0" + mm;
    const formattedToday = yyyy + "-" + mm + "-" + dd;
    const [user] = useState(() => JSON.parse(localStorage.getItem("userData")) || {});
    const [dataStatisticalTypePost, setDataStatisticalTypePost] = useState([]);
    const [chartError, setChartError] = useState('');
    const defaults = { fromDate: formattedToday, toDate: formattedToday, page: 0 };
    const [locCv, setLocCv] = useStatisticsQuery(defaults, 'cv.');
    const [locPost, setLocPost] = useStatisticsQuery(defaults, 'post.');
    const [locPkgCv, setLocPkgCv] = useStatisticsQuery(defaults, 'packageCv.');
    const cvTable = useStatisticsTable(locCv, setLocCv, getStatisticalCv, Boolean(user.companyId) && user.roleCode !== 'ADMIN', user.companyId);
    const postTable = useStatisticsTable(locPost, setLocPost, getStatisticalPackagePost, user.roleCode === 'ADMIN');
    const packageCvTable = useStatisticsTable(locPkgCv, setLocPkgCv, getStatisticalPackageCv, user.roleCode === 'ADMIN');
    const { data: dataCv } = cvTable;
    const { data: dataStatisticalPackagePost, sum: dataSum } = postTable;
    const { data: dataStatisticalPackageCv, sum: dataSumCv } = packageCvTable;

    const onDatePicker = (values, type = "") => {
        const fromDate = values?.[0]?.format("YYYY-MM-DD") || formattedToday;
        const toDate = values?.[1]?.format("YYYY-MM-DD") || formattedToday;
        const [query, update] = user.roleCode !== "ADMIN" ? [locCv, setLocCv]
            : type === "packagePost" ? [locPost, setLocPost] : [locPkgCv, setLocPkgCv];
        if (fromDate !== query.fromDate || toDate !== query.toDate) update({ fromDate, toDate, page: 0 });
    };
    const handleChangePage = ({ selected }, type = "") => {
        const update = user.roleCode !== "ADMIN" ? setLocCv
            : type === "packagePost" ? setLocPost : setLocPkgCv;
        update({ page: selected });
    };
    let handleOnClickExport = async (type) => {
        let res = [];
        // Xuat theo dung khoang ngay dang xem tren man hinh.
        let loc = type === "packagePost" ? locPost : locPkgCv;
        if (type === "packagePost") {
            res = await getStatisticalPackagePost({
                fromDate: loc.fromDate,
                toDate: loc.toDate,
                limit: "",
                offset: "",
            });
        } else {
            res = await getStatisticalPackageCv({
                fromDate: loc.fromDate,
                toDate: loc.toDate,
                limit: "",
                offset: "",
            });
        }
        if (res.errCode === 0) {
            let formatData = res.data.map((item) => {
                let obj = {
                    "Mã gói": item.id,
                    "Tên gói": item.name,
                    "Loại gói":
                        item.isHot === 1 ? "Loại nổi bật" : "Loại bình thường",
                    "Số lượng": +item.count,
                    Tổng: +item.total + "USD",
                };
                if (type !== "packagePost") delete obj["Loại gói"];
                return obj;
            });
            if (type === "packagePost") {
                await CommonUtils.exportExcel(
                    formatData,
                    "Statistical Package Post",
                    "Statistical Package Post"
                );
            } else {
                await CommonUtils.exportExcel(
                    formatData,
                    "Statistical Package Candiate",
                    "Statistical Package Candiate"
                );
            }
        }
    };

    // Tu dong cap nhat chay lien tuc nen neu API loi keo dai se do toast lien
    // tuc 30 giay mot cai. Chi bao MOT lan, tai lai duoc thi mo khoa de lan sau
    // hong nua van con bao.
    const daBaoLoiBieuDo = useRef(false);

    const getData = async (limit) => {
        let res;
        try {
            res = await getStatisticalTypePost(limit);
        } catch {
            res = { errCode: -1 };
        }
        if (!res) res = { errCode: -1 };
        let other = res.totalPost;
        let otherPercent = 100;
        let color = ["red", "yellow", "green", "blue", "orange"];
        if (res.errCode === 0) {
            let newdata = res.data.map((item, index) => {
                other -= item.amount;
                otherPercent -=
                    Math.round((item.amount / res.totalPost) * 100 * 100) / 100;
                return {
                    title: item.postDetailData.jobTypePostData.value,
                    value:
                        Math.round((item.amount / res.totalPost) * 100 * 100) /
                        100,
                    color: color[index],
                    amount: item.amount,
                };
            });
            if (other > 0) {
                newdata.push({
                    title: "Lĩnh vực khác",
                    value: Math.round(otherPercent * 100) / 100,
                    color: color[4],
                    amount: other,
                });
            }
            setDataStatisticalTypePost(newdata);
            setChartError('');
            daBaoLoiBieuDo.current = false;
        } else {
            const message = res.errMessage && res.errMessage !== 'Error from server'
                ? res.errMessage : res.message || 'Không tải được biểu đồ thống kê. Vui lòng thử Làm mới.';
            setChartError(message);
            if (!daBaoLoiBieuDo.current) {
                daBaoLoiBieuDo.current = true;
                toast.error(message);
            }
        }
    };

    const taiTatCaThongKe = async () => {
        await Promise.all([getData(4), cvTable.reload(), postTable.reload(), packageCvTable.reload()]);
    };
    const { capNhatLuc, dangTai, lamMoi } = useAutoRefresh(taiTatCaThongKe);

    useEffect(() => {
        getData(4);
        // Table effects separately load the restored URL filters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <>
            <div className="row">
                <div className="col-md-12 grid-margin">
                    <div className="row">
                        <div className="col-12 col-xl-8 mb-4 mb-xl-0">
                            <h3 className="font-weight-bold">
                                Xin chào {user.firstName + " " + user.lastName}
                            </h3>
                            <h3
                                style={{ textTransform: "uppercase" }}
                                className="font-weight-normal mb-0"
                            >
                                Biểu đồ thống kê top lĩnh vực
                            </h3>
                            <AutoRefreshInfo
                                capNhatLuc={capNhatLuc}
                                dangTai={dangTai}
                                onLamMoi={lamMoi}
                            />
                        </div>
                    </div>
                </div>
            </div>
            {chartError && <div className="jf-admin__chart-state" role="status">{chartError}</div>}
            {dataStatisticalTypePost.length > 0 ? <div className="row jf-admin__chart">
                <div className="col-md-4">
                    {dataStatisticalTypePost.map((item, index) => {
                        return (
                            <div key={index} style={{ marginBottom: "10px" }}>
                                <div
                                    style={{
                                        width: "50px",
                                        backgroundColor: item.color,
                                        height: "20px",
                                    }}
                                ></div>
                                <span>
                                    {item.title}: {item.amount} bài
                                </span>
                            </div>
                        );
                    })}
                </div>
                <div className="col-md-8 jf-admin__chart-canvas">
                    <PieChart
                        label={({ x, y, dx, dy, dataEntry }) => (
                            <text
                                x={x - 5}
                                y={y}
                                dx={dx}
                                dy={dy}
                                dominantBaseline="central"
                                textAnchor="middle"
                                style={{ fontSize: "4px" }}
                            >
                                {`${dataEntry.value}%`}
                            </text>
                        )}
                        data={dataStatisticalTypePost}
                    />
                </div>
            </div> : !chartError && <div className="jf-admin__chart-state" role="status">
                {dangTai ? 'Đang tải biểu đồ thống kê...' : 'Chưa có dữ liệu thống kê lĩnh vực.'}
            </div>}
            {user.companyId && (
                <div className="jf-admin__statistics">
                    <div className="card">
                        <div className="card-body">
                            <h4 className="card-title">
                                Bảng thông kê số lượng CV
                            </h4>
                            {cvTable.error && <p role="alert">{cvTable.error}</p>}
                            <RangePicker
                                value={[dayjs(locCv.fromDate), dayjs(locCv.toDate)]}
                                onChange={(values) => onDatePicker(values)}
                            ></RangePicker>
                            <div className="table-responsive pt-2">
                                <table className="table table-bordered">
                                    <thead>
                                        <tr>
                                            <th>STT</th>
                                            <th>Tên bài viết</th>
                                            <th>Mã bài viết</th>
                                            <th>Người viết</th>
                                            <th>Số lượng CV</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {dataCv &&
                                            dataCv.length > 0 &&
                                            dataCv.map((item, index) => {
                                                return (
                                                    <tr key={index}>
                                                        <td>
                                                            {index +
                                                                1 +
                                                                locCv.page *
                                                                    PAGINATION.pagerow}
                                                        </td>
                                                        <td>
                                                            {
                                                                item
                                                                    .postDetailData
                                                                    .name
                                                            }
                                                        </td>
                                                        <td>{item.id}</td>
                                                        <td>
                                                            {item.userPostData
                                                                .firstName +
                                                                " " +
                                                                item
                                                                    .userPostData
                                                                    .lastName}
                                                        </td>
                                                        <td>{item.total}</td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            {dataCv && dataCv.length === 0 && (
                                    <div style={{ textAlign: "center" }}>
                                        Không có dữ liệu
                                    </div>
                                )}
                            </div>
                        </div>
                        <ReactPaginate
                            disableInitialCallback
                            previousLabel={"Quay lại"}
                            nextLabel={"Tiếp"}
                            breakLabel={"..."}
                            pageCount={Math.max(1, cvTable.count, locCv.page + 1)}
                            marginPagesDisplayed={3}
                            containerClassName={
                                "pagination justify-content-center pb-3"
                            }
                            pageClassName={"page-item"}
                            pageLinkClassName={"page-link"}
                            previousLinkClassName={"page-link"}
                            previousClassName={"page-item"}
                            nextClassName={"page-item"}
                            nextLinkClassName={"page-link"}
                            breakLinkClassName={"page-link"}
                            breakClassName={"page-item"}
                            activeClassName={"active"}
                            forcePage={locCv.page}
                            onPageChange={(number) => handleChangePage(number)}
                        />
                    </div>
                </div>
            )}
            {user.roleCode === "ADMIN" && (
                <>
                    <div className="col-12 grid-margin">
                        <div className="card">
                            <div className="card-body">
                                <h4 className="card-title">
                                    Bảng thống kê doanh thu các gói bài đăng
                                </h4>
                                <button
                                    style={{ float: "right" }}
                                    onClick={() =>
                                        handleOnClickExport("packagePost")
                                    }
                                >
                                    Xuất excel{" "}
                                    <i className="fa-solid fa-file-excel"></i>
                                </button>
                                {postTable.error && <p role="alert">{postTable.error}</p>}
                                <RangePicker
                                    value={[dayjs(locPost.fromDate), dayjs(locPost.toDate)]}
                                    onChange={(values) =>
                                        onDatePicker(values, "packagePost")
                                    }
                                    format={"DD/MM/YYYY"}
                                ></RangePicker>

                                <div className="table-responsive pt-2">
                                    <table className="table table-bordered">
                                        <thead>
                                            <tr>
                                                <th>STT</th>
                                                <th>Tên gói</th>
                                                <th>Mã gói</th>
                                                <th>Loại gói</th>
                                                <th>Số lượng đã bán</th>
                                                <th>Doanh thu</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dataStatisticalPackagePost &&
                                                dataStatisticalPackagePost.length >
                                                    0 &&
                                                dataStatisticalPackagePost.map(
                                                    (item, index) => {
                                                        return (
                                                            <tr key={index}>
                                                                <td>
                                                                    {index +
                                                                        1 +
                                                                        locPost.page *
                                                                            PAGINATION.pagerow}
                                                                </td>
                                                                <td>
                                                                    {item.name}
                                                                </td>
                                                                <td>
                                                                    {item.id}
                                                                </td>
                                                                <td>
                                                                    {item.isHot ===
                                                                    0
                                                                        ? "Loại bình thường"
                                                                        : "Loại nổi bật"}
                                                                </td>
                                                                <td>
                                                                    {item.count}
                                                                </td>
                                                                <td
                                                                    style={{
                                                                        textAlign:
                                                                            "right",
                                                                    }}
                                                                >
                                                                    {item.total}{" "}
                                                                    USD
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                )}
                                        </tbody>
                                    </table>
                                    {dataStatisticalPackagePost &&
                                        dataStatisticalPackagePost.length ===
                                            0 && (
                                            <div
                                                style={{ textAlign: "center" }}
                                            >
                                                Không có dữ liệu
                                            </div>
                                        )}
                                </div>
                            </div>
                            {dataStatisticalPackagePost &&
                                dataStatisticalPackagePost.length > 0 && (
                                    <div
                                        className="mr-4"
                                        style={{
                                            display: "flex",
                                            justifyContent: "end",
                                        }}
                                    >
                                        Tổng doanh thu: {dataSum} USD
                                    </div>
                                )}
                            <ReactPaginate
                                disableInitialCallback
                            previousLabel={"Quay lại"}
                                nextLabel={"Tiếp"}
                                breakLabel={"..."}
                                pageCount={Math.max(1, postTable.count, locPost.page + 1)}
                                marginPagesDisplayed={3}
                                containerClassName={
                                    "pagination justify-content-center pb-3"
                                }
                                pageClassName={"page-item"}
                                pageLinkClassName={"page-link"}
                                previousLinkClassName={"page-link"}
                                previousClassName={"page-item"}
                                nextClassName={"page-item"}
                                nextLinkClassName={"page-link"}
                                breakLinkClassName={"page-link"}
                                breakClassName={"page-item"}
                                activeClassName={"active"}
                                forcePage={locPost.page}
                                onPageChange={(number) =>
                                    handleChangePage(number, "packagePost")
                                }
                            />
                        </div>
                    </div>
                    <div className="col-12 grid-margin">
                        <div className="card">
                            <div className="card-body">
                                <h4 className="card-title">
                                    Bảng thống kê doanh thu các gói mua lượt xem
                                    ứng viên
                                </h4>
                                <button
                                    style={{ float: "right" }}
                                    onClick={() =>
                                        handleOnClickExport("packageCv")
                                    }
                                >
                                    Xuất excel{" "}
                                    <i className="fa-solid fa-file-excel"></i>
                                </button>
                                {packageCvTable.error && <p role="alert">{packageCvTable.error}</p>}
                                <RangePicker
                                    value={[dayjs(locPkgCv.fromDate), dayjs(locPkgCv.toDate)]}
                                    onChange={(values) =>
                                        onDatePicker(values, "packageCv")
                                    }
                                    format={"DD/MM/YYYY"}
                                ></RangePicker>

                                <div className="table-responsive pt-2">
                                    <table className="table table-bordered">
                                        <thead>
                                            <tr>
                                                <th>STT</th>
                                                <th>Tên gói</th>
                                                <th>Mã gói</th>
                                                <th>Số lượng đã bán</th>
                                                <th>Doanh thu</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dataStatisticalPackageCv &&
                                                dataStatisticalPackageCv.length >
                                                    0 &&
                                                dataStatisticalPackageCv.map(
                                                    (item, index) => {
                                                        return (
                                                            <tr key={index}>
                                                                <td>
                                                                    {index +
                                                                        1 +
                                                                        locPkgCv.page *
                                                                            PAGINATION.pagerow}
                                                                </td>
                                                                <td>
                                                                    {item.name}
                                                                </td>
                                                                <td>
                                                                    {item.id}
                                                                </td>
                                                                <td>
                                                                    {item.count}
                                                                </td>
                                                                <td
                                                                    style={{
                                                                        textAlign:
                                                                            "right",
                                                                    }}
                                                                >
                                                                    {item.total}{" "}
                                                                    USD
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                )}
                                        </tbody>
                                    </table>
                                    {dataStatisticalPackageCv &&
                                        dataStatisticalPackageCv.length ===
                                            0 && (
                                            <div
                                                style={{ textAlign: "center" }}
                                            >
                                                Không có dữ liệu
                                            </div>
                                        )}
                                </div>
                            </div>
                            {dataStatisticalPackageCv &&
                                dataStatisticalPackageCv.length > 0 && (
                                    <div
                                        className="mr-4"
                                        style={{
                                            display: "flex",
                                            justifyContent: "end",
                                        }}
                                    >
                                        Tổng doanh thu: {dataSumCv} USD
                                    </div>
                                )}
                            <ReactPaginate
                                disableInitialCallback
                            previousLabel={"Quay lại"}
                                nextLabel={"Tiếp"}
                                breakLabel={"..."}
                                pageCount={Math.max(1, packageCvTable.count, locPkgCv.page + 1)}
                                marginPagesDisplayed={3}
                                containerClassName={
                                    "pagination justify-content-center pb-3"
                                }
                                pageClassName={"page-item"}
                                pageLinkClassName={"page-link"}
                                previousLinkClassName={"page-link"}
                                previousClassName={"page-item"}
                                nextClassName={"page-item"}
                                nextLinkClassName={"page-link"}
                                breakLinkClassName={"page-link"}
                                breakClassName={"page-item"}
                                activeClassName={"active"}
                                forcePage={locPkgCv.page}
                                onPageChange={(number) =>
                                    handleChangePage(number, "packageCv")
                                }
                            />
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default Home;
