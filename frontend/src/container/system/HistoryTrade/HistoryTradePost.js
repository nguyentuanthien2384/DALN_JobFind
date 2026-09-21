import React from "react";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import useListQuery, { clampListPage } from "../../../util/useListQuery";
import { PAGINATION } from "../../../util/constant";
import ReactPaginate from "react-paginate";
import moment from "moment";
import { DatePicker } from "antd";
import CommonUtils from "../../../util/CommonUtils";
import { getHistoryTradePost } from "../../../service/userService";
const validDate = value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid() && dayjs(value).format('YYYY-MM-DD') === value);
const HistoryTradePost = () => {
    const { RangePicker } = DatePicker;
    const [user] = useState(() => JSON.parse(localStorage.getItem("userData")) || {});
    const [savedQuery, setQuery] = useListQuery({ page: 0, fromDate: "", toDate: "" });
    const validRange = validDate(savedQuery.fromDate) && validDate(savedQuery.toDate)
        && (!savedQuery.fromDate || !savedQuery.toDate || savedQuery.fromDate <= savedQuery.toDate);
    const query = validRange ? savedQuery : { ...savedQuery, fromDate: '', toDate: '' };
    useEffect(() => {
        if (!validRange) setQuery({ fromDate: '', toDate: '' }, { replace: true });
    }, [validRange, setQuery]);
    const [data, setData] = useState([]);
    const [count, setCount] = useState(0);
    const [error, setError] = useState("");
    const numberPage = query.page;

    useEffect(() => {
        let current = true;
        setError("");
        setData([]);
        const load = async () => {
            try {
                const result = await getHistoryTradePost({
                    limit: PAGINATION.pagerow,
                    offset: query.page * PAGINATION.pagerow,
                    fromDate: query.fromDate,
                    toDate: query.toDate,
                    companyId: user.companyId,
                });
                if (!current) return;
                if (!result || result.errCode !== 0) throw new Error('history-unavailable');
                const page = clampListPage(query.page, result.count, PAGINATION.pagerow);
                setCount(Math.ceil(result.count / PAGINATION.pagerow));
                if (page !== query.page) {
                    setQuery({ page }, { replace: true });
                    return;
                }
                setData(result.data || []);
            } catch {
                if (current) setError("Không tải được lịch sử thanh toán. Vui lòng thử lại.");
            }
        };
        load();
        return () => { current = false; };
    }, [query.page, query.fromDate, query.toDate, user.companyId, setQuery]);

    const onDatePicker = (values) => {
        const fromDate = values?.[0]?.format("YYYY-MM-DD") || "";
        const toDate = values?.[1]?.format("YYYY-MM-DD") || "";
        if (fromDate !== query.fromDate || toDate !== query.toDate) {
            setQuery({ fromDate, toDate, page: 0 });
        }
    };
    const handleChangePage = ({ selected }) => setQuery({ page: selected });
    let handleOnClickExport = async () => {
        let res = await getHistoryTradePost({
            companyId: user.companyId,
            limit: "",
            offset: "",
            fromDate: query.fromDate,
            toDate: query.toDate,
        });
        if (res.errCode === 0) {
            let formatData = res.data.map((item) => {
                let obj = {
                    "Tên gói": item.packageOrderData.name,
                    "Mã giao dịch": item.id,
                    "Loại gói":
                        item.packageOrderData.isHot === 0
                            ? "Loại bình thường"
                            : "Loại nổi bật",
                    "Số lượng mua": item.amount,
                    "Đơn giá": item.packageOrderData.price + " USD",
                    "Tên người mua":
                        item.userOrderData.firstName +
                        " " +
                        item.userOrderData.lastName,
                    "Thời gian mua": moment(item.createdAt).format(
                        "DD-MM-YYYY HH:mm:ss"
                    ),
                };
                return obj;
            });
            await CommonUtils.exportExcel(
                formatData,
                "History Trade Post",
                "History Trade Post"
            );
        }
    };

    return (
        <div className="col-12 grid-margin">
            <div className="card">
                <div className="card-body">
                    <h4 className="card-title">
                        Lịch sử thanh toán các gói bài đăng
                    </h4>
                    <button
                        style={{ float: "right" }}
                        onClick={() => handleOnClickExport()}
                    >
                        Xuất excel <i className="fa-solid fa-file-excel"></i>
                    </button>
                    <RangePicker
                        value={query.fromDate && query.toDate ? [dayjs(query.fromDate), dayjs(query.toDate)] : null}
                        onChange={onDatePicker}
                        format={"DD/MM/YYYY"}
                    ></RangePicker>

                    {error && <div role="alert">{error}</div>}
                    <div className="table-responsive pt-2">
                        <table className="table table-bordered">
                            <thead>
                                <tr>
                                    <th>STT</th>
                                    <th>Tên gói</th>
                                    <th>Mã giao dịch</th>
                                    <th>Loại gói</th>
                                    <th>Số lượng đã mua</th>
                                    <th>Đơn giá</th>
                                    <th>Người mua</th>
                                    <th>Thời gian mua</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data &&
                                    data.length > 0 &&
                                    data.map((item, index) => {
                                        return (
                                            <tr key={index}>
                                                <td>
                                                    {index +
                                                        1 +
                                                        numberPage *
                                                            PAGINATION.pagerow}
                                                </td>
                                                <td>
                                                    {item.packageOrderData.name}
                                                </td>
                                                <td>{item.id}</td>
                                                <td>
                                                    {item.packageOrderData
                                                        .isHot === 0
                                                        ? "Loại bình thường"
                                                        : "Loại nổi bật"}
                                                </td>
                                                <td>{item.amount}</td>
                                                <td
                                                    style={{
                                                        textAlign: "right",
                                                    }}
                                                >
                                                    {
                                                        item.packageOrderData
                                                            .price
                                                    }{" "}
                                                    USD
                                                </td>
                                                <td>
                                                    {item.userOrderData
                                                        .firstName +
                                                        " " +
                                                        item.userOrderData
                                                            .lastName}
                                                </td>
                                                <td>
                                                    {moment(
                                                        item.createdAt
                                                    ).format(
                                                        "DD-MM-YYYY HH:mm:ss"
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                            {data && data.length === 0 && (
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
                    pageCount={Math.max(1, count, query.page + 1)}
                    forcePage={query.page}
                    disableInitialCallback
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
                    onPageChange={handleChangePage}
                />
            </div>
        </div>
    );
};

export default HistoryTradePost;
