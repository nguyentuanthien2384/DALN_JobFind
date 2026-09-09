import React, { useContext, useEffect, useState } from 'react';
import { getAllListCvByUserIdService } from '../../service/cvService';
import { getMyApplications } from '../../service/applicationService';
import { applicationProgressEnabled, progressByLegacyCv, applicationStage } from '../../service/applicationProgress';
import { PAGINATION } from '../../util/constant';
import { readJsonStorage } from '../../util/storage';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import ReactPaginate from 'react-paginate';
import { Link } from 'react-router-dom';
import moment from 'moment';
import './ApplicationHistory.css';

function History({ user, token }) {
    const [rows,setRows] = useState([]), [count,setCount] = useState(0), [page,setPage] = useState(0);
    const [loading,setLoading] = useState(true), [error,setError] = useState(''), [refresh,setRefresh] = useState(0);
    const [progress,setProgress] = useState(new Map()), [progressError,setProgressError] = useState(''), [progressLoading,setProgressLoading] = useState(false);
    const enabled = applicationProgressEnabled() && user.roleCode === 'CANDIDATE';
    useEffect(() => {
        let active = true;
        const current = () => active && localStorage.getItem('token_user') === token;
        setLoading(true); setError(''); setRows([]);
        (async () => {
            try {
                const response = await getAllListCvByUserIdService({userId:user.id,limit:PAGINATION.pagerow,offset:page*PAGINATION.pagerow});
                if (!current()) return;
                if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)
                    || !Number.isSafeInteger(response.count) || response.count < 0
                    || response.data.some(row => !row || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || (row.userId != null && Number(row.userId) !== Number(user.id)))) throw Error('Không tải được danh sách hồ sơ đã nộp.');
                setRows(response.data); setCount(response.count);
            } catch (failure) { if (current()) { setError('Không tải được danh sách hồ sơ đã nộp.'); setCount(0); } }
            finally { if (current()) setLoading(false); }
        })();
        return () => { active=false; };
    },[user.id,token,page,refresh]);
    useEffect(() => {
        let active=true;
        setProgress(new Map()); setProgressError('');
        if (enabled) {
            setProgressLoading(true);
            (async () => {
                try { const data=progressByLegacyCv(await getMyApplications()); if(active && localStorage.getItem('token_user')===token) setProgress(data); }
                catch(failure) { if(active) setProgressError(failure.message || 'Không tải được tiến trình tuyển dụng.'); }
                finally { if(active) setProgressLoading(false); }
            })();
        }
        return () => { active=false; };
    },[enabled,token,refresh]);
    return <div className="col-12 grid-margin application-history"><div className="card"><div className="card-body">
        <h4 className="card-title">Danh sách Công Việc Đã Nộp</h4>
        <button type="button" className="history-refresh" disabled={loading || progressLoading} onClick={()=>setRefresh(value=>value+1)}>Tải lại hồ sơ</button>
        {loading && <p role="status">Đang tải hồ sơ đã nộp…</p>}
        {error && <p role="alert">{error}</p>}
        {enabled && <p>Tiến trình do nhà tuyển dụng cập nhật và có thể hiển thị chậm. “Đã xem” là trạng thái đọc CV, không phải quyết định tuyển dụng.</p>}
        {enabled && progressError && <p role="alert">{progressError} Hồ sơ đã nộp vẫn được giữ nguyên; dùng Tải lại hồ sơ để kiểm tra lại.</p>}
        {!loading && !error && rows.length===0 && <p>Chưa có hồ sơ trên trang này.</p>}
        <div className="table-responsive pt-2"><table className="table table-bordered"><thead><tr>
            {['STT','Công việc','Thời gian nộp','Trạng thái đọc',...(enabled?['Tiến trình tuyển dụng']:[]),'Thao tác'].map(label=><th key={label}>{label}</th>)}
        </tr></thead><tbody>{rows.map((cv,index)=>{
            const post=cv.postCvData, detail=post?.postDetailData;
            return <tr key={cv.id}><td data-label="STT">{index+1+page*PAGINATION.pagerow}</td>
                <td data-label="Công việc"><strong>{detail?.name || 'Tin tuyển dụng không còn thông tin'}</strong><small>
                    {[detail?.jobTypePostData?.value,detail?.jobLevelPostData?.value,detail?.provincePostData?.value].filter(Boolean).join(' · ') || 'Chưa có thông tin phân loại'}</small></td>
                <td data-label="Thời gian nộp">{cv.createdAt && moment(cv.createdAt).isValid()?moment(cv.createdAt).format('DD-MM-YYYY HH:mm:ss'):'Chưa xác định'}</td>
                <td data-label="Trạng thái đọc">{Number(cv.isChecked)===0?'Chưa xem':Number(cv.isChecked)===1?'Đã xem':'Chưa xác định'}</td>
                {enabled && <td data-label="Tiến trình tuyển dụng">{progressLoading?'Đang tải tiến trình…':progressError?'Chưa tải được tiến trình':applicationStage(cv,progress)}</td>}
                <td data-label="Thao tác">{post?.id && <><Link style={{color:'#4B49AC'}} to={`/detail-job/${post.id}/`}>Xem công việc</Link>{' · '}</>}
                    <Link style={{color:'#4B49AC'}} to={`/candidate/cv-detail/${cv.id}`}>Xem CV đã nộp</Link></td></tr>;
        })}</tbody></table></div>
        <ReactPaginate forcePage={page} pageCount={Math.max(page+1,Math.ceil(count/PAGINATION.pagerow))} previousLabel="Quay lại" nextLabel="Tiếp" breakLabel="…"
            containerClassName="pagination justify-content-center pb-3" pageClassName="page-item" pageLinkClassName="page-link" previousClassName="page-item" previousLinkClassName="page-link"
            nextClassName="page-item" nextLinkClassName="page-link" activeClassName="active" onPageChange={value=>setPage(value.selected)} />
    </div></div></div>;
}
export default function ManageCvCandidate() {
    const context=useContext(SessionContext), user=context===undefined?readJsonStorage('userData'):context;
    const [ended,setEnded]=useState(false);
    useEffect(()=>{
        const end=()=>setEnded(true), storage=event=>{if(event.key===null || ['token_user','userData'].includes(event.key))end();};
        window.addEventListener(SESSION_ENDED_EVENT,end);window.addEventListener('storage',storage);
        return()=>{window.removeEventListener(SESSION_ENDED_EVENT,end);window.removeEventListener('storage',storage);};
    },[]);
    const token=localStorage.getItem('token_user');
    if(ended || !token || !user?.id || !['CANDIDATE','ADMIN'].includes(user.roleCode))return <p role="alert">Đăng nhập bằng tài khoản ứng viên để xem hồ sơ đã nộp.</p>;
    return <History key={`${user.id}:${token}`} user={user} token={token}/>;
}
