import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Modal, ModalFooter, ModalBody, Button } from 'reactstrap';
import { createNewCv } from '../../service/cvService';
import { getDetailUserById } from '../../service/userService';
import { preparedCvEnabled } from '../../service/candidateWorkspace';
import CommonUtils from '../../util/CommonUtils';
import { readJsonStorage } from '../../util/storage';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import PreparedCvPicker from './PreparedCvPicker';
import './modal.css';
import './SendCvModal.css';

const PDF_LIMIT = 2 * 1024 * 1024;
const pdfBlob = value => {
    if (typeof value !== 'string' || !/^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Chọn tệp PDF hợp lệ để ứng tuyển.');
    const binary = atob(value.split(',')[1]);
    if (!binary.startsWith('%PDF-') || binary.length > PDF_LIMIT) throw new Error('Chọn tệp PDF hợp lệ không quá 2 MiB.');
    return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'application/pdf' });
};

function ApplicationForm({ user, token, postId, jobTitle, onHide, onSubmitted }) {
    const [type, setType] = useState('pcCv'), [description, setDescription] = useState('');
    const [file, setFile] = useState(''), [savedFile, setSavedFile] = useState(''), [fileUrl, setFileUrl] = useState('');
    const [savedLoading, setSavedLoading] = useState(true), [savedError, setSavedError] = useState('');
    const [reading, setReading] = useState(false), [isLoading, setIsLoading] = useState(false);
    const [prepared, setPrepared] = useState(null), [reviewed, setReviewed] = useState(false), [feedback, setFeedback] = useState('');
    const mounted = useRef(false), sending = useRef(false), fileVersion = useRef(0);
    const current = () => mounted.current && localStorage.getItem('token_user') === token
        && Number(readJsonStorage('userData')?.id) === Number(user.id)
        && readJsonStorage('userData')?.roleCode === 'CANDIDATE';
    const acceptPrepared = useCallback(value => { setPrepared(value); setReviewed(false); }, []);

    useEffect(() => {
        mounted.current = true;
        let active = true;
        (async () => {
            try {
                const response = await getDetailUserById(user.id);
                if (!active || localStorage.getItem('token_user') !== token) return;
                if (response?.errCode !== 0 || response.httpStatus >= 400) throw new Error('Không tải được CV online.');
                const value = response.data?.userAccountData?.userSettingData?.file || '';
                if (value) pdfBlob(value);
                setSavedFile(value);
            } catch (failure) { if (active) setSavedError('Không tải được CV online hợp lệ. Bạn có thể chọn tệp khác.'); }
            finally { if (active) setSavedLoading(false); }
        })();
        return () => { active = false; mounted.current = false; fileVersion.current += 1; };
    }, [user.id, token]);

    const selectedFile = type === 'userCv' ? savedFile : type === 'preparedCv' ? prepared?.file || '' : file;
    useEffect(() => {
        setFileUrl('');
        if (!selectedFile || type === 'preparedCv') return undefined;
        let url;
        try { url = URL.createObjectURL(pdfBlob(selectedFile)); setFileUrl(url); } catch { return undefined; }
        return () => URL.revokeObjectURL(url);
    }, [selectedFile, type]);

    const chooseType = event => {
        if (sending.current) return;
        const value = event.target.value;
        if (value === 'userCv' && !savedFile) {
            toast.error(savedError || (savedLoading ? 'Đang tải CV online. Hãy chờ một chút.' : 'Hiện chưa đăng CV online cho chúng tôi')); return;
        }
        fileVersion.current += 1; setReading(false); setType(value); setPrepared(null); setReviewed(false); setFeedback('');
    };
    const chooseFile = async event => {
        if (sending.current) return;
        const selected = event.target.files?.[0], version = ++fileVersion.current;
        setFile(''); setFeedback('');
        if (!selected) { setReading(false); return; }
        if (selected.size > PDF_LIMIT) { setReading(false); toast.error('File của bạn quá lớn. Chỉ gửi file dưới 2MB'); return; }
        if (!/\.pdf$/i.test(selected.name) || !selected.size) { setReading(false); toast.error('Chọn tệp PDF hợp lệ để ứng tuyển.'); return; }
        setReading(true);
        try {
            const value = await CommonUtils.getBase64(selected); pdfBlob(value);
            if (current() && version === fileVersion.current) setFile(value);
        } catch (failure) { if (current() && version === fileVersion.current) toast.error(failure.message || 'Không đọc được tệp PDF.'); }
        finally { if (current() && version === fileVersion.current) setReading(false); }
    };
    const submit = async () => {
        if (sending.current || reading || !current()) return;
        if (!description.trim() || Array.from(description).length > 255) { toast.error('Nhập lời giới thiệu từ 1 đến 255 ký tự.'); return; }
        if (type === 'preparedCv' && (!preparedCvEnabled() || !prepared || !reviewed)) { toast.error('Tạo và xem lại bản PDF trước khi gửi hồ sơ.'); return; }
        try { pdfBlob(selectedFile); } catch (failure) { toast.error(failure.message); return; }
        sending.current = true; setIsLoading(true); setFeedback('');
        // Capture the exact reviewed bytes; never refetch/regenerate a CV during submission.
        const payload = { userId: user.id, file: selectedFile, postId, description };
        let response;
        try { response = await createNewCv(payload); } catch { response = null; }
        if (!current()) return;
        sending.current = false; setIsLoading(false);
        if (response?.errCode === 0 && !(response.httpStatus >= 400)) { toast.success('Đã gửi thành công'); onSubmitted?.(); onHide(); return; }
        const message = response?.errCode === 5 ? 'Bạn đã ứng tuyển tin này. Hãy kiểm tra CV trong Công việc đã nộp.'
            : !response || response.errCode === -1 || response.httpStatus >= 500
                ? 'Chưa xác nhận được việc nộp hồ sơ. Kiểm tra Công việc đã nộp trước khi gửi lại.' : response.errMessage || 'Gửi thất bại';
        setFeedback(message); toast.error(message);
    };

    return <Modal isOpen className="booking-modal-container send-cv-modal" size="lg" centered scrollable aria-labelledby="send-cv-title">
        <ModalBody>
            <h2 id="send-cv-title">NỘP CV CỦA BẠN CHO NHÀ TUYỂN DỤNG</h2>
            <p>Ứng tuyển: <strong>{jobTitle || `Công việc #${postId}`}</strong></p>
            <fieldset disabled={isLoading}>
                <label htmlFor="application-introduction">Lời giới thiệu</label>
                <textarea id="application-introduction" placeholder="Giới thiệu sơ lược về bản thân để tăng sự yêu thích đối với nhà tuyển dụng"
                    name="description" maxLength={255} value={description} rows="4" onChange={event => setDescription(event.target.value)} />
                <p>Lời giới thiệu tối đa 255 ký tự. Tệp CV đã nộp được giữ riêng với CV đang lưu trong hồ sơ.</p>
                <div className="cv-source-options">
                    {[['pcCv', 'Tự chọn CV'], ['userCv', 'CV online'], ...(preparedCvEnabled() ? [['preparedCv', 'CV đã chuẩn bị']] : [])].map(([value, label]) =>
                        <label key={value}><input type="radio" name="typeCV" value={value} checked={type === value} onChange={chooseType} /> {label}</label>)}
                </div>
                {savedLoading && <p role="status">Đang tải CV online…</p>}
                {type === 'pcCv' && <input type="file" aria-label="Chọn tệp CV" accept="application/pdf,.pdf" onChange={chooseFile} />}
                {reading && <p role="status">Đang đọc tệp CV…</p>}
                {fileUrl && <p><a href={fileUrl} target="_blank" rel="noreferrer">Nhấn vào đây để xem lại CV của bạn</a></p>}
                {type === 'preparedCv' && <>
                    <PreparedCvPicker token={token} disabled={isLoading} onPrepared={acceptPrepared} />
                    {prepared && <label className="cv-review-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> Tôi đã xem và chọn bản PDF này để ứng tuyển</label>}
                </>}
            </fieldset>
            {feedback && <p role="alert">{feedback} <a href="/candidate/cv-post">Xem Công việc đã nộp</a></p>}
            {isLoading && <p role="status">Đang gửi hồ sơ…</p>}
        </ModalBody>
        <ModalFooter>
            <Button disabled={isLoading || reading || (type === 'preparedCv' && (!prepared || !reviewed))} onClick={submit}>Gửi hồ sơ</Button>
            <Button onClick={onHide}>Hủy</Button>
        </ModalFooter>
    </Modal>;
}

export default function SendCvModal(props) {
    const context = useContext(SessionContext), user = context === undefined ? readJsonStorage('userData') : context;
    const [ended, setEnded] = useState(false);
    useEffect(() => {
        const end = () => setEnded(true), storage = event => { if (event.key === null || ['token_user', 'userData'].includes(event.key)) end(); };
        window.addEventListener(SESSION_ENDED_EVENT, end); window.addEventListener('storage', storage);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', storage); };
    }, []);
    const token = localStorage.getItem('token_user');
    if (!props.isOpen || ended || !token || !user?.id || user.roleCode !== 'CANDIDATE') return null;
    return <ApplicationForm key={`${user.id}:${token}:${props.postId}`} {...props} user={user} token={token} />;
}
