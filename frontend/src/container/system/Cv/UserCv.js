import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getDetailCvService } from '../../../service/cvService';
import { readJsonStorage } from '../../../util/storage';
import { SESSION_ENDED_EVENT } from '../../../auth/sessionExpiry';
import PdfPreviewButton from '../../../components/documents/PdfPreviewButton';
import { isPdfSource } from '../../../components/documents/documentSource';
import './UserCv.css';

const UserCv = () => {
    const user = readJsonStorage('userData');
    const role = user?.roleCode, token = localStorage.getItem('token_user');
    const { id } = useParams();
    const navigate = useNavigate();
    const scope = JSON.stringify([id, user?.id, role, token]);
    const [state, setState] = useState(null), [refresh, setRefresh] = useState(0);
    const [ended, setEnded] = useState(false);
    const data = state?.scope === scope && !ended ? state.data : null;
    const file = data?.file;

    useEffect(() => {
        const end = () => setEnded(true);
        const storage = event => { if (event.key === null || ['userData', 'token_user'].includes(event.key)) end(); };
        window.addEventListener(SESSION_ENDED_EVENT, end); window.addEventListener('storage', storage);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', storage); };
    }, []);

    useEffect(() => {
        let active = true;
        setState({ scope, loading: true });
        const load = async () => {
            try {
                if (!id || !role || ended) throw new Error('Bạn cần đăng nhập để xem hồ sơ.');
                const response = await getDetailCvService(id, role);
                if (!active || localStorage.getItem('token_user') !== token) return;
                if (response?.errCode !== 0 || response.httpStatus >= 400 || !response.data) {
                    throw new Error(response?.errMessage || 'Không tải được hồ sơ. Vui lòng thử lại.');
                }
                setState({ scope, loading: false, data: response.data });
            } catch (error) {
                if (active) setState({ scope, loading: false, error: error.message || 'Không tải được hồ sơ.' });
            }
        };
        load();
        return () => { active = false; };
    }, [id, role, token, scope, ended, refresh]);

    // The shared viewer verifies the bytes; historical missing/unsupported values
    // still have a clear empty state without turning them into a browser frame.
    const hasPdfSource = isPdfSource(file);
    return <div className="col-12 grid-margin submitted-cv-view"><div className="card"><div className="card-body">
        <button type="button" className="cv-back" onClick={() => navigate(-1)}>Quay lại</button>
        {ended ? <p role="alert">Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại để xem hồ sơ.</p>
            : state?.scope !== scope || state.loading ? <p role="status">Đang tải hồ sơ…</p>
                : state.error ? <div role="alert"><p>{state.error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Tải lại hồ sơ</button></div>
                    : data && <>
                        <h4 className="card-title">Giới thiệu bản thân</h4>
                        <blockquote className="blockquote blockquote-primary">
                            <p>{data.description || 'Hồ sơ không có lời giới thiệu.'}</p>
                            <footer className="blockquote-footer"><cite>{[data.userCvData?.firstName, data.userCvData?.lastName].filter(Boolean).join(' ') || 'Thông tin ứng viên không còn khả dụng'}</cite></footer>
                        </blockquote>
                        <h4 className="card-title">FILE CV</h4>
                        {hasPdfSource ? <>
                            <div className="cv-file-actions">
                                <PdfPreviewButton key={scope} source={file} fileName={`CV-${id}.pdf`} label="Xem CV đã nộp" />
                            </div>
                            <p>Đây là bản CV đã nộp khi ứng tuyển. Bạn có thể xem từng trang, phóng to và tải xuống trong trình xem PDF.</p>
                        </> : <p>Hồ sơ này không còn tệp PDF hợp lệ để xem.</p>}
                    </>}
    </div></div></div>;
};
export default UserCv;
