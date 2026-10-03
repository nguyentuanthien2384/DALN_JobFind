import StableList from '../../../components/common/StableList';
import React from 'react'

import { DeleteSkillService, getListSkill } from '../../../service/userService';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import 'react-image-lightbox/style.css';
import useCatalogList from '../useCatalogList';
import { FilterSelect, ListFooter, ListTitle, ListToolbar } from '../List/AdminList';
import {Input, Modal} from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useFetchAllcode } from '../../../util/fetch';
const {confirm} = Modal

const ManageJobSkill = () => {
    const { rows: dataJobSkill, total, pageSize, filtered, resetFilters, handlePageSizeChange, loading, numberPage, search,
        searchDraft, setSearchDraft, handleChangePage, handleSearch, refresh, categoryJobCode,
        handleCategoryChange } = useCatalogList(getListSkill, { withCategory: true });
    const { data: categories } = useFetchAllcode('JOBTYPE');
    const listCategoryJobCode = [
        { value: '', label: 'Tất cả lĩnh vực' },
        ...categories.map(item => ({ value: item.code, label: item.value })),
    ]

    let handleDeleteJobSkill = async (id) => {
        let res = await DeleteSkillService(id)
        if (res && res.errCode === 0) {
            toast.success(res.errMessage)
            refresh();
        } else toast.error(res.errMessage)
    }
    const confirmDelete = (id) => {
        confirm({
            title: 'Bạn có chắc muốn xóa kĩ năng này?',
            icon: <ExclamationCircleOutlined />,
            onOk() {
                handleDeleteJobSkill(id)
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
                        <ListTitle title="Danh sách các kĩ năng" total={loading && !total ? null : total} />
                        <ListToolbar canReset={filtered} onReset={resetFilters}>
                            <Input.Search value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={handleSearch} placeholder="Nhập tên kĩ năng" allowClear enterButton="Tìm kiếm" />
                            <FilterSelect label="Lĩnh vực" name="categoryJobCode" value={categoryJobCode}
                                options={listCategoryJobCode} onChange={handleCategoryChange} />
                        </ListToolbar>
                        <StableList busy={loading} resetKey={JSON.stringify([search, categoryJobCode, pageSize])}><div className="table-responsive">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>
                                            STT
                                        </th>
                                        <th>
                                            Tên kỹ năng
                                        </th>
                                        <th>
                                            Lĩnh vực
                                        </th>
                                        <th>
                                            Thao tác
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataJobSkill.map((item, index) => (
                                        <tr key={item.id ?? index}>
                                            <td>{index + 1 + numberPage * pageSize}</td>
                                            <td>{item.name}</td>
                                            <td>{item.jobTypeSkillData?.value}</td>
                                            <td>
                                                <span className="jf-row-actions">
                                                    <Link to={`/admin/edit-job-skill/${item.id}/`}>Sửa</Link>
                                                    <button type="button" className="btn btn-link p-0" onClick={() => confirmDelete(item.id)}>Xóa</button>
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {dataJobSkill.length === 0 && (
                                <div className="jf-table__empty">
                                    {loading ? 'Đang tải dữ liệu…' : filtered ? 'Không có kết quả phù hợp' : 'Không có dữ liệu'}
                                </div>
                            )}
                        </div></StableList>
                        <ListFooter page={numberPage} pageSize={pageSize} total={total}
                            onPageChange={handleChangePage} onPageSizeChange={handlePageSizeChange} />
                    </div>
                </div>

            </div>
        </div>
    )
}

export default ManageJobSkill
