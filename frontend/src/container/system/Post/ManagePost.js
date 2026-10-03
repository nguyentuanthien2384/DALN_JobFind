import useListLoading from '../useListLoading';
import StableList from '../../../components/common/StableList';
import React from 'react'
import { useEffect, useState, useRef } from 'react';
import { isJobRevision, jobDeadlineDate, jobStatusLabel } from '../../../service/jobFormAdapter';
import { assertJobEditorIdentity } from '../../../service/jobEditSession';
import { workspaceSelection, listManagedJobs, readManagedJobList } from '../../../service/jobWorkspaceService';
import { banPostService, getAllPostByAdminService, activePostService, getAllPostByRoleAdminService, acceptPostService } from '../../../service/userService';
import moment from 'moment';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import NoteModal from '../../../components/modal/NoteModal';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import CommonUtils from '../../../util/CommonUtils';
import {Input} from 'antd'
import useListQuery, { clampListPage } from '../../../util/useListQuery';
import { notifyAdminAttentionChanged } from '../adminEvents';
import {
    DEFAULT_PAGE_SIZE, FilterSelect, ListFooter, ListTitle, ListToolbar, normalizePageSize, pageForSize,
} from '../List/AdminList';
const {confirm} = Modal
const ManagePost = () => {
    const { id } = useParams();
    const [user] = useState(() => {
        try { return JSON.parse(localStorage.getItem('userData')) || {}; } catch { return {}; }
    });
    const [dataPost, setdataPost] = useState([]);
    const [workspace] = useState(() => workspaceSelection(user));
    const defaults = { page: 0, search: id || '', censorCode: id ? '' : 'PS3', isHot: '', size: DEFAULT_PAGE_SIZE };
    const [query, setQuery] = useListQuery(defaults);
    const { page: numberPage, search, censorCode } = query;
    // Loc theo loai tin chi co o danh sach toan he thong cua quan tri vien.
    const isHot = user.roleCode === 'ADMIN' ? query.isHot : '';
    const pageSize = normalizePageSize(query.size);
    const [total, setTotal] = useState(0);
    const [propsModal, setPropsModal] = useState({ isActive: false, postId: '', action: '', handlePost: () => {} });
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
    const hotOptions = [{ value: '', label: 'Tất cả' }, { value: '1', label: 'Tin nổi bật' }, { value: '0', label: 'Tin thường' }];
    const [loading, setLoading] = useListLoading(JSON.stringify([search, censorCode, isHot, numberPage, pageSize, id, refreshVersion]));
    useEffect(() => {
        let active = true;
        viewEpoch.current += 1;
        setLoading(true); setLoadError('');
        setPropsModal(current => ({ ...current, isActive: false }));
        const load = async () => {
            try {
                if (workspace.error) throw new Error(workspace.error);
                assertJobEditorIdentity(user);
                const listQuery = { limit: pageSize, offset: numberPage * pageSize,
                    search: CommonUtils.removeSpace(search), censorCode };
                const coreQuery = { limit: listQuery.limit, offset: listQuery.offset, search: listQuery.search, statusCode: censorCode };
                const result = workspace.mode === 'core' ? await listManagedJobs(coreQuery)
                    : user.roleCode === 'ADMIN' ? await getAllPostByRoleAdminService({ ...listQuery, ...(isHot ? { isHot } : {}) })
                    : await getAllPostByAdminService({ ...listQuery, companyId: user.companyId });
                if (!active) return;
                assertJobEditorIdentity(user);
                if (workspace.mode === 'core') {
                    const resultPage = readManagedJobList(result, user, coreQuery);
                    const page = clampListPage(numberPage, resultPage.count, pageSize);
                    if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
                    setdataPost(resultPage.data); setTotal(resultPage.count); return;
                }
                if (!result || result.errCode !== 0 || !Array.isArray(result.data)) throw new Error(result?.errMessage || 'Không đọc được danh sách tin');
                const page = clampListPage(numberPage, result.count, pageSize);
                if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
                setdataPost(result.data); setTotal(result.count);
            } catch (error) { if (active) { setdataPost([]); setTotal(0); setLoadError(error.message || 'Không đọc được danh sách tin'); } }
            finally { if (active) setLoading(false); }
        };
        load();
        return () => { active = false; viewEpoch.current += 1; };
    }, [search, censorCode, isHot, numberPage, pageSize, id, refreshVersion, user, workspace, setQuery, setLoading]);

    // Dang gui quyet dinh kiem duyet hoac dang mo hop ghi chu thi khong doi trang/bo loc.
    const updateQuery = update => { if (!busy.current && !propsModal.isActive) setQuery(update); };
    const handleChangePage = page => updateQuery({ page });
    const handleOnChangeCensor = value => updateQuery({ censorCode: value, page: 0 });
    const handleSearch = value => updateQuery({ search: CommonUtils.removeSpace(value), page: 0 });
    const filtered = search !== defaults.search || censorCode !== defaults.censorCode || Boolean(isHot);
    const resetFilters = () => updateQuery({ search: defaults.search, censorCode: defaults.censorCode, isHot: '', page: 0 });
    const disabled = loading || pending || !!loadError || !!actionWarning;
    const performModeration = async (row, action, note, epoch) => {
        if (busy.current || blocked.current || disabled || user.roleCode !== 'ADMIN' || epoch !== viewEpoch.current || !isJobRevision(row.editRevision)) return false;
        busy.current = true; setPending(true);
        try {
            assertJobEditorIdentity(user);
            const payload = { userId: user.id, note, expectedRevision: row.editRevision };
            const result = action === 'ban' ? await banPostService({ ...payload, postId: row.id }, {})
                : action === 'reopen' ? await activePostService({ ...payload, id: row.id }, {})
                : await acceptPostService({ ...payload, id: row.id, statusCode: action === 'approve' ? 'PS1' : 'PS2' }, {});
            if (epoch !== viewEpoch.current) return false;
            if (result?.errCode === 0) {
                toast.success(result.errMessage);
                setRefreshVersion(value => value + 1);
                notifyAdminAttentionChanged();
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
                        <ListTitle title="Danh sách bài đăng" total={loadError || (loading && !total) ? null : total}
                            description={user.roleCode === 'ADMIN' ? 'Tin của mọi doanh nghiệp; cập nhật gần nhất hiển thị trước.' : undefined} />
                        {workspace.mode === 'core' && <p>Danh sách riêng của công ty qua Job Core, gồm cả tin chưa công khai và hết hạn. Trạng thái là lúc tải; không phải xác nhận kết quả của lần đăng đang chờ đối chiếu.</p>}
                        {(loadError || actionWarning) && <p role="alert">{loadError || actionWarning}</p>}
                        {user.roleCode === 'ADMIN' && !loading && dataPost.some(row => !isJobRevision(row.editRevision)) &&
                            <p role="alert">Một số tin thiếu phiên bản. Cần cập nhật backend và tải lại trước khi kiểm duyệt.</p>}
                        {(workspace.mode === 'core' || loadError || actionWarning || dataPost.some(row => !isJobRevision(row.editRevision))) &&
                            <button type="button" disabled={pending || loading || propsModal.isActive} onClick={reload}>Tải lại danh sách</button>}
                        <ListToolbar canReset={filtered} onReset={resetFilters} disabled={pending || propsModal.isActive}>
                            <Input.Search key={search} defaultValue={search} onSearch={handleSearch} placeholder={user?.roleCode === "ADMIN" ? "Nhập tên hoặc mã bài đăng, tên công ty" :"Nhập tên hoặc mã bài đăng"} allowClear enterButton="Tìm kiếm" />
                            <FilterSelect label="Trạng thái" name="censorCode" value={censorCode} options={censorOptions}
                                disabled={pending || propsModal.isActive} onChange={handleOnChangeCensor} />
                            {user.roleCode === 'ADMIN' && (
                                <FilterSelect label="Loại tin" name="isHot" value={isHot} options={hotOptions}
                                    disabled={pending || propsModal.isActive} onChange={value => updateQuery({ isHot: value, page: 0 })} />
                            )}
                        </ListToolbar>
                        <StableList busy={loading} resetKey={JSON.stringify([search, censorCode, isHot, pageSize, id])}><div className="table-responsive">
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
                                            const deadline = jobDeadlineDate(item.timeEnd);
                                            let date = deadline ? moment(deadline).format('DD/MM/YYYY') : 'Chưa rõ ngày hết hạn';
                                            return (
                                                <tr key={item.id}>
                                                    <td>{index + 1 + numberPage * pageSize}</td>
                                                    <td>{item.id}</td>
                                                    <td>{item.postDetailData?.name || 'Không có nội dung'}</td>
                                                    {
                                                    user?.roleCode === "ADMIN" &&
                                                    <td>{item.userPostData?.userCompanyData?.name || 'Không còn liên kết công ty'}</td>
                                                    }
                                                    <td>{`${item.userPostData?.firstName || ''} ${item.userPostData?.lastName || ''}`}</td>
                                                    <td>{date}</td>
                                                    <td><label className={item.statusCode === 'PS1' ? 'badge badge-success' : (item.statusCode === 'PS3' ? 'badge badge-warning'  : 'badge badge-danger')}>{item.statusPostData?.value || jobStatusLabel(item.statusCode)}</label></td>

                                                    <td>
                                                        <span className="jf-row-actions">
                                                        <Link to={`/admin/note/${item.id}`}>Chú thích</Link>
                                                        {(user.roleCode === 'COMPANY' || user.roleCode === 'EMPLOYER') &&
                                                            <Link to={`/admin/list-cv/${item.id}/`}>Xem CV nộp</Link>
                                                        }
                                                        {
                                                        ['PS1', 'PS2', 'PS3'].includes(item.statusCode) &&
                                                        <Link to={`/admin/edit-post/${item.id}/`}>{user?.roleCode === "ADMIN" ? 'Xem chi tiết' : 'Sửa'}</Link>
                                                        }
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
                                                                <button type="button" className="btn btn-link p-0" disabled={disabled || !isJobRevision(item.editRevision)}
                                                                    onClick={() => openNote(item, 'reject')}>Từ chối</button>}
                                                        </>}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                            {
                                            !loading && !loadError && dataPost && dataPost.length === 0 && (
                                                <div className="jf-table__empty">
                                                    {filtered ? 'Không có bài đăng khớp bộ lọc' : 'Không có dữ liệu'}
                                                    {numberPage > 0 && <button type="button" className="btn btn-link p-0 ml-2" onClick={() => setQuery({ page: 0 })}>Về trang đầu</button>}
                                                </div>
                                            )
                            }
                        </div></StableList>
                        {!loadError && <ListFooter page={numberPage} pageSize={pageSize} total={total}
                            disabled={pending || propsModal.isActive}
                            onPageChange={handleChangePage}
                            onPageSizeChange={size => updateQuery({ size, page: pageForSize(numberPage, pageSize, size) })} />}
                    </div>
                </div>

            </div>
            <NoteModal key={`${propsModal.postId}:${propsModal.action}`} awaitResult feedback={actionWarning} isOpen={propsModal.isActive}
                onHide={() => setPropsModal(current => ({ ...current, isActive: false }))}
                id={propsModal.postId} handleFunc={propsModal.handlePost} />
        </div>
    )
}

export default ManagePost
