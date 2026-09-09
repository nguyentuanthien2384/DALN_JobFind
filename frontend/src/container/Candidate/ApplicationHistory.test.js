import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ManageCvCandidate from './ManageCvCandidate';
import { getAllListCvByUserIdService } from '../../service/cvService';
import { getMyApplications } from '../../service/applicationService';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
jest.mock('../../service/cvService',()=>({getAllListCvByUserIdService:jest.fn()}));
jest.mock('../../service/applicationService',()=>({getMyApplications:jest.fn()}));
jest.mock('react-router-dom',()=>({Link:({to,children})=><a href={to}>{children}</a>}));
jest.mock('react-paginate',()=>props=><button onClick={()=>props.onPageChange({selected:1})}>Trang tiếp</button>);
const cv={id:12,userId:7,postId:91,isChecked:0,postCvData:{id:91,postDetailData:{name:'React job'}}};
const response={errCode:0,count:1,data:[cv]};
const stages={errCode:0,count:1,data:[{id:900,legacy_cv_id:12,job_id:91,stage:'phong_van'}]};
beforeEach(()=>{
    jest.clearAllMocks();localStorage.clear();localStorage.setItem('userData',JSON.stringify({id:7,roleCode:'CANDIDATE'}));localStorage.setItem('token_user','test-7');
    process.env.REACT_APP_APPLICATION_PROGRESS_ENABLED='true';getAllListCvByUserIdService.mockResolvedValue(response);getMyApplications.mockResolvedValue(stages);
});
afterEach(()=>delete process.env.REACT_APP_APPLICATION_PROGRESS_ENABLED);
test('shows progress separately from read state and retains original CV links',async()=>{
    render(<ManageCvCandidate/>);await screen.findByText('Phỏng vấn');expect(screen.getByText('Chưa xem')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Xem CV đã nộp'})).toHaveAttribute('href','/candidate/cv-detail/12');
    expect(screen.queryByText('900')).not.toBeInTheDocument();
});
test('flag off makes only legacy requests and tolerates missing historical job joins',async()=>{
    process.env.REACT_APP_APPLICATION_PROGRESS_ENABLED='false';getAllListCvByUserIdService.mockResolvedValue({...response,data:[{...cv,postCvData:null}]});
    render(<ManageCvCandidate/>);await screen.findByText('Tin tuyển dụng không còn thông tin');expect(getMyApplications).not.toHaveBeenCalled();
    expect(screen.queryByRole('link',{name:'Xem công việc'})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Xem CV đã nộp'})).toBeInTheDocument();
});
test('progress outage leaves submitted CV visible; retry refreshes the stage',async()=>{
    getMyApplications.mockResolvedValueOnce({errCode:503});render(<ManageCvCandidate/>);
    await screen.findByText('Chưa tải được tiến trình');expect(screen.getByText('React job')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tải lại hồ sơ'));await screen.findByText('Phỏng vấn');
    expect(getAllListCvByUserIdService).toHaveBeenCalledTimes(2);expect(getMyApplications).toHaveBeenCalledTimes(2);
});
test('missing projection is pending, not rejection or proof that submission failed',async()=>{
    getMyApplications.mockResolvedValue({errCode:0,data:[]});render(<ManageCvCandidate/>);await screen.findByText('Đang chờ đồng bộ');expect(screen.queryByText('Từ chối')).not.toBeInTheDocument();
});
test('late page response cannot replace the selected page',async()=>{
    let finish;getAllListCvByUserIdService.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({...response,data:[{...cv,id:13,postCvData:{id:91,postDetailData:{name:'Current page'}}}]});
    render(<ManageCvCandidate/>);fireEvent.click(screen.getByText('Trang tiếp'));await screen.findByText('Current page');
    await act(async()=>finish(response));expect(screen.queryByText('React job')).not.toBeInTheDocument();
});
test('expired session clears view and ignores late response',async()=>{
    let finish;getMyApplications.mockReturnValue(new Promise(resolve=>{finish=resolve;}));render(<ManageCvCandidate/>);await screen.findByText('React job');
    act(()=>window.dispatchEvent(new Event(SESSION_ENDED_EVENT)));await act(async()=>finish(stages));
    expect(screen.queryByText('React job')).not.toBeInTheDocument();expect(screen.queryByText('Phỏng vấn')).not.toBeInTheDocument();
});
test('legacy failure or wrong owner is not shown as an empty successful list',async()=>{
    getAllListCvByUserIdService.mockResolvedValue({...response,data:[{...cv,userId:8}]});render(<ManageCvCandidate/>);
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách'));
    expect(screen.queryByText('React job')).not.toBeInTheDocument();expect(screen.queryByText('Chưa có hồ sơ trên trang này.')).not.toBeInTheDocument();
});
