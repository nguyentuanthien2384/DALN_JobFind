import React, { useEffect, useState } from 'react';
import { getListNoteByPost } from '../../../service/userService';
import { assertJobEditorIdentity } from '../../../service/jobEditSession';
import { workspaceSelection, getManagedJobReview, readManagedJobReview, reviewStateLabel } from '../../../service/jobWorkspaceService';
import { jobStatusLabel } from '../../../service/jobFormAdapter';
import moment from 'moment';
import { PAGINATION } from '../../../util/constant';
import ReactPaginate from 'react-paginate';
import { useNavigate, useParams } from 'react-router-dom';

const NotePost = () => {
    const { id } = useParams(), navigate = useNavigate();
    const [user] = useState(() => {
        try { return JSON.parse(localStorage.getItem('userData')) || {}; } catch { return {}; }
    });
    const [workspace] = useState(() => workspaceSelection(user));
    const [notes, setNotes] = useState([]), [count, setCount] = useState(0), [page, setPage] = useState(0);
    const [job, setJob] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    useEffect(() => setPage(0), [id]);
    useEffect(() => {
        let active = true;
        setLoading(true); setError(''); setNotes([]); setCount(0); setJob(null);
        const load = async () => {
            try {
                if (workspace.error) throw new Error(workspace.error);
                assertJobEditorIdentity(user);
                if (!id) throw new Error('Chưa chọn tin tuyển dụng');
                const query = { limit: PAGINATION.pagerow, offset: page * PAGINATION.pagerow };
                const response = workspace.mode === 'core' ? await getManagedJobReview(id, query)
                    : await getListNoteByPost({ ...query, id });
                if (!active) return;
                assertJobEditorIdentity(user);
                if (workspace.mode === 'core') {
                    const result = readManagedJobReview(response, id, user, query);
                    setJob(result.job); setNotes(result.notes); setCount(result.count);
                } else {
                    if (response?.errCode !== 0 || !Array.isArray(response.data) || !Number.isSafeInteger(response.count) || response.count < 0) {
                        throw new Error(response?.errMessage || 'Không đọc được ghi chú');
                    }
                    setNotes(response.data); setCount(response.count);
                }
            } catch (failure) { if (active) setError(failure.message || 'Không đọc được thông tin kiểm duyệt'); }
            finally { if (active) setLoading(false); }
        };
        load();
        return () => { active = false; };
    }, [id, page, refresh, user, workspace]);
    return <div className="col-12 grid-margin"><div className="card"><div className="card-body">
        <div onClick={() => navigate(-1)} className="mb-2 hover-pointer" style={{ color: 'red' }}>
            <i className="fa-solid fa-arrow-left mr-2" />Quay lại
        </div>
        <h4 className="card-title">Thông tin chi tiết các ghi chú bài viết</h4>
        {workspace.mode === 'core' && <p>Thông tin kiểm duyệt qua Job Core. Ghi chú bên dưới là lịch sử thủ công, không phải lịch sử đầy đủ hoặc lý do kiểm duyệt của AI.</p>}
        {loading && <p role="status">Đang tải thông tin kiểm duyệt...</p>}
        {error && <p role="alert">{error}</p>}
        {job && <div role="status">
            <p>Tin #{job.id}: {job.name || 'Không có nội dung'} — trạng thái lúc tải: {jobStatusLabel(job.statusCode)}</p>
            <p>{reviewStateLabel(job.reviewState)}</p>
            <p>AI đánh giá tiêu đề và mô tả; không xác minh toàn bộ thông tin tuyển dụng. Trạng thái đã duyệt không bảo đảm tin còn hạn hoặc đã xuất hiện trên kết quả tìm kiếm.</p>
        </div>}
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Tải lại thông tin kiểm duyệt</button>
        {!loading && !error && <p>Số ghi chú thủ công: {count}</p>}
        <div className="table-responsive pt-2"><table className="table table-bordered">
            <thead><tr><th>STT</th><th>Tên người ghi nhận</th><th>Mã người ghi nhận</th><th>Nội dung</th><th>Thời gian ghi nhận</th></tr></thead>
            <tbody>{notes.map((note, index) => <tr key={note.id}>
                <td>{index + 1 + page * PAGINATION.pagerow}</td>
                <td>{[note.userNoteData?.firstName, note.userNoteData?.lastName].filter(Boolean).join(' ') || 'Không còn thông tin người ghi nhận'}</td>
                <td>{note.userNoteData?.id ?? '—'}</td><td>{note.note ?? 'Không có nội dung'}</td>
                <td>{note.createdAt && moment(note.createdAt).isValid() ? moment(note.createdAt).format('DD-MM-YYYY HH:mm:ss') : 'Không rõ thời gian'}</td>
            </tr>)}</tbody>
        </table>
            {!loading && !error && notes.length === 0 && <p>{workspace.mode === 'core' ? 'Không có ghi chú thủ công ở trang này; không có nghĩa tin chưa được AI kiểm duyệt.' : 'Không có dữ liệu'}</p>}
            {!loading && !error && notes.length === 0 && page > 0 && <button type="button" onClick={() => setPage(0)}>Về trang đầu</button>}
        </div>
        <ReactPaginate forcePage={page} previousLabel="Quay lại" nextLabel="Tiếp" breakLabel="..."
            pageCount={Math.ceil(count / PAGINATION.pagerow)} marginPagesDisplayed={3}
            containerClassName="pagination justify-content-center pb-3" pageClassName="page-item" pageLinkClassName="page-link"
            previousClassName="page-item" previousLinkClassName="page-link" nextClassName="page-item" nextLinkClassName="page-link"
            breakClassName="page-item" breakLinkClassName="page-link" activeClassName="active"
            onPageChange={number => { if (!loading) setPage(number.selected); }} />
    </div></div></div>;
};
export default NotePost;
