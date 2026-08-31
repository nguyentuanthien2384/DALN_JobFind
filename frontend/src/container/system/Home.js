import React from "react";
import { useEffect, useRef, useState } from "react";
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
const Home = () => {
    const { RangePicker } = DatePicker;
    const today = new Date();
    const yyyy = today.getFullYear();
    let mm = today.getMonth() + 1; // Months start at 0!
    let dd = today.getDate();
    if (dd < 10) dd = "0" + dd;
    if (mm < 10) mm = "0" + mm;
    const formattedToday = yyyy + "-" + mm + "-" + dd;
    const [user, setUser] = useState({});
    const [dataStatisticalTypePost, setDataStatisticalTypePost] = useState([]);
    const [dataStatisticalPackagePost, setDataStatisticalPackagePost] =
        useState([]);
    const [dataStatisticalPackageCv, setDataStatisticalPackageCv] = useState(
        []
    );
    const [dataSum, setDataSum] = useState(0);
    const [dataSumCv, setDataSumCv] = useState(0);

    const [dataCv, setDataCv] = useState([]);
    const [count, setCount] = useState(0);
    const [countCv, setCountCv] = useState(0);

    // Bo loc dang ap dung cua tung bang (khoang ngay + trang dang xem).
    //
    // Truoc day cac tham so nay nam rai rac trong tung ham, thieu truoc hut sau:
    // khoang ngay cua bang CV khong duoc luu vao state nen chon xong roi chuyen
    // trang la mat; toDate cua hai bang doanh thu khong bao gio duoc ghi lai nen
    // xuat Excel luon lay den hom nay du dang xem khoang khac. Gom lai mot cho
    // vua sua duoc may loi do, vua de tu dong cap nhat tai lai DUNG nhung gi
    // nguoi dung dang xem thay vi nhay ve "hom nay, trang 1".
    const locMacDinh = {
        fromDate: formattedToday,
        toDate: formattedToday,
        page: 0,
    };
    const [locCv, setLocCv] = useState(locMacDinh); // bang so luong CV (cong ty)
    const [locPost, setLocPost] = useState(locMacDinh); // doanh thu goi bai dang (admin)
    const [locPkgCv, setLocPkgCv] = useState(locMacDinh); // doanh thu goi xem UV (admin)

    let taiBangCv = async (loc, companyId) => {
        let arrData = await getStatisticalCv({
            limit: PAGINATION.pagerow,
            offset: loc.page * PAGINATION.pagerow,
            fromDate: loc.fromDate,
            toDate: loc.toDate,
            companyId,
        });
        if (arrData && arrData.errCode === 0) {
            setDataCv(arrData.data);
            setCount(Math.ceil(arrData.count / PAGINATION.pagerow));
        }
    };

    let taiBangGoiBaiDang = async (loc) => {
        let arrData = await getStatisticalPackagePost({
            fromDate: loc.fromDate,
            toDate: loc.toDate,
            limit: PAGINATION.pagerow,
            offset: loc.page * PAGINATION.pagerow,
        });
        if (arrData && arrData.errCode === 0) {
            setDataStatisticalPackagePost(arrData.data);
            setDataSum(arrData.sum);
            setCount(Math.ceil(arrData.count / PAGINATION.pagerow));
        }
    };

    let taiBangGoiXemUngVien = async (loc) => {
        let arrData = await getStatisticalPackageCv({
            fromDate: loc.fromDate,
            toDate: loc.toDate,
            limit: PAGINATION.pagerow,
            offset: loc.page * PAGINATION.pagerow,
        });
        if (arrData && arrData.errCode === 0) {
            setDataStatisticalPackageCv(arrData.data);
            setDataSumCv(arrData.sum);
            setCountCv(Math.ceil(arrData.count / PAGINATION.pagerow));
        }
    };

    let onDatePicker = async (values, type = "") => {
        let fromDate = formattedToday;
        let toDate = formattedToday;
        if (values) {
            fromDate = values[0].format("YYYY-MM-DD");
            toDate = values[1].format("YYYY-MM-DD");
        }
        // Doi khoang ngay thi ve trang 1: so trang cua khoang moi thuong it hon,
        // giu nguyen trang cu de dang o trang khong con du lieu.
        let loc = { fromDate, toDate, page: 0 };
        if (user.roleCode !== "ADMIN") {
            setLocCv(loc);
            await taiBangCv(loc, user.companyId);
        } else if (type === "packagePost") {
            setLocPost(loc);
            await taiBangGoiBaiDang(loc);
        } else {
            setLocPkgCv(loc);
            await taiBangGoiXemUngVien(loc);
        }
    };
    let handleChangePage = async (number, type = "") => {
        if (user.roleCode !== "ADMIN") {
            let loc = { ...locCv, page: number.selected };
            setLocCv(loc);
            await taiBangCv(loc, user.companyId);
        } else if (type === "packagePost") {
            let loc = { ...locPost, page: number.selected };
            setLocPost(loc);
            await taiBangGoiBaiDang(loc);
        } else {
            let loc = { ...locPkgCv, page: number.selected };
            setLocPkgCv(loc);
            await taiBangGoiXemUngVien(loc);
        }
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
        let res = await getStatisticalTypePost(limit);
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
            daBaoLoiBieuDo.current = false;
        } else if (!daBaoLoiBieuDo.current) {
            daBaoLoiBieuDo.current = true;
            // API tra ve truong 'errMessage'; truoc doc nham 'message' nen khi loi
            // chi hien mot toast trong. Van giu 'message' de phong truong hop cu.
            toast.error(
                res.errMessage || res.message || "Không tải được biểu đồ thống kê"
            );
        }
    };

    // Tai lai toan bo so lieu dang hien tren man hinh, giu nguyen bo loc.
    // Doc vai tro tu localStorage chu khong tu state `user`: lan chay dau tien
    // xay ra ngay khi mo trang, luc do setUser chua kip co hieu luc.
    const taiTatCaThongKe = async () => {
        const userData = JSON.parse(localStorage.getItem("userData"));
        if (!userData) return;
        await getData(4);
        if (userData.roleCode !== "ADMIN") {
            if (userData.companyId) await taiBangCv(locCv, userData.companyId);
        } else {
            await taiBangGoiBaiDang(locPost);
            await taiBangGoiXemUngVien(locPkgCv);
        }
    };

    // Truoc day trang nay chi goi API dung mot lan luc mo, so lieu dung yen cho
    // toi khi bam F5. Hook nay tai lai khi backend bao co du lieu moi (socket),
    // dinh ky phong khi socket khong ket noi duoc, va khi quay lai tab.
    const { capNhatLuc, dangTai, lamMoi } = useAutoRefresh(taiTatCaThongKe);

    useEffect(() => {
        setUser(JSON.parse(localStorage.getItem("userData")) || {});
        lamMoi();
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
            <div className="row">
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
                <div
                    style={{ width: "300px", height: "300px" }}
                    className="col-md-8"
                >
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
            </div>
            {user.companyId && (
                <div className="col-12 grid-margin">
                    <div className="card">
                        <div className="card-body">
                            <h4 className="card-title">
                                Bảng thông kê số lượng CV
                            </h4>
                            <RangePicker
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
                            previousLabel={"Quay lại"}
                            nextLabel={"Tiếp"}
                            breakLabel={"..."}
                            pageCount={Math.max(1, Number(count) || 0)}
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
                                <RangePicker
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
                                previousLabel={"Quay lại"}
                                nextLabel={"Tiếp"}
                                breakLabel={"..."}
                                pageCount={Math.max(1, Number(count) || 0)}
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
                                <RangePicker
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
                                previousLabel={"Quay lại"}
                                nextLabel={"Tiếp"}
                                breakLabel={"..."}
                                pageCount={Math.max(1, Number(countCv) || 0)}
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
