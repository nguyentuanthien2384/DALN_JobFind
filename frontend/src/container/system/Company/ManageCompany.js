import useListLoading from '../useListLoading';
import StableList from '../../../components/common/StableList';
import React from 'react'
import { useEffect, useState } from 'react';
import { getAllCompany, accecptCompanyService, banCompanyService, unbanCompanyService } from '../../../service/userService';
import moment from 'moment';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import NoteModal from '../../../components/modal/NoteModal';
import { Modal, Input } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import CommonUtils from '../../../util/CommonUtils';
import useListQuery, { clampListPage } from '../../../util/useListQuery';
import { notifyAdminAttentionChanged } from '../adminEvents';
import {
    DEFAULT_PAGE_SIZE, FilterSelect, ListFooter, ListTitle, ListToolbar, normalizePageSize, pageForSize,
} from '../List/AdminList';
const { confirm } = Modal

const CENSOR_OPTIONS = [
    { value: '', label: 'Tất cả' },
    { value: 'CS1', label: 'Đã kiểm duyệt' },
    { value: 'CS2', label: 'Chưa kiểm duyệt' },
    { value: 'CS3', label: 'Đang chờ kiểm duyệt' },
]
const STATUS_OPTIONS = [
    { value: '', label: 'Tất cả' },
    { value: 'S1', label: 'Đang hoạt động' },
    { value: 'S2', label: 'Đã dừng hoạt động' },
]

