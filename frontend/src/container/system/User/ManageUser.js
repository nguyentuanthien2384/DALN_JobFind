import useListLoading from '../useListLoading';
import StableList from '../../../components/common/StableList';
import React from "react";
import { useEffect, useState } from "react";
import useListQuery, { clampListPage } from "../../../util/useListQuery";
import {
    getAllUsers,
    BanUserService,
    UnbanUserService,
} from "../../../service/userService";
import moment from "moment";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import CommonUtils from "../../../util/CommonUtils";
import { Input, Modal } from "antd";
import {
    DEFAULT_PAGE_SIZE, FilterSelect, ListFooter, ListTitle, ListToolbar, normalizePageSize, pageForSize,
} from "../List/AdminList";

const ROLE_OPTIONS = [
    { value: "", label: "Tất cả vai trò" },
    { value: "ADMIN", label: "Quản trị" },
    { value: "COMPANY", label: "Công ty" },
    { value: "EMPLOYER", label: "Người tuyển dụng" },
    { value: "CANDIDATE", label: "Ứng viên" },
];
// Ngay sinh trong CSDL co ba dang: mili-giay, "YYYY-MM-DD" va "DD/MM/YYYY".
const BIRTH_FORMATS = [[/^\d+$/, value => moment(Number(value))], [/^\d{4}-\d{2}-\d{2}/, value => moment(value, "YYYY-MM-DD")],
    [/^\d{2}\/\d{2}\/\d{4}$/, value => moment(value, "DD/MM/YYYY", true)]];
export const formatBirthDate = (dob) => {
    const text = String(dob ?? "").trim();
    const parse = BIRTH_FORMATS.find(([pattern]) => pattern.test(text))?.[1];
    const date = parse ? parse(text) : null;
    return date && date.isValid() ? date.format("DD/MM/YYYY") : "Không có thông tin";
};

const STATUS_OPTIONS = [
    { value: "", label: "Tất cả trạng thái" },
    { value: "S1", label: "Đã kích hoạt" },
    { value: "S2", label: "Không kích hoạt" },
];

