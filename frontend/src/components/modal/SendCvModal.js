import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Modal, ModalFooter, ModalBody, Button } from 'reactstrap';
import { createNewCv } from '../../service/cvService';
import { getDetailUserById } from '../../service/userService';
import { preparedCvEnabled, candidateAiEnabled } from '../../service/candidateWorkspace';
import { applicationPdf, MAX_APPLICATION_PDF_BYTES, APPLICATION_PDF_TOO_LARGE, APPLICATION_PDF_INVALID } from '../../service/applicationPdf';
import CommonUtils from '../../util/CommonUtils';
import { readJsonStorage } from '../../util/storage';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import PreparedCvPicker from './PreparedCvPicker';
import PdfPreviewButton from '../documents/PdfPreviewButton';
import ApplicationAiHelper from './ApplicationAiHelper';
import './modal.css';
import './SendCvModal.css';

const fileSizeLabel = size => size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KiB` : `${(size / (1024 * 1024)).toFixed(2)} MiB`;

function ApplicationForm({ user, token, postId, jobTitle, onHide, onSubmitted }) {
    const [type, setType] = useState('pcCv'), [description, setDescription] = useState('');
    const [file, setFile] = useState(''), [savedFile, setSavedFile] = useState(''), [fileName, setFileName] = useState('CV-ung-tuyen.pdf');
    const [fileSize, setFileSize] = useState(0), [savedSize, setSavedSize] = useState(0), [fileError, setFileError] = useState('');
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
                const saved = value ? applicationPdf(value) : null;
                setSavedFile(saved?.file || ''); setSavedSize(saved?.size || 0);
            } catch (failure) { if (active) setSavedError('Không tải được CV online hợp lệ. Bạn có thể chọn tệp khác.'); }
            finally { if (active) setSavedLoading(false); }
        })();
        return () => { active = false; mounted.current = false; fileVersion.current += 1; };
    }, [user.id, token]);

    const selectedFile = type === 'userCv' ? savedFile : type === 'preparedCv' ? prepared?.file || '' : file;
    const chooseType = event => {
        if (sending.current) return;
        const value = event.target.value;
        if (value === 'userCv' && !savedFile) {
            toast.error(savedError || (savedLoading ? 'Đang tải CV online. Hãy chờ một chút.' : 'Hiện chưa đăng CV online cho chúng tôi')); return;
        }
        fileVersion.current += 1; setReading(false); setType(value); setPrepared(null); setReviewed(false); setFeedback(''); setFileError('');
    };
    const chooseFile = async event => {
        if (sending.current) return;
        const input = event.target, selected = input.files?.[0], version = ++fileVersion.current;
        setFile(''); setFileName('CV-ung-tuyen.pdf'); setFileSize(0); setFileError(''); setFeedback('');
        const reject = message => { input.value = ''; setFileError(message); toast.error(message); };
        if (!selected) { setReading(false); return; }
        if (selected.size > MAX_APPLICATION_PDF_BYTES) { setReading(false); reject(APPLICATION_PDF_TOO_LARGE); return; }
        if (!/\.pdf$/i.test(selected.name) || !selected.size) { setReading(false); reject(APPLICATION_PDF_INVALID); return; }
        setReading(true);
        try {
            const value = applicationPdf(await CommonUtils.getBase64(selected));
            if (current() && version === fileVersion.current) { setFile(value.file); setFileSize(value.size); setFileName(selected.name); }
        } catch (failure) { if (current() && version === fileVersion.current) reject(failure.message || 'Không đọc được tệp PDF. Vui lòng chọn lại.'); }
        finally { if (current() && version === fileVersion.current) setReading(false); }
    };
    const submit = async () => {
        if (sending.current || reading || !selectedFile || !current()) return;
        if (!description.trim() || Array.from(description).length > 255) { toast.error('Nhập lời giới thiệu từ 1 đến 255 ký tự.'); return; }
        if (type === 'preparedCv' && (!preparedCvEnabled() || !prepared || !reviewed)) { toast.error('Tạo và xem lại bản PDF trước khi gửi hồ sơ.'); return; }
        try { applicationPdf(selectedFile); } catch (failure) { toast.error(failure.message); return; }
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
                {type === 'pcCv' && <div className="cv-file-picker">
                    <label htmlFor="application-cv-file">Chọn tệp CV</label>
                    <input id="application-cv-file" type="file" accept="application/pdf,.pdf" onChange={chooseFile}
                        aria-describedby={`application-cv-hint${fileError ? ' application-cv-error' : ''}`} aria-invalid={Boolean(fileError)} />
                    <p id="application-cv-hint">Định dạng PDF, tối đa 2 MiB. Bạn có thể xem trước CV trước khi gửi hồ sơ.</p>
                    {fileError && <p id="application-cv-error" className="cv-file-error" role="alert">{fileError}</p>}
                </div>}
                {reading && <p role="status">Đang đọc tệp CV…</p>}
                {selectedFile && type !== 'preparedCv' && <section className="cv-selected-file" aria-label="CV sẽ gửi">
                    <div><p className="cv-selected-file-label">CV sẽ gửi cùng hồ sơ</p>
                        <strong>{type === 'userCv' ? 'CV-online.pdf' : fileName}</strong>
                        <p>{fileSizeLabel(type === 'userCv' ? savedSize : fileSize)} · PDF</p>
                    </div>
                    <PdfPreviewButton source={selectedFile} fileName={type === 'userCv' ? 'CV-online.pdf' : fileName}
                        label="Xem trước CV" disabled={isLoading} />
                </section>}
                {type === 'preparedCv' && <>
                    <PreparedCvPicker token={token} disabled={isLoading} onPrepared={acceptPrepared} />
                    {prepared && <label className="cv-review-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> Tôi đã xem và chọn bản PDF này để ứng tuyển</label>}
                </>}
                {candidateAiEnabled() && <ApplicationAiHelper source={reading ? '' : selectedFile} postId={postId} disabled={isLoading}
                    onUseIntro={text => setDescription(Array.from(text).slice(0, 255).join(''))} />}
            </fieldset>
            {feedback && <p role="alert">{feedback} <a href="/candidate/cv-post">Xem Công việc đã nộp</a></p>}
            {isLoading && <p role="status">Đang gửi hồ sơ…</p>}
        </ModalBody>
        <ModalFooter>
            <Button disabled={isLoading || reading || !selectedFile || (type === 'preparedCv' && (!prepared || !reviewed))} onClick={submit}>Gửi hồ sơ</Button>
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
