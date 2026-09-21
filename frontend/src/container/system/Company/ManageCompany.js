import useListLoading from '../useListLoading';
import StableList from '../../../components/common/StableList';
import React from 'react'
import { useEffect, useState } from 'react';
import { getAllCompany, accecptCompanyService, banCompanyService, unbanCompanyService } from '../../../service/userService';
import moment from 'moment';
import { PAGINATION } from '../../../util/constant';
import ReactPaginate from 'react-paginate';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import NoteModal from '../../../components/modal/NoteModal';
import { Modal, Input, Row, Col, Select } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import CommonUtils from '../../../util/CommonUtils';
import useListQuery, { clampListPage } from '../../../util/useListQuery';
const { confirm } = Modal
const ManageCompany = () => {
    const [dataCompany, setdataCompany] = useState([])
    const [count, setCount] = useState(0)
    const [{ page: numberPage, search, censorCode }, setQuery] = useListQuery({ page: 0, search: '', censorCode: '' })
    const [refresh, setRefresh] = useState(0)
    const [user, setUser] = useState({})
    const [propsModal, setPropsModal] = useState({
        isActive: false,
        handleCompany: () => { },
        id: ''
    })
    const [total, setTotal] = useState(0)

    const censorOptions = [
        {
            value: '',
            label: 'Tất cả'
        },
        {
            value: 'CS1',
            label: 'Đã kiểm duyệt'
        },
        {
            value: 'CS2',
            label: 'Chưa kiểm duyệt'
        },
        {
            value: 'CS3',
            label: 'Đang chờ kiểm duyệt'
        },
    ]
    let handleOnChangeCensor = (value) => {
        setQuery({ censorCode: value, page: 0 })
    }
    const [loading, setLoading] = useListLoading(JSON.stringify([search, censorCode, numberPage, refresh]));
    useEffect(() => {
        let active = true;
        setLoading(true);
        try {
            const userData = JSON.parse(localStorage.getItem('userData'));
            if (userData) {
                let fetchData = async () => {
                    let arrData = []
                    arrData = await getAllCompany({
                        limit: PAGINATION.pagerow,
                        offset: numberPage * PAGINATION.pagerow,
                        search: CommonUtils.removeSpace(search),
                        censorCode: censorCode


                    })
                    if (!active) return;
                    if (arrData?.errCode !== 0) throw new Error();
                    if (active && arrData && arrData.errCode === 0) {
                        setTotal(arrData.count)
                        setCount(Math.ceil(arrData.count / PAGINATION.pagerow))
                        const page = clampListPage(numberPage, arrData.count, PAGINATION.pagerow);
                        if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
                        setdataCompany(arrData.data)
                    }
                }
                fetchData().catch(() => { if (active) { setdataCompany([]); setCount(0); setTotal(0); toast.error('Không tải được danh sách công ty'); } })
                    .finally(() => { if (active) setLoading(false); });
                setUser(userData)
            } else { setdataCompany([]); setCount(0); setTotal(0); setLoading(false); }

        } catch (error) {
            setdataCompany([]); setCount(0); setTotal(0); setLoading(false);
        }

        return () => { active = false; };
    }, [search, censorCode, numberPage, refresh, setQuery, setLoading])

    const handleChangePage = number => setQuery({ page: number.selected });
    let handleBanCompany = async(id) => {
        let res = await banCompanyService({id: id})
        if (res && res.errCode === 0) {
            setRefresh(value => value + 1);
            toast.success(res.errMessage)
        } else {
            toast.error(res.errMessage)
        }
    }

    let handleUnBanCompany = async(id) => {
        let res = await unbanCompanyService({id: id})
        if (res && res.errCode === 0) {
            setRefresh(value => value + 1);
            toast.success(res.errMessage)
        } else {
            toast.error(res.errMessage)
        }
    }

    let handleAccecptCompany = async (id, note = 'null') => {
        let res = await accecptCompanyService({
            companyId: id,
            note: note,
        })
        if (res && res.errCode === 0) {
            setRefresh(value => value + 1);
            toast.success(res.errMessage)
        } else {
            toast.error(res.errMessage)
        }
    }
    const confirmPost = (id,type) => {
        let title = type === 'ban' ? `Bạn có chắc muốn dừng hoạt động công ty này` : (type === 'unban' ? `Bạn có chắc muốn mở lại hoạt động công ty này` : `Bạn có chắc muốn duyệt công ty này`)
        confirm({
            title: title,
            icon: <ExclamationCircleOutlined />,
            onOk() {
                if (type === 'accept')
                {
                    handleAccecptCompany(id)
                }
                else if (type === 'ban') {
                    handleBanCompany(id)
                }
                else {
                    handleUnBanCompany(id)
                }
            },

            onCancel() {
            },
        });
    }
    const handleSearch = (value) => {
        setQuery({ search: value, page: 0 })
    }
    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <h4 className="card-title">Danh sách công ty</h4>
                        <Row justify='space-around' className='mt-5 mb-5'>
                            <Col xs={12} xxl={12}>
                                <Input.Search key={search} defaultValue={search} onSearch={handleSearch} placeholder="Nhập tên hoặc mã công ty" allowClear enterButton="Tìm kiếm">
                                </Input.Search>
                            </Col>
                            <Col xs={8} xxl={8}>
                                <label className='mr-2'>Loại kiểm duyệt: </label>
                                <Select onChange={(value) => handleOnChangeCensor(value)} style={{ width: '50%' }} size='default' value={censorCode} options={censorOptions}>

                                </Select>
                            </Col>

                        </Row>
                        <div>Số lượng công ty: {total}</div>

                        <StableList busy={loading} resetKey={JSON.stringify([search, censorCode])}><div className="table-responsive pt-2">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>
                                            STT
                                        </th>
                                        <th>
                                            Mã công ty
                                        </th>
                                        <th>
                                            Tên công ty
                                        </th>
                                        <th>
                                            Số điện thoại
                                        </th>
                                        <th>
                                            Mã số thuế
                                        </th>
                                        <th>
                                            Trạng thái
                                        </th>
                                        <th>
                                            Kiểm duyệt
                                        </th>
                                        <th>
                                            Ngày khởi tạo
                                        </th>
                                        <th>
                                            Thao tác
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataCompany && dataCompany.length > 0 &&
                                        dataCompany.map((item, index) => {
                                            return (
                                                <tr key={index}>
                                                    <td>{index + 1 + numberPage * PAGINATION.pagerow}</td>
                                                    <td>{item.id}</td>
                                                    <td>{item.name}</td>
                                                    <td>{item.phonenumber}</td>
                                                    <td>{item.taxnumber}</td>
                                                    <td><label className={item.statusCompanyData.code === 'S1' ? 'badge badge-success' : 'badge badge-danger'}>{item.statusCompanyData.value}</label></td>
                                                    <td><label className={item.censorData.code === 'CS1' ? 'badge badge-success' : (item.censorData.code === 'CS3'? 'badge badge-warning'  : 'badge badge-danger')}>{item.censorData.value}</label></td>
                                                    <td>{moment(item.createdAt).format('DD-MM-YYYY')}</td>
                                                    <td>
                                                        {
                                                            item.statusCompanyData.code === 'S1' ? (
                                                            <>
                                                            <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => confirmPost(item.id,'ban')} >Dừng kích hoạt</button>
                                                                    &nbsp; &nbsp;                           
                                                            </>) : (<>
                                                                <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => confirmPost(item.id,'unban')} >Kích hoạt</button>
                                                                &nbsp; &nbsp;
                                                            </>)
                                                        }
                                                        <Link style={{ color: '#4B49AC' }} to={`/admin/edit-company-admin/${item.id}`}>{user?.roleCode === "ADMIN" ? 'Xem chi tiết' : 'Sửa'}</Link>
                                                        &nbsp; &nbsp;
                                                        {item.censorData.code === 'CS3' &&
                                                            <>
                                                                <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => confirmPost(item.id,'accept')} >Duyệt</button>
                                                                &nbsp; &nbsp;
                                                                <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => setPropsModal({
                                                                    isActive: true,
                                                                    handleCompany: handleAccecptCompany,
                                                                    id: item.id
                                                                })} >Từ chối</button>
                                                                &nbsp; &nbsp;
                                                            </>
                                                        }
                                                        {
                                                            item.censorData.code === 'CS1' &&
                                                            <>
                                                                <button type="button" className="btn btn-link p-0" style={{ color: '#4B49AC' }} onClick={() => setPropsModal({
                                                                    isActive: true,
                                                                    handleCompany: handleAccecptCompany,
                                                                    id: item.id
                                                                })}  >Quay lại trạng thái chờ</button>
                                                                &nbsp; &nbsp;
                                                            </>
                                                        }
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                            {
                                dataCompany && dataCompany.length === 0 && (
                                    <div style={{ textAlign: 'center' }}>

                                        Không có dữ liệu

                                    </div>
                                )
                            }
                        </div></StableList>
                    </div>
                    {count > 0 && <ReactPaginate
                        forcePage={Math.min(numberPage, count - 1)}
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
            <NoteModal isOpen={propsModal.isActive} onHide={() => setPropsModal({
                isActive: false,
                handleCompany: () => { },
                id: ''
            })} id={propsModal.id} handleFunc={propsModal.handleCompany} />
        </div >
    )
}

export default ManageCompany
