import StableList from '../../../components/common/StableList';
import React from 'react'

import { DeleteSkillService, getListSkill } from '../../../service/userService';
import { PAGINATION } from '../../../util/constant';
import ReactPaginate from 'react-paginate';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import 'react-image-lightbox/style.css';
import useCatalogList from '../useCatalogList';
import {Input, Modal, Row, Col, Select} from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useFetchAllcode } from '../../../util/fetch';
const {confirm} = Modal

const ManageJobSkill = () => {
    const { rows: dataJobSkill, count, loading, numberPage, search, searchDraft, setSearchDraft,
        handleChangePage, handleSearch, refresh, categoryJobCode, handleCategoryChange } = useCatalogList(getListSkill, { withCategory: true });
    let { data: listCategoryJobCode } = useFetchAllcode('JOBTYPE');
    listCategoryJobCode = listCategoryJobCode.map(item=> ({
        value: item.code,
        label: item.value
    }))
    listCategoryJobCode.unshift({
        value: '',
        label: 'Tất cả'
    })

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
                        <h4 className="card-title">Danh sách các kĩ năng</h4>
                        <Row justify='space-around' className='mt-5 mb-5'>
                            <Col xs={12} xxl={12}>
                        <Input.Search value={searchDraft} onChange={event => setSearchDraft(event.target.value)}  onSearch={handleSearch} placeholder="Nhập tên kĩ năng " allowClear enterButton="Tìm kiếm">
                        </Input.Search>
                            </Col>
                            <Col xs={8} xxl={8}>
                                <label className='mr-2'>Loại trạng thái: </label>
                                <Select onChange={handleCategoryChange} value={categoryJobCode} style={{width:'50%'}} size='default' options={listCategoryJobCode ? listCategoryJobCode : []}>
                                    
                                </Select>
                            </Col>

                        </Row>
                        <StableList busy={loading} resetKey={JSON.stringify([search, categoryJobCode])}><div className="table-responsive pt-2">
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
                                    {dataJobSkill && dataJobSkill.length > 0 &&
                                        dataJobSkill.map((item, index) => {

                                            return (
                                                <tr key={index}>
                                                    <td>{index + 1 + numberPage * PAGINATION.pagerow}</td>
                                                    <td>{item.name}</td>
                                                    <td>{item.jobTypeSkillData.value}</td>
                                                    <td>
                                                        <Link style={{ color: '#4B49AC' }} to={`/admin/edit-job-skill/${item.id}/`}>Sửa</Link>
                                                        &nbsp; &nbsp;
                                                        <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => confirmDelete(item.id)} >Xóa</button>
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                            {
                                dataJobSkill && dataJobSkill.length === 0 && (
                                                <div style={{ textAlign: 'center' }}>

                                                    {loading ? 'Đang tải dữ liệu…' : 'Không có dữ liệu'}

                                                </div>
                                            )
                            }
                        </div></StableList>
                    </div>
                    {count > 0 && <ReactPaginate
                    forcePage={Math.min(numberPage, count - 1)}
                        disableInitialCallback={true}
                        previousLabel={'Quay lại'}
                        nextLabel={'Tiếp'}
                        breakLabel={'...'}
                        pageCount={count}
                        marginPagesDisplayed={3}
                        containerClassName={"pagination justify-content-center pb-3"}
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
    )
}

export default ManageJobSkill