const ManageUser = () => {
    const [user] = useState(() => JSON.parse(localStorage.getItem("userData")) || {});
    const [dataUser, setdataUser] = useState([]);
    const [query, setQuery] = useListQuery({ page: 0, search: "", role: "", status: "", size: DEFAULT_PAGE_SIZE });
    const { page: numberPage, search, role, status } = query;
    const pageSize = normalizePageSize(query.size);
    const [refresh, setRefresh] = useState(0);
    const [total, setTotal] = useState(0);

    const [loading, setLoading] = useListLoading(JSON.stringify([numberPage, search, role, status, pageSize, refresh]));
    useEffect(() => {
        let active = true;
        setLoading(true);
        getAllUsers({ limit: pageSize, offset: numberPage * pageSize,
            search: CommonUtils.removeSpace(search), roleCode: role, statusCode: status }).then(res => {
            if (!active) return;
            if (res?.errCode !== 0) throw new Error();
            const page = clampListPage(numberPage, res.count, pageSize);
            setTotal(res.count);
            if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
            setdataUser(res.data);
        }).catch(() => { if (active) { setdataUser([]); setTotal(0); toast.error("Không tải được danh sách người dùng"); } })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [numberPage, search, role, status, pageSize, refresh, setQuery, setLoading]);

    const toggleUser = async (item) => {
        const res = item.statusCode === "S1"
            ? await BanUserService(item.userAccountData.id)
            : await UnbanUserService(item.userAccountData.id);
        if (res && res.errCode === 0) {
            toast.success(res.errMessage);
            setRefresh(value => value + 1);
        } else {
            toast.error(res?.errMessage || "Không cập nhật được trạng thái tài khoản");
        }
    };
    // Chan tai khoan la thao tac dang ke (nguoi dung bi dang xuat): hoi lai truoc.
    const handlebanUser = (event, item) => {
        event.preventDefault();
        if (item.statusCode !== "S1") { toggleUser(item); return; }
        const name = `${item.userAccountData.firstName} ${item.userAccountData.lastName}`.trim();
        Modal.confirm({
            title: `Chặn tài khoản ${name || item.phonenumber}?`,
            content: "Người dùng sẽ không đăng nhập được cho tới khi được kích hoạt lại.",
            okText: "Chặn tài khoản",
            okButtonProps: { danger: true },
            cancelText: "Hủy",
            onOk: () => toggleUser(item),
        });
    };
    const handleSearch = (value) => setQuery({ search: CommonUtils.removeSpace(value), page: 0 });
    const filtered = Boolean(search || role || status);

    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <ListTitle title="Danh sách người dùng" total={loading && !total ? null : total}
                            description="Tài khoản ứng viên, nhà tuyển dụng và quản trị viên; mới tạo hiển thị trước." />
                        <ListToolbar canReset={filtered} onReset={() => setQuery({ search: "", role: "", status: "", page: 0 })}>
                            <Input.Search
                                key={search}
                                defaultValue={search}
                                onSearch={handleSearch}
                                placeholder="Tìm theo họ tên, số điện thoại hoặc email"
                                allowClear
                                enterButton="Tìm kiếm"
                            />
                            <FilterSelect label="Vai trò" name="role" value={role} options={ROLE_OPTIONS}
                                onChange={value => setQuery({ role: value, page: 0 })} />
                            <FilterSelect label="Trạng thái" name="status" value={status} options={STATUS_OPTIONS}
                                onChange={value => setQuery({ status: value, page: 0 })} />
                        </ListToolbar>

                        <StableList busy={loading} resetKey={JSON.stringify([search, role, status, pageSize])}><div className="table-responsive">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>STT</th>
                                        <th>Họ và tên</th>
                                        <th>Số điện thoại</th>
                                        <th>Giới tính</th>
                                        <th>Ngày sinh</th>
                                        <th>Vai trò</th>
                                        <th>Trạng thái</th>
                                        <th>Ngày tạo</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataUser.map((item, index) => {
                                        const account = item.userAccountData || {};
                                        const date = formatBirthDate(account.dob);
                                        return (
                                            <tr key={item.id ?? index}>
                                                <td>{index + 1 + numberPage * pageSize}</td>
                                                <td>
                                                    {`${account.firstName} ${account.lastName}`}
                                                    {account.email && <span className="jf-cell-sub">{account.email}</span>}
                                                </td>
                                                <td>{item.phonenumber}</td>
                                                <td>{account.genderData?.value}</td>
                                                <td>{date}</td>
                                                <td>{item.roleData?.value}</td>
                                                <td>
                                                    <label className={item.statusCode === "S1" ? "badge badge-success" : "badge badge-danger"}>
                                                        {item.statusAccountData?.value}
                                                    </label>
                                                </td>
                                                <td>{item.createdAt ? moment(item.createdAt).format("DD/MM/YYYY") : "—"}</td>
                                                <td>
                                                    <span className="jf-row-actions">
                                                        <Link to={`/admin/edit-user/${account.id}/`}>Sửa</Link>
                                                        {String(user.id) !== String(item.id) && (
                                                            <button type="button" className="btn btn-link p-0"
                                                                onClick={(event) => handlebanUser(event, item)}>
                                                                {item.statusCode === "S1" ? "Chặn" : "Kích hoạt"}
                                                            </button>
                                                        )}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {dataUser.length === 0 && (
                                <div className="jf-table__empty">
                                    {loading ? "Đang tải dữ liệu…" : filtered ? "Không có người dùng khớp bộ lọc" : "Không có dữ liệu"}
                                </div>
                            )}
                        </div></StableList>
                        <ListFooter page={numberPage} pageSize={pageSize} total={total}
                            onPageChange={page => setQuery({ page })}
                            onPageSizeChange={size => setQuery({ size, page: pageForSize(numberPage, pageSize, size) })} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageUser;
