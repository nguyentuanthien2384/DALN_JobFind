import StableList from '../../../components/common/StableList';
import React from 'react'

import { DeleteAllcodeService, getListAllCodeService } from '../../../service/userService';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import useCatalogList from '../useCatalogList';
import { ListFooter, ListTitle, ListToolbar } from '../List/AdminList';
import {Input, Modal} from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons';
const {confirm} = Modal

const ManageWorkType = () => {
    const { rows: dataWorkType, total, pageSize, filtered, resetFilters, handlePageSizeChange, loading, numberPage, search, searchDraft, setSearchDraft,
        handleChangePage, handleSearch, refresh } = useCatalogList(getListAllCodeService, { type: 'WORKTYPE' });
    let handleDeleteWorkType = async (code) => {
        let res = await DeleteAllcodeService(code)
        if (res && res.errCode === 0) {
            toast.success(res.errMessage)
            refresh();
        } else toast.error(res.errMessage)
    }
    const confirmDelete = (id) => {
        confirm({
            title: 'Bạn có chắc muốn xóa hình thức làm việc này?',
            icon: <ExclamationCircleOutlined />,    
            onOk() {
                handleDeleteWorkType(id)
            },
        
            onCancel() {
            },
          });
    }
    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <ListTitle title="Danh sách hình thức làm việc" total={loading && !total ? null : total} />
                        <ListToolbar canReset={filtered} onReset={resetFilters}>
                            <Input.Search value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={handleSearch} placeholder="Nhập tên hình thức" allowClear enterButton="Tìm kiếm" />
                        </ListToolbar>
                        <StableList busy={loading} resetKey={JSON.stringify([search, pageSize])}><div className="table-responsive pt-2">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>
                                            STT
                                        </th>
                                        <th>
                                            Tên hình thức làm việc
                                        </th>
                                        <th>
                                            Mã code
                                        </th>

                                        <th>
                                            Thao tác
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataWorkType && dataWorkType.length > 0 &&
                                        dataWorkType.map((item, index) => {

                                            return (
                                                <tr key={index}>
                                                    <td>{index + 1 + numberPage * pageSize}</td>
                                                    <td>{item.value}</td>
                                                    <td>{item.code}</td>
                                                    <td>
                                                        <Link style={{ color: '#4B49AC' }} to={`/admin/edit-work-type/${item.code}/`}>Sửa</Link>
                                                        &nbsp; &nbsp;
                                                        <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => confirmDelete(item.code)} >Xóa</button>
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                            {
                                dataWorkType && dataWorkType.length === 0 && (
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

export default ManageWorkType
