import React from 'react'
import { useEffect, useState, useRef } from 'react';
import { isJobRevision } from '../../../service/jobFormAdapter';
import { banPostService, getAllPostByAdminService, activePostService, getAllPostByRoleAdminService, acceptPostService } from '../../../service/userService';
import moment from 'moment';
import { PAGINATION } from '../../../util/constant';
import ReactPaginate from 'react-paginate';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import NoteModal from '../../../components/modal/NoteModal';
import { Col, Modal, Row, Select } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import CommonUtils from '../../../util/CommonUtils';
import {Input} from 'antd'
const {confirm} = Modal
const ManagePost = () => {
    const { id } = useParams();
    const [user] = useState(() => {
        try { return JSON.parse(localStorage.getItem('userData')) || {}; } catch { return {}; }
    });
    const [dataPost, setdataPost] = useState([]);
    const [count, setCount] = useState(0);
    const [numberPage, setnumberPage] = useState(0);
    const [search, setSearch] = useState(id || '');
    const [censorCode, setCensorCode] = useState(id ? '' : 'PS3');
    const [total, setTotal] = useState(0);
    const [propsModal, setPropsModal] = useState({ isActive: false, postId: '', action: '', handlePost: () => {} });
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [actionWarning, setActionWarning] = useState('');
    const [refreshVersion, setRefreshVersion] = useState(0);
    const viewEpoch = useRef(0);
    const busy = useRef(false);
    const blocked = useRef(false);
    const censorOptions = [
        { value: '', label: 'Tất cả' }, { value: 'PS1', label: 'Đã kiểm duyệt' },
        { value: 'PS2', label: 'Đã bị từ chối' }, { value: 'PS3', label: 'Chờ kiểm duyệt' },
        { value: 'PS4', label: 'Bài viết đã bị chặn' }
    ];
    useEffect(() => {
        setSearch(id || ''); setCensorCode(id ? '' : 'PS3'); setnumberPage(0);
    }, [id]);
    useEffect(() => {
        let active = true;
        viewEpoch.current += 1;
        setLoading(true); setLoadError(''); setdataPost([]);
        setPropsModal(current => ({ ...current, isActive: false }));
        const load = async () => {
            try {
                const query = { limit: PAGINATION.pagerow, offset: numberPage * PAGINATION.pagerow,
                    search: CommonUtils.removeSpace(search), censorCode };
                const result = user.roleCode === 'ADMIN' ? await getAllPostByRoleAdminService(query)
                    : await getAllPostByAdminService({ ...query, companyId: user.companyId });
                if (!active) return;
                if (!result || result.errCode !== 0 || !Array.isArray(result.data)) throw new Error(result?.errMessage || 'Không đọc được danh sách tin');
                setdataPost(result.data); setTotal(result.count); setCount(Math.ceil(result.count / PAGINATION.pagerow));
            } catch (error) { if (active) setLoadError(error.message || 'Không đọc được danh sách tin'); }
            finally { if (active) setLoading(false); }
        };
        load();
        return () => { active = false; viewEpoch.current += 1; };
    }, [search, censorCode, numberPage, id, refreshVersion, user]);

    const handleChangePage = number => { if (!busy.current && !propsModal.isActive) setnumberPage(number.selected); };
    const handleOnChangeCensor = value => { if (busy.current || propsModal.isActive) return; setCensorCode(value); setnumberPage(0); };
    const handleSearch = value => { if (busy.current || propsModal.isActive) return; setSearch(value); setnumberPage(0); };
    const disabled = loading || pending || !!loadError || !!actionWarning;
    const performModeration = async (row, action, note, epoch) => {
        if (busy.current || blocked.current || disabled || user.roleCode !== 'ADMIN' || epoch !== viewEpoch.current || !isJobRevision(row.editRevision)) return false;
        busy.current = true; setPending(true);
        try {
            const payload = { userId: user.id, note, expectedRevision: row.editRevision };
            const result = action === 'ban' ? await banPostService({ ...payload, postId: row.id }, {})
                : action === 'reopen' ? await activePostService({ ...payload, id: row.id }, {})
                : await acceptPostService({ ...payload, id: row.id, statusCode: action === 'approve' ? 'PS1' : 'PS2' }, {});
            if (epoch !== viewEpoch.current) return false;
            if (result?.errCode === 0) {
                toast.success(result.errMessage);
                setRefreshVersion(value => value + 1);
                return true;
            }
            toast.error(result?.errMessage || 'Không thực hiện được kiểm duyệt');
            if (result?.conflict || result?.errorType === 'conflict' || [409, 428, 404].includes(result?.httpStatus)) {
                blocked.current = true;
                setActionWarning('Tin đã thay đổi hoặc thiếu phiên bản. Hãy giữ lại ghi chú cần thiết, tải lại danh sách và xem nội dung trước khi quyết định lại.');
            } else if (!result || result.errCode === -1 || result.httpStatus >= 500 ||
                ['network', 'timeout', 'cancelled', 'unavailable', 'unknown'].includes(result.errorType)) {
                blocked.current = true;
                setActionWarning('Chưa xác định được quyết định đã lưu hay chưa. Không gửi lại tự động; hãy giữ ghi chú và tải lại để đối chiếu.');
            }
            return false;
        } catch {
            if (epoch === viewEpoch.current) {
                blocked.current = true;
                setActionWarning('Chưa xác định được quyết định đã lưu hay chưa. Hãy giữ ghi chú và tải lại để đối chiếu.');
            }
            return false;
        } finally { busy.current = false; setPending(false); }
    };
    const openNote = (row, action) => {
        const epoch = viewEpoch.current;
        setPropsModal({ isActive: true, postId: row.id, action,
            handlePost: (_id, note) => performModeration(row, action, note, epoch) });
    };
    const confirmPost = row => {
        const epoch = viewEpoch.current;
        confirm({ title: 'Bạn có chắc muốn duyệt bài viết này?', icon: <ExclamationCircleOutlined />,
            onOk: () => performModeration(row, 'approve', '', epoch) });
    };
    const reload = () => {
        if (busy.current || propsModal.isActive) return;
        blocked.current = false;
        setActionWarning(''); setRefreshVersion(value => value + 1);
    };
    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <h4 className="card-title">Danh sách bài đăng</h4>
                        {loading && <p role="status">Đang tải danh sách tin...</p>}
                        {(loadError || actionWarning) && <p role="alert">{loadError || actionWarning}</p>}
                        {user.roleCode === 'ADMIN' && !loading && dataPost.some(row => !isJobRevision(row.editRevision)) &&
                            <p role="alert">Một số tin thiếu phiên bản. Cần cập nhật backend và tải lại trước khi kiểm duyệt.</p>}
                        {(loadError || actionWarning || dataPost.some(row => !isJobRevision(row.editRevision))) &&
                            <button type="button" disabled={pending || loading || propsModal.isActive} onClick={reload}>Tải lại danh sách</button>}
                        <Row justify='space-around' className='mt-5 mb-5'>
                            <Col xs={12} xxl={12}>
                        <Input.Search  onSearch={handleSearch} placeholder={user?.roleCode === "ADMIN" ? "Nhập tên hoặc mã bài đăng, tên công ty" :"Nhập tên hoặc mã bài đăng"} allowClear enterButton="Tìm kiếm">
                        </Input.Search>
                            </Col>
                            <Col xs={8} xxl={8}>
                                <label className='mr-2'>Loại trạng thái: </label>
                                <Select disabled={pending || propsModal.isActive} onChange={handleOnChangeCensor} style={{width:'50%'}} size='default' value={censorCode} options={censorOptions}>
                                    
                                </Select>
                            </Col>

                        </Row>
                        <div>Số lượng bài viết: {total}</div>
                        <div className="table-responsive pt-2">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>
                                            STT
                                        </th>
                                        <th>
                                            Mã bài đăng
                                        </th>
                                        <th>
                                            Tên bài đăng
                                        </th>
                                        {
                                        user?.roleCode === 'ADMIN' &&   
                                        <th>
                                            Tên công ty
                                        </th>
                                        }
                                        <th>
                                            Tên người đăng
                                        </th>
                                        <th>
                                            Ngày kết thúc
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
                                    {dataPost && dataPost.length > 0 &&
                                        dataPost.map((item, index) => {
                                            let date = moment.unix(item.timeEnd / 1000).format('DD/MM/YYYY')
                                            return (
                                                <tr key={item.id}>
                                                    <td>{index + 1 + numberPage * PAGINATION.pagerow}</td>
                                                    <td>{item.id}</td>
                                                    <td>{item.postDetailData?.name || 'Không có nội dung'}</td>
                                                    {
                                                    user?.roleCode === "ADMIN" &&
                                                    <td>{item.userPostData?.userCompanyData?.name || 'Không còn liên kết công ty'}</td>
                                                    }
                                                    <td>{`${item.userPostData?.firstName || ''} ${item.userPostData?.lastName || ''}`}</td>
                                                    <td>{date}</td>
                                                    <td><label className={item.statusPostData.code === 'PS1' ? 'badge badge-success' : (item.statusPostData.code === 'PS3' ? 'badge badge-warning'  : 'badge badge-danger')}>{item.statusPostData.value}</label></td>

                                                    <td>
                                                        <Link style={{color:'#4B49AC'}} to={`/admin/note/${item.id}`}>Chú thích</Link>
                                                        &nbsp; &nbsp;
                                                        {(user.roleCode === 'COMPANY' || user.roleCode === 'EMPLOYER') &&
                                                            <>
                                                                <Link style={{ color: '#4B49AC' }} to={`/admin/list-cv/${item.id}/`}>Xem CV nộp</Link>
                                                                &nbsp; &nbsp;
                                                            </>
                                                        }
                                                        { 
                                                        item.statusCode !== 'PS4' &&
                                                        <Link style={{ color: '#4B49AC' }} to={`/admin/edit-post/${item.id}/`}>{user?.roleCode === "ADMIN" ? 'Xem chi tiết' : 'Sửa'}</Link>
                                                        }
                                                        &nbsp; &nbsp;
                                                        {user.roleCode === 'ADMIN' && <>
                                                            {item.statusCode === 'PS1' &&
                                                                <button type="button" className="btn btn-link p-0" disabled={disabled || !isJobRevision(item.editRevision)}
                                                                    onClick={() => openNote(item, 'ban')}>Chặn</button>}
                                                            {item.statusCode === 'PS4' &&
                                                                <button type="button" className="btn btn-link p-0" disabled={disabled || !isJobRevision(item.editRevision)}
                                                                    onClick={() => openNote(item, 'reopen')}>Mở lại</button>}
                                                            {['PS2', 'PS3'].includes(item.statusCode) &&
                                                                <button type="button" className="btn btn-link p-0" disabled={disabled || !isJobRevision(item.editRevision)}
                                                                    onClick={() => confirmPost(item)}>Duyệt</button>}
                                                            {item.statusCode === 'PS3' &&
                                                                <button type="button" className="btn btn-link p-0 ml-2" disabled={disabled || !isJobRevision(item.editRevision)}
                                                                    onClick={() => openNote(item, 'reject')}>Từ chối</button>}
                                                        </>}
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                            {
                                            dataPost && dataPost.length === 0 && (
                                                <div style={{ textAlign: 'center' }}>

                                                    Không có dữ liệu

                                                </div>
                                            )
                            }
                        </div>
                    </div>
                    <ReactPaginate
                                        forcePage={numberPage}

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
                    />
                </div>

            </div>
            <NoteModal key={`${propsModal.postId}:${propsModal.action}`} awaitResult feedback={actionWarning} isOpen={propsModal.isActive}
                onHide={() => setPropsModal(current => ({ ...current, isActive: false }))}
                id={propsModal.postId} handleFunc={propsModal.handlePost} />
        </div>
    )
}

export default ManagePost
