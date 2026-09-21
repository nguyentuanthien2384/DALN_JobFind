import React from "react";
import { useEffect, useState } from "react";
import useListQuery, { clampListPage } from "../../../util/useListQuery";
import {
    getAllUsers,
    BanUserService,
    UnbanUserService,
} from "../../../service/userService";
import moment from "moment";
import { PAGINATION } from "../../../util/constant";
import ReactPaginate from "react-paginate";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import CommonUtils from "../../../util/CommonUtils";
import { Input } from "antd";

const ManageUser = () => {
    const [user] = useState(() => JSON.parse(localStorage.getItem("userData")) || {});
    const [dataUser, setdataUser] = useState([]);
    const [count, setCount] = useState(0);
    const [{ page: numberPage, search }, setQuery] = useListQuery({ page: 0, search: "" });
    const [refresh, setRefresh] = useState(0);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        let active = true;
        setdataUser([]);
        getAllUsers({ limit: PAGINATION.pagerow, offset: numberPage * PAGINATION.pagerow,
            search: CommonUtils.removeSpace(search) }).then(res => {
            if (!active || res?.errCode !== 0) return;
            const page = clampListPage(numberPage, res.count, PAGINATION.pagerow);
            setCount(Math.ceil(res.count / PAGINATION.pagerow)); setTotal(res.count);
            if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
            setdataUser(res.data);
        }).catch(() => { if (active) toast.error("Không tải được danh sách người dùng"); });
        return () => { active = false; };
    }, [numberPage, search, refresh, setQuery]);
    const handleChangePage = number => setQuery({ page: number.selected });
    let handlebanUser = async (event, item) => {
        event.preventDefault();
        let res = {};
            if (item.statusCode === "S1") {
            res = await BanUserService(item.userAccountData.id);
        } else {
            res = await UnbanUserService(item.userAccountData.id);
        }
        if (res && res.errCode === 0) {
            toast.success(res.errMessage);
            setRefresh(value => value + 1);
        } else {
            toast.error(res.errMessage);
        }
    };
    const handleSearch = (value) => {
        setQuery({ search: value, page: 0 });
    };
    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <h4 className="card-title">Danh sách người dùng</h4>
                        <Input.Search
                            key={search}
                            defaultValue={search}
                            onSearch={handleSearch}
                            className="mt-5 mb-5"
                            placeholder="Nhập tên hoặc số điện thoại"
                            allowClear
                            enterButton="Tìm kiếm"
                        ></Input.Search>
                        <div>Số lượng người dùng: {total}</div>

                        <div className="table-responsive pt-2">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>STT</th>
                                        <th>Họ và Tên</th>
                                        <th>Số điện thoại</th>
                                        <th>Giới tính</th>
                                        <th>Ngày sinh</th>
                                        <th>Quyền</th>
                                        <th>Trạng thái</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataUser &&
                                        dataUser.length > 0 &&
                                        dataUser.map((item, index) => {
                                            let date = item.userAccountData.dob
                                                ? moment
                                                      .unix(
                                                          item.userAccountData
                                                              .dob / 1000
                                                      )
                                                      .format("DD/MM/YYYY")
                                                : "Không có thông tin";
                                            return (
                                                <tr key={index}>
                                                    <td>
                                                        {index +
                                                            1 +
                                                            numberPage *
                                                                PAGINATION.pagerow}
                                                    </td>
                                                    <td>{`${item.userAccountData.firstName} ${item.userAccountData.lastName}`}</td>
                                                    <td>{item.phonenumber}</td>
                                                    <td>
                                                        {
                                                            item.userAccountData
                                                                .genderData
                                                                .value
                                                        }
                                                    </td>
                                                    <td>{date}</td>
                                                    <td>
                                                        {item.roleData.value}
                                                    </td>
                                                    <td>
                                                        <label
                                                            className={
                                                                item.statusCode ===
                                                                "S1"
                                                                    ? "badge badge-success"
                                                                    : "badge badge-danger"
                                                            }
                                                        >
                                                            {
                                                                item
                                                                    .statusAccountData
                                                                    .value
                                                            }
                                                        </label>
                                                    </td>
                                                    <td>
                                                        <Link
                                                            style={{
                                                                color: "#4B49AC",
                                                            }}
                                                            to={`/admin/edit-user/${item.userAccountData.id}/`}
                                                        >
                                                            Sửa
                                                        </Link>
                                                        &nbsp; &nbsp;
                                                            {String(user.id) !== String(item.id) && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-link p-0"
                                                                style={{
                                                                    color: "#4B49AC",
                                                                }}
                                                                onClick={(
                                                                    event
                                                                ) =>
                                                                    handlebanUser(
                                                                        event,
                                                                        item
                                                                    )
                                                                }
                                                            >
                                                                {item.statusCode ===
                                                                "S1"
                                                                    ? "Chặn"
                                                                    : "Kích hoạt"}
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                            {dataUser && dataUser.length === 0 && (
                                <div style={{ textAlign: "center" }}>
                                    Không có dữ liệu
                                </div>
                            )}
                        </div>
                    </div>
                    {count > 0 && <ReactPaginate
                        forcePage={Math.min(numberPage, count - 1)}
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
                        previousLinkClassName={"page-link"}
                        previousClassName={"page-item"}
                        nextClassName={"page-item"}
                        nextLinkClassName={"page-link"}
                        breakLinkClassName={"page-link"}
                        breakClassName={"page-item"}
                        activeClassName={"active"}
                        onPageChange={handleChangePage}
                    />}
                </div>
            </div>
        </div>
    );
};

export default ManageUser;
