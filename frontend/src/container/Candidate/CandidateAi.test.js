import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import CandidateAi from './CandidateAi';
import * as api from '../../service/aiSearchService';
import { intentStorageKey, mutationStorageKey, emptyCv } from '../../service/candidateWorkspace';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { renderPreparedCv } from '../../service/preparedCvPdf';
import PdfPreviewButton from '../../components/documents/PdfPreviewButton';
import DocumentPreviewModal from '../../components/documents/DocumentPreviewModal';
import { loadSearchPage } from '../../service/searchWorkspace';
jest.mock('../../service/searchWorkspace', () => ({ loadSearchPage: jest.fn(), searchMode: () => 'legacy' }));
jest.mock('../../service/preparedCvPdf', () => ({ renderPreparedCv: jest.fn() }));
jest.mock('../../components/documents/PdfPreviewButton', () => jest.fn(({ label }) => <button type="button">{label}</button>));
jest.mock('../../components/documents/DocumentPreviewModal', () => jest.fn(({ fileName, onClose }) => <div role="dialog" aria-label={fileName}><button type="button" onClick={onClose}>Đóng xem trước</button></div>));
jest.mock('../../service/aiSearchService',()=>({
    createAiRequestOptions:()=>({idempotencyKey:'a'.repeat(32)}),
    parseResumeAi:jest.fn(),generateCvAi:jest.fn(),matchCvAi:jest.fn(),coverLetterAi:jest.fn(),getAiTask:jest.fn(),
    listMyCvs:jest.fn(),createMyCv:jest.fn(),updateMyCv:jest.fn(),deleteMyCv:jest.fn()
}));
const user = {id:7,roleCode:'CANDIDATE'};
const completed = {errCode:0,data:{id:'task-1',type:'match_cv',status:'done',result:{score:80,summary:'Phù hợp',matchedSkills:['Node'],missingSkills:[],strengths:[],concerns:[]}}};
const savedIntent = {version:1,type:'match_cv',key:'a'.repeat(32),digest:'b'.repeat(64),taskId:'task-1'};
beforeAll(()=>{Object.defineProperty(window,'crypto',{configurable:true,value:webcrypto});global.TextEncoder=TextEncoder;});
beforeEach(()=>{
    jest.clearAllMocks();sessionStorage.clear();localStorage.clear();process.env.REACT_APP_CANDIDATE_AI_ENABLED='true';
    localStorage.setItem('token_user','session-7');localStorage.setItem('userData',JSON.stringify(user));
    api.matchCvAi.mockResolvedValue({errCode:0,taskId:'task-1'});api.getAiTask.mockResolvedValue(completed);
    api.generateCvAi.mockResolvedValue({errCode:0,taskId:'task-1'});
    loadSearchPage.mockResolvedValue({ count: 1, data: [{ id: 7, postDetailData: { name: 'Frontend Developer' }, userPostData: { userCompanyData: { name: 'Example' } } }] });
    api.listMyCvs.mockResolvedValue({errCode:0,data:[]});window.confirm=jest.fn(()=>true);
    process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED = 'true';
    renderPreparedCv.mockResolvedValue({ blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), pages: 1 });
    PdfPreviewButton.mockImplementation(({ label }) => <button type="button">{label}</button>);
    DocumentPreviewModal.mockImplementation(({ fileName, onClose }) => <div role="dialog" aria-label={fileName}><button type="button" onClick={onClose}>Đóng xem trước</button></div>);
});
afterEach(()=>{ delete process.env.REACT_APP_CANDIDATE_AI_ENABLED; delete process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED; });
const fillMatch=()=>{
    fireEvent.change(screen.getByLabelText('Chức năng'),{target:{value:'match_cv'}});
    fireEvent.change(screen.getByLabelText('Nội dung CV'),{target:{value:'Synthetic Node experience'}});
    fireEvent.change(screen.getByLabelText('Mã công việc'),{target:{value:'7'}});
};
test('double click sends one request, displays validated result without saving CV text in storage',async()=>{
    render(<CandidateAi/>);fillMatch();
    fireEvent.click(screen.getByText('Gửi yêu cầu AI'));fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    expect(await screen.findByText('80/100')).toBeInTheDocument();expect(api.matchCvAi).toHaveBeenCalledTimes(1);
    const stored=sessionStorage.getItem(intentStorageKey(7));expect(stored).toContain('task-1');expect(stored).not.toContain('Synthetic');
    expect(api.getAiTask).toHaveBeenCalledWith('task-1',expect.objectContaining({signal:expect.anything()}));
});
test('unknown response survives remount and rollback; replay sends same key and input only',async()=>{
    api.matchCvAi.mockResolvedValueOnce({errCode:-1,httpStatus:503});const view=render(<CandidateAi/>);fillMatch();
    fireEvent.click(screen.getByText('Gửi yêu cầu AI'));await screen.findByText('Đối chiếu yêu cầu đã gửi');
    const original=api.matchCvAi.mock.calls[0];view.unmount();process.env.REACT_APP_CANDIDATE_AI_ENABLED='false';render(<CandidateAi/>);
    fireEvent.change(screen.getByLabelText('Nội dung CV'),{target:{value:'Different'}});fireEvent.change(screen.getByLabelText('Mã công việc'),{target:{value:'7'}});
    fireEvent.click(screen.getByText('Đối chiếu yêu cầu đã gửi'));await screen.findByText(/Hãy chọn lại đúng/);expect(api.matchCvAi).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Nội dung CV'),{target:{value:original[0]}});fireEvent.click(screen.getByText('Đối chiếu yêu cầu đã gửi'));
    await screen.findByText('80/100');expect(api.matchCvAi.mock.calls[1]).toEqual(original);
});
test('accepted task on refresh only resumes GET and stops waiting without deleting intent',async()=>{
    sessionStorage.setItem(intentStorageKey(7),JSON.stringify(savedIntent));
    api.getAiTask.mockImplementation((id,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject({code:'ERR_CANCELED'}))));
    render(<CandidateAi/>);expect(api.getAiTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Xem / tiếp tục chờ kết quả'));await screen.findByText('Dừng chờ');fireEvent.click(screen.getByText('Dừng chờ'));
    await screen.findByText(/Đã dừng chờ/);expect(JSON.parse(sessionStorage.getItem(intentStorageKey(7))).taskId).toBe('task-1');expect(api.matchCvAi).not.toHaveBeenCalled();
});
test('wrong task ID or model failure cannot appear as a successful result',async()=>{
    sessionStorage.setItem(intentStorageKey(7),JSON.stringify(savedIntent));
    api.getAiTask.mockResolvedValue({...completed,data:{...completed.data,id:'other'}});render(<CandidateAi/>);
    fireEvent.click(screen.getByText('Xem / tiếp tục chờ kết quả'));await screen.findByText('Phản hồi không thuộc tác vụ đang xem.');expect(screen.queryByText('80/100')).not.toBeInTheDocument();
    api.getAiTask.mockResolvedValue({errCode:0,data:{id:'task-1',type:'match_cv',status:'failed',error:'Synthetic failure'}});
    fireEvent.click(screen.getByText('Xem / tiếp tục chờ kết quả'));await screen.findByText('Synthetic failure');expect(screen.getByText('Tác vụ mới')).toBeInTheDocument();
});
test('malformed completed result is not displayed and permits an explicit new task',async()=>{
    sessionStorage.setItem(intentStorageKey(7),JSON.stringify(savedIntent));
    api.getAiTask.mockResolvedValue({...completed,data:{...completed.data,result:{score:101}}});
    render(<CandidateAi/>);fireEvent.click(screen.getByText('Xem / tiếp tục chờ kết quả'));
    await screen.findByText('Điểm phù hợp không hợp lệ.');expect(screen.queryByText('101/100')).not.toBeInTheDocument();
    expect(screen.getByText('Tác vụ mới')).toBeEnabled();expect(api.matchCvAi).not.toHaveBeenCalled();
});

