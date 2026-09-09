import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import CandidateAi from './CandidateAi';
import * as api from '../../service/aiSearchService';
import { intentStorageKey, mutationStorageKey, emptyCv } from '../../service/candidateWorkspace';
import SessionContext from '../../auth/SessionContext';
jest.mock('../../service/aiSearchService',()=>({
    createAiRequestOptions:()=>({idempotencyKey:'a'.repeat(32)}),
    parseResumeAi:jest.fn(),matchCvAi:jest.fn(),coverLetterAi:jest.fn(),getAiTask:jest.fn(),
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
    api.listMyCvs.mockResolvedValue({errCode:0,data:[]});window.confirm=jest.fn(()=>true);
});
afterEach(()=>delete process.env.REACT_APP_CANDIDATE_AI_ENABLED);
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