const ManageCompany = () => {
    const [dataCompany, setdataCompany] = useState([])
    const [query, setQuery] = useListQuery({ page: 0, search: '', censorCode: '', status: '', size: DEFAULT_PAGE_SIZE })
    const { page: numberPage, search, censorCode, status } = query
    const pageSize = normalizePageSize(query.size)
    const [refresh, setRefresh] = useState(0)
    const [user, setUser] = useState({})
    const [propsModal, setPropsModal] = useState({
        isActive: false,
        handleCompany: () => { },
        id: ''
    })
    const [total, setTotal] = useState(0)

    const [loading, setLoading] = useListLoading(JSON.stringify([search, censorCode, status, numberPage, pageSize, refresh]));
    useEffect(() => {
        let active = true;
        setLoading(true);
        try {
            const userData = JSON.parse(localStorage.getItem('userData'));
            if (userData) {
                const fetchData = async () => {
                    const arrData = await getAllCompany({
                        limit: pageSize,
                        offset: numberPage * pageSize,
                        search: CommonUtils.removeSpace(search),
                        censorCode,
                        statusCode: status,
                    })
                    if (!active) return;
                    if (arrData?.errCode !== 0) throw new Error();
                    setTotal(arrData.count)
                    const page = clampListPage(numberPage, arrData.count, pageSize);
                    if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
                    setdataCompany(arrData.data)
                }
                fetchData().catch(() => { if (active) { setdataCompany([]); setTotal(0); toast.error('Không tải được danh sách công ty'); } })
                    .finally(() => { if (active) setLoading(false); });
                setUser(userData)
            } else { setdataCompany([]); setTotal(0); setLoading(false); }

        } catch (error) {
            setdataCompany([]); setTotal(0); setLoading(false);
        }

        return () => { active = false; };
    }, [search, censorCode, status, numberPage, pageSize, refresh, setQuery, setLoading])

    const afterChange = (res) => {
        if (res && res.errCode === 0) {
            setRefresh(value => value + 1);
            notifyAdminAttentionChanged();
            toast.success(res.errMessage)
        } else {
            toast.error(res?.errMessage)
        }
    }
    const handleBanCompany = async (id) => afterChange(await banCompanyService({ id }))
    const handleUnBanCompany = async (id) => afterChange(await unbanCompanyService({ id }))
    const handleAccecptCompany = async (id, note = 'null') => afterChange(await accecptCompanyService({ companyId: id, note }))

    const confirmPost = (id, type) => {
        const title = type === 'ban' ? `Bạn có chắc muốn dừng hoạt động công ty này` : (type === 'unban' ? `Bạn có chắc muốn mở lại hoạt động công ty này` : `Bạn có chắc muốn duyệt công ty này`)
        confirm({
            title: title,
            icon: <ExclamationCircleOutlined />,
            onOk() {
                if (type === 'accept') handleAccecptCompany(id)
                else if (type === 'ban') handleBanCompany(id)
                else handleUnBanCompany(id)
            },
            onCancel() {
            },
        });
    }
    const handleSearch = (value) => setQuery({ search: CommonUtils.removeSpace(value), page: 0 })
    const filtered = Boolean(search || censorCode || status)
    const openNote = (id) => setPropsModal({ isActive: true, handleCompany: handleAccecptCompany, id })

    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <ListTitle title="Danh sách công ty" total={loading && !total ? null : total}
                            description="Hồ sơ doanh nghiệp, trạng thái kiểm duyệt và hoạt động; cập nhật gần nhất hiển thị trước." />
                        <ListToolbar canReset={filtered} onReset={() => setQuery({ search: '', censorCode: '', status: '', page: 0 })}>
                            <Input.Search key={search} defaultValue={search} onSearch={handleSearch} placeholder="Nhập tên hoặc mã công ty" allowClear enterButton="Tìm kiếm" />
                            <FilterSelect label="Kiểm duyệt" name="censorCode" value={censorCode} options={CENSOR_OPTIONS}
                                onChange={value => setQuery({ censorCode: value, page: 0 })} />
                            <FilterSelect label="Hoạt động" name="status" value={status} options={STATUS_OPTIONS}
                                onChange={value => setQuery({ status: value, page: 0 })} />
                        </ListToolbar>

                        <StableList busy={loading} resetKey={JSON.stringify([search, censorCode, status, pageSize])}><div className="table-responsive">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>STT</th>
                                        <th>Công ty</th>
                                        <th>Số điện thoại</th>
                                        <th>Trạng thái</th>
                                        <th>Kiểm duyệt</th>
                                        <th>Ngày khởi tạo</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataCompany.map((item, index) => (
                                        <tr key={item.id ?? index}>
                                            <td>{index + 1 + numberPage * pageSize}</td>
                                            <td>
                                                {item.name}
                                                <span className="jf-cell-sub">Mã #{item.id}{item.taxnumber ? ` · MST ${item.taxnumber}` : ''}</span>
                                            </td>
                                            <td>{item.phonenumber}</td>
                                            <td><label className={item.statusCompanyData.code === 'S1' ? 'badge badge-success' : 'badge badge-danger'}>{item.statusCompanyData.value}</label></td>
                                            <td><label className={item.censorData.code === 'CS1' ? 'badge badge-success' : (item.censorData.code === 'CS3' ? 'badge badge-warning' : 'badge badge-danger')}>{item.censorData.value}</label></td>
                                            <td>{moment(item.createdAt).format('DD-MM-YYYY')}</td>
                                            <td>
                                                <span className="jf-row-actions">
                                                    {item.statusCompanyData.code === 'S1'
                                                        ? <button type="button" className="btn btn-link p-0" onClick={() => confirmPost(item.id, 'ban')}>Dừng kích hoạt</button>
                                                        : <button type="button" className="btn btn-link p-0" onClick={() => confirmPost(item.id, 'unban')}>Kích hoạt</button>}
                                                    <Link to={`/admin/edit-company-admin/${item.id}`}>{user?.roleCode === "ADMIN" ? 'Xem chi tiết' : 'Sửa'}</Link>
                                                    {item.censorData.code === 'CS3' && <>
                                                        <button type="button" className="btn btn-link p-0" onClick={() => confirmPost(item.id, 'accept')}>Duyệt</button>
                                                        <button type="button" className="btn btn-link p-0" onClick={() => openNote(item.id)}>Từ chối</button>
                                                    </>}
                                                    {item.censorData.code === 'CS1' &&
                                                        <button type="button" className="btn btn-link p-0" onClick={() => openNote(item.id)}>Chuyển về chờ duyệt</button>}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {dataCompany.length === 0 && (
                                <div className="jf-table__empty">
                                    {loading ? 'Đang tải dữ liệu…' : filtered ? 'Không có công ty khớp bộ lọc' : 'Không có dữ liệu'}
                                </div>
                            )}
                        </div></StableList>
                        <ListFooter page={numberPage} pageSize={pageSize} total={total}
                            onPageChange={page => setQuery({ page })}
                            onPageSizeChange={size => setQuery({ size, page: pageForSize(numberPage, pageSize, size) })} />
                    </div>
                </div>
            </div>
            <NoteModal isOpen={propsModal.isActive} onHide={() => setPropsModal({
                isActive: false,
                handleCompany: () => { },
                id: ''
            })} id={propsModal.id} handleFunc={propsModal.handleCompany} />
        </div >
    )
}

export default ManageCompany