test('role gate denies recruiter; late result after switching user does not change new session',async()=>{
    const view=render(<SessionContext.Provider value={{id:9,roleCode:'COMPANY'}}><CandidateAi/></SessionContext.Provider>);
    expect(screen.getByRole('alert')).toHaveTextContent('tài khoản ứng viên');expect(api.listMyCvs).not.toHaveBeenCalled();
    view.rerender(<SessionContext.Provider value={user}><CandidateAi/></SessionContext.Provider>);
    let resolve;api.matchCvAi.mockReturnValue(new Promise(r=>{resolve=r;}));fillMatch();fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    await waitFor(()=>expect(api.matchCvAi).toHaveBeenCalledTimes(1));localStorage.setItem('token_user','session-8');
    view.rerender(<SessionContext.Provider value={{id:8,roleCode:'CANDIDATE'}}><CandidateAi/></SessionContext.Provider>);
    await act(async()=>resolve({errCode:0,taskId:'private-7'}));expect(screen.queryByText('private-7')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(intentStorageKey(8))).toBeNull();
});
test('storage failure blocks sending before HTTP',async()=>{
    const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage unavailable');});
    render(<CandidateAi/>);fillMatch();fireEvent.click(screen.getByText('Gửi yêu cầu AI'));await screen.findByText('Storage unavailable');expect(api.matchCvAi).not.toHaveBeenCalled();spy.mockRestore();
});
test('CV create -> edit -> delete uses selected ID and canonical fields, no account fields',async()=>{
    const id='507f1f77bcf86cd799439011';const cv={...emptyCv(),title:'My CV',_id:id};
    api.createMyCv.mockResolvedValue({errCode:0,data:cv});api.updateMyCv.mockResolvedValue({errCode:0,data:{...cv,title:'Updated'}});api.deleteMyCv.mockResolvedValue({errCode:0});
    render(<CandidateAi/>);fireEvent.click(screen.getByText('Tải danh sách CV'));await screen.findByText(/Bạn chưa có CV/);
    fireEvent.change(screen.getByLabelText('Tên CV'),{target:{value:'My CV'}});fireEvent.click(screen.getByText('Lưu CV'));
    await waitFor(()=>expect(screen.getByText('Xóa CV')).toBeEnabled());expect(api.createMyCv.mock.calls[0][0]).not.toHaveProperty('userId');
    fireEvent.change(screen.getByLabelText('Tên CV'),{target:{value:'Updated'}});fireEvent.click(screen.getByText('Lưu CV'));
    await waitFor(()=>expect(api.updateMyCv).toHaveBeenCalledWith(id,expect.objectContaining({title:'Updated'})));
    await waitFor(()=>expect(screen.getByText('Xóa CV')).toBeEnabled());fireEvent.click(screen.getByText('Xóa CV'));
    await waitFor(()=>expect(api.deleteMyCv).toHaveBeenCalledWith(id));expect(window.confirm).toHaveBeenCalled();
});
test('uncertain CV save blocks repeats across refresh until explicit list reconciliation',async()=>{
    api.createMyCv.mockResolvedValue({errCode:-1,httpStatus:503});const view=render(<CandidateAi/>);
    fireEvent.click(screen.getByText('Tải danh sách CV'));await screen.findByText(/Bạn chưa có CV/);
    fireEvent.change(screen.getByLabelText('Tên CV'),{target:{value:'Private CV title'}});fireEvent.click(screen.getByText('Lưu CV'));
    await screen.findByText(/Chưa xác nhận được thay đổi CV/);expect(api.createMyCv).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(mutationStorageKey(7))).not.toContain('Private');view.unmount();render(<CandidateAi/>);
    expect(screen.getByText('Lưu CV')).toBeDisabled();expect(screen.getByText('Đã đối chiếu danh sách CV')).toBeDisabled();
    fireEvent.click(screen.getByText('Tải danh sách CV'));await waitFor(()=>expect(screen.getByText('Đã đối chiếu danh sách CV')).toBeEnabled());
    expect(screen.getByText('Lưu CV')).toBeDisabled();fireEvent.click(screen.getByText('Đã đối chiếu danh sách CV'));expect(sessionStorage.getItem(mutationStorageKey(7))).toBeNull();
});

