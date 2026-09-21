import StableList from '../../../components/common/StableList';
import React from 'react'

import { getAllPackage, setActiveTypePackage } from '../../../service/userService';
import { PAGINATION } from '../../../util/constant';
import ReactPaginate from 'react-paginate';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import useCatalogList from '../useCatalogList';
import {Input} from 'antd'
const ManagePackagePost = () => {
    const { rows: dataPackagePost, count, loading, numberPage, search, searchDraft, setSearchDraft,
        handleChangePage, handleSearch, refresh } = useCatalogList(getAllPackage);
    let hanndleSetActivePackage = async (event,id, isActive) => {
        event.preventDefault();
        let res = await setActiveTypePackage({
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
                        <h4 className="card-title">Danh sách các gói bài đăng</h4>
                        <Input.Search value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={handleSearch} className='mt-5 mb-5' placeholder="Nhập tên gói bài đăng" allowClear enterButton="Tìm kiếm">
                                    
                                    </Input.Search>
                        <StableList busy={loading} resetKey={search}><div className="table-responsive pt-2">
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
                                            Loại
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
                                                    <td>{index + 1 + numberPage * PAGINATION.pagerow}</td>
                                                    <td>{item.name}</td>
                                                    <td style={{ textAlign: 'right' }}>{item.value}</td>
                                                    <td style={{ textAlign: 'right' }}>{item.price} USD</td>
                                                    <td>{item.isHot === 0 ? 'Gói bình thường' : 'Gói nổi bật'}</td>
                                                    <td>{item.isActive === 0 ? 'Dừng kinh doanh' : 'Đang kinh doanh'}</td>
                                                    <td>
                                                        <Link style={{ color: '#4B49AC' }} to={`/admin/edit-package-post/${item.id}/`}>Sửa</Link>
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

export default ManagePackagePost
