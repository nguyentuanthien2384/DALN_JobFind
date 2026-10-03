import StableList from '../../../components/common/StableList';
import React from 'react'

import { getAllPackageCv, setActiveTypePackageCv } from '../../../service/userService';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import useCatalogList from '../useCatalogList';
import { ListFooter, ListTitle, ListToolbar } from '../List/AdminList';
import {Input} from 'antd'
const ManagePackageCv = () => {
    const { rows: dataPackagePost, total, pageSize, filtered, resetFilters, handlePageSizeChange, loading, numberPage, search, searchDraft, setSearchDraft,
        handleChangePage, handleSearch, refresh } = useCatalogList(getAllPackageCv);
    let hanndleSetActivePackage = async (event,id, isActive) => {
        event.preventDefault();
        let res = await setActiveTypePackageCv({
            id: id,
            isActive: isActive
        })
        if (res && res.errCode === 0) {
            toast.success(res.errMessage)
            refresh();
        } else toast.error(res.errMessage)
    }
    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <ListTitle title="Danh sách các gói tìm ứng viên" total={loading && !total ? null : total} />
                        <ListToolbar canReset={filtered} onReset={resetFilters}>
                            <Input.Search value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={handleSearch} placeholder="Nhập tên gói" allowClear enterButton="Tìm kiếm" />
                        </ListToolbar>
                        <StableList busy={loading} resetKey={JSON.stringify([search, pageSize])}><div className="table-responsive pt-2">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>
                                            STT
                                        </th>
                                        <th>
                                            Tên gói
                                        </th>
                                        <th>
                                            Giá trị
                                        </th>
                                        <th>
                                            Giá tiền
                                        </th>
                                        <th>
                                            Trạng thái
                                        </th>
                                        <th>
                                            Thao tác
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataPackagePost && dataPackagePost.length > 0 &&
                                        dataPackagePost.map((item, index) => {

                                            return (
                                                <tr key={index}>
                                                    <td>{index + 1 + numberPage * pageSize}</td>
                                                    <td>{item.name}</td>
                                                    <td style={{ textAlign: 'right' }}>{item.value}</td>
                                                    <td style={{ textAlign: 'right' }}>{item.price} USD</td>
                                                    <td>{item.isActive === 0 ? 'Dừng kinh doanh' : 'Đang kinh doanh'}</td>
                                                    <td>
                                                        {/* Loi copy-paste cu: bam "Sua" o goi XEM UNG VIEN
                                                            lai mo trang sua goi BAI DANG. */}
                                                        <Link style={{ color: '#4B49AC' }} to={`/admin/edit-package-cv/${item.id}/`}>Sửa</Link>
                                                        &nbsp; &nbsp;
                                                            {item.isActive === 1 ? (
                                                            <>
                                                                <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={(event) => hanndleSetActivePackage(event,item.id,0)} >Dừng kinh doanh</button>
                                                            </>) : (<>
                                                                <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={(event) => hanndleSetActivePackage(event,item.id,1)} >Mở kinh doanh</button>
                                                            </>)
                                                        }
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                            {
                                dataPackagePost && dataPackagePost.length === 0 && (
                                                <div style={{ textAlign: 'center' }}>

                                                    {loading ? 'Đang tải dữ liệu…' : filtered ? 'Không có kết quả phù hợp' : 'Không có dữ liệu'}

                                                </div>
                                            )
                            }
                        </div></StableList>
                        <ListFooter page={numberPage} pageSize={pageSize} total={total}
                            onPageChange={handleChangePage} onPageSizeChange={handlePageSizeChange} />
                    </div>
                </div>

            </div>

        </div>
    )
}

export default ManagePackageCv