test('selected PDF is passed directly to preview without AI request or browser persistence', () => {
    render(<CandidateAi />);
    const file = new File(['%PDF-1.7'], 'my-cv.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Tệp CV PDF (tối đa 5 MiB)'), { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Xem trước PDF đã chọn' })).toBeEnabled();
    expect(PdfPreviewButton).toHaveBeenLastCalledWith(expect.objectContaining({ source: file, fileName: 'my-cv.pdf' }), expect.anything());
    expect(api.parseResumeAi).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
});

test('draft preview renders current unsaved values without creating, updating or storing a CV', async () => {
    render(<CandidateAi />);
    fireEvent.change(screen.getByLabelText('Tên CV'), { target: { value: 'Frontend CV' } });
    fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'Ứng Viên Mẫu' } });
    fireEvent.change(screen.getByLabelText('Giới thiệu'), { target: { value: 'Nội dung chưa lưu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' }));
    expect(await screen.findByRole('dialog', { name: 'Frontend CV.pdf' })).toBeInTheDocument();
    expect(renderPreparedCv).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Ứng Viên Mẫu', summary: 'Nội dung chưa lưu' }));
    expect(DocumentPreviewModal).toHaveBeenLastCalledWith(expect.objectContaining({ source: expect.any(Blob) }), expect.anything());
    expect(api.createMyCv).not.toHaveBeenCalled(); expect(api.updateMyCv).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng xem trước' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Giới thiệu')).toHaveValue('Nội dung chưa lưu');
});

test('an edit cancels an older PDF preview and allows generating the latest draft', async () => {
    let resolve;
    renderPreparedCv.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<CandidateAi />);
    fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'First draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' }));
    expect(screen.getByRole('button', { name: 'Đang tạo bản PDF…' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'Latest draft' } });
    await act(async () => resolve({ blob: new Blob(['old']) }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' }));
    expect(await screen.findByRole('dialog', { name: 'Latest draft.pdf' })).toBeInTheDocument();
    expect(renderPreparedCv).toHaveBeenLastCalledWith(expect.objectContaining({ fullName: 'Latest draft' }));
});

test('session expiry hides the workspace and ignores a late PDF generation', async () => {
    let resolve;
    renderPreparedCv.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<CandidateAi />);
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' }));
    act(() => window.dispatchEvent(new Event(SESSION_ENDED_EVENT)));
    await act(async () => resolve({ blob: new Blob(['private']) }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('đăng nhập');
});

test('PDF generation errors keep the draft available for correction and retry', async () => {
    renderPreparedCv.mockRejectedValueOnce(new Error('Bổ sung họ và tên trong CV trước khi tạo bản ứng tuyển.'));
    render(<CandidateAi />);
    fireEvent.change(screen.getByLabelText('Tên CV'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bổ sung họ và tên');
    expect(screen.getByLabelText('Tên CV')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' })).toBeEnabled();
});

test('draft PDF export works without prepared-application integration and remains blocked by unresolved CV writes', async () => {
    process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED = 'false';
    const view = render(<CandidateAi />);
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' }));
    expect(await screen.findByRole('dialog', { name: 'CV.pdf' })).toBeInTheDocument();
    expect(renderPreparedCv).toHaveBeenCalledTimes(1);
    view.unmount(); renderPreparedCv.mockClear();
    sessionStorage.setItem(mutationStorageKey(7), JSON.stringify({ action: 'save', cvId: null }));
    render(<CandidateAi />);
    expect(screen.getByRole('button', { name: 'Xem trước / tải PDF bản nháp' })).toBeDisabled();
    expect(renderPreparedCv).not.toHaveBeenCalled();
});

const generatedResult = { title: 'CV Frontend', fullName: 'Ứng Viên Mẫu', email: 'candidate@example.test',
    summary: 'Kinh nghiệm React từ dự án đã cung cấp', skills: ['React'], languages: ['Tiếng Việt'],
    experiences: [{ company: 'Dự án cá nhân', position: 'Frontend', duration: '2024', description: 'Xây dựng ứng dụng React' }],
    educations: [{ school: 'Trường Mẫu', major: 'CNTT', degree: 'Cử nhân', year: '2024' }] };
const completeGeneration = () => api.getAiTask.mockResolvedValue({ errCode: 0,
    data: { id: 'task-1', type: 'generate_cv', status: 'done', result: generatedResult } });
const fillGeneration = () => {
    fireEvent.change(screen.getByLabelText('Chức năng'), { target: { value: 'generate_cv' } });
    fireEvent.change(screen.getByLabelText('Thông tin của bạn'), { target: { value: 'Thông tin thật: dự án React năm 2024, tốt nghiệp CNTT.' } });
};

test('AI generation without a target job becomes an editable draft and uses reviewed values for PDF and save', async () => {
    completeGeneration();
    api.createMyCv.mockImplementation(async payload => ({ errCode: 0, data: { ...payload, _id: '507f1f77bcf86cd799439011' } }));
    render(<CandidateAi />); fillGeneration();
    fireEvent.click(screen.getByText('Gửi yêu cầu AI')); fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    await screen.findByText('Đây là bản nháp do AI tạo.', { exact: false });
    expect(api.generateCvAi).toHaveBeenCalledTimes(1);
    expect(api.generateCvAi).toHaveBeenCalledWith('Thông tin thật: dự án React năm 2024, tốt nghiệp CNTT.', undefined, 'vi', { idempotencyKey: 'a'.repeat(32) });
    expect(screen.getByLabelText('Tên CV')).toHaveValue('');
    expect(api.createMyCv).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(intentStorageKey(7))).not.toContain('Thông tin thật');
    fireEvent.click(screen.getByText('Xem và chỉnh sửa toàn bộ CV'));
    expect(screen.getByLabelText('Họ và tên')).toHaveValue('Ứng Viên Mẫu');
    expect(screen.getByLabelText('Công ty 1')).toHaveValue('Dự án cá nhân');
    expect(screen.getByLabelText('Từ 1')).toHaveValue('2024');
    fireEvent.change(screen.getByLabelText('Giới thiệu'), { target: { value: 'Nội dung đã kiểm tra' } });
    fireEvent.click(screen.getByText('Xem trước / tải PDF bản nháp'));
    await screen.findByRole('dialog', { name: 'CV Frontend.pdf' });
    expect(renderPreparedCv).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Nội dung đã kiểm tra' }));
    fireEvent.click(screen.getByText('Đóng xem trước'));
    fireEvent.click(screen.getByText('Tải danh sách CV'));
    await screen.findByText(/Bạn chưa có CV/);
    fireEvent.click(screen.getByText('Lưu CV'));
    await waitFor(() => expect(api.createMyCv).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Nội dung đã kiểm tra', fullName: 'Ứng Viên Mẫu' })));
    await waitFor(() => expect(screen.getByText('Xóa CV')).toBeEnabled());
});

test('generated CV cannot replace an untitled draft without confirmation', async () => {
    completeGeneration(); render(<CandidateAi />);
    fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'Bản nháp chưa đặt tên' } });
    fillGeneration(); fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    await screen.findByText('Xem và chỉnh sửa toàn bộ CV');
    window.confirm.mockReturnValue(false);
    fireEvent.click(screen.getByText('Xem và chỉnh sửa toàn bộ CV'));
    expect(window.confirm).toHaveBeenCalledWith('Thay bản nháp CV đang mở bằng kết quả AI?');
    expect(screen.getByLabelText('Họ và tên')).toHaveValue('Bản nháp chưa đặt tên');
    expect(screen.getByLabelText('Tên CV')).toHaveValue('');
});

test('generation validates facts and sends the selected public target job and CV language', async () => {
    completeGeneration(); render(<CandidateAi />);
    fireEvent.change(screen.getByLabelText('Chức năng'), { target: { value: 'generate_cv' } });
    fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    await screen.findByText('Nhập thông tin của bạn, tối đa 20.000 ký tự.');
    expect(api.generateCvAi).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    fillGeneration();
    fireEvent.click(screen.getByText('Công việc mục tiêu (không bắt buộc)'));
    fireEvent.change(screen.getByLabelText('Tìm công việc mục tiêu'), { target: { value: 'Frontend' } });
    fireEvent.click(screen.getByText('Tìm công việc'));
    fireEvent.click(await screen.findByText('Frontend Developer — Example (#7)'));
    expect(loadSearchPage).toHaveBeenCalledWith(expect.objectContaining({ search: 'Frontend', limit: 8, offset: 0 }), 'legacy', {});
    expect(screen.getByLabelText('Mã công việc mục tiêu (không bắt buộc)')).toHaveValue('7');
    fireEvent.change(screen.getByLabelText('Ngôn ngữ CV'), { target: { value: 'en' } });
    fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    await screen.findByText('Xem và chỉnh sửa toàn bộ CV');
    expect(api.generateCvAi).toHaveBeenCalledWith(expect.any(String), 7, 'en', { idempotencyKey: 'a'.repeat(32) });
});

test('an uncertain generation submission recovers after refresh with identical facts, language and request key', async () => {
    completeGeneration(); api.generateCvAi.mockResolvedValueOnce({ errCode: -1, httpStatus: 503 });
    const view = render(<CandidateAi />); fillGeneration();
    fireEvent.change(screen.getByLabelText('Ngôn ngữ CV'), { target: { value: 'en' } });
    fireEvent.click(screen.getByText('Gửi yêu cầu AI'));
    await screen.findByText('Đối chiếu yêu cầu đã gửi');
    const original = api.generateCvAi.mock.calls[0];
    view.unmount(); render(<CandidateAi />);
    expect(screen.getByLabelText('Chức năng')).toHaveValue('generate_cv');
    expect(screen.getByLabelText('Thông tin của bạn')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Thông tin của bạn'), { target: { value: original[0] } });
    fireEvent.click(screen.getByText('Đối chiếu yêu cầu đã gửi'));
    await screen.findByText(/Hãy chọn lại đúng/); expect(api.generateCvAi).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Ngôn ngữ CV'), { target: { value: 'en' } });
    fireEvent.click(screen.getByText('Đối chiếu yêu cầu đã gửi'));
    await screen.findByText('Xem và chỉnh sửa toàn bộ CV');
    expect(api.generateCvAi.mock.calls[1]).toEqual(original);
});

test('accepted generation resumes after refresh under rollback without issuing another generation or changing drafts', async () => {
    completeGeneration(); process.env.REACT_APP_CANDIDATE_AI_ENABLED = 'false';
    sessionStorage.setItem(intentStorageKey(7), JSON.stringify({ ...savedIntent, type: 'generate_cv' }));
    render(<CandidateAi />);
    expect(api.getAiTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Xem / tiếp tục chờ kết quả'));
    expect(await screen.findByText('Xem và chỉnh sửa toàn bộ CV')).toBeDisabled();
    expect(api.generateCvAi).not.toHaveBeenCalled(); expect(api.createMyCv).not.toHaveBeenCalled();
    expect(screen.queryByText('Tác vụ mới')).not.toBeInTheDocument();
});

test('target job lookup ignores results for a superseded search', async () => {
    let resolve;
    loadSearchPage.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<CandidateAi />); fillGeneration();
    fireEvent.click(screen.getByText('Công việc mục tiêu (không bắt buộc)'));
    fireEvent.click(screen.getByText('Tìm công việc'));
    fireEvent.change(screen.getByLabelText('Tìm công việc mục tiêu'), { target: { value: 'New search' } });
    await act(async () => resolve({ count: 1, data: [{ id: 7, postDetailData: { name: 'Old job' } }] }));
    expect(screen.queryByText('Old job (#7)')).not.toBeInTheDocument();
    expect(screen.getByText('Tìm công việc')).toBeEnabled();
});
