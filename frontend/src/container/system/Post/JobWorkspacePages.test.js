import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from '../../../axios';
import { getAllPostByAdminService, getAllPostByRoleAdminService, getListNoteByPost, acceptPostService } from '../../../service/userService';
import ManagePost from './ManagePost';
import NotePost from './NotePost';

let mockParams = {};
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useParams: () => mockParams, useNavigate: () => mockNavigate,
    Link: ({ to, children }) => <a href={to}>{children}</a> }));
jest.mock('../../../axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../../service/userService', () => ({ getAllPostByAdminService: jest.fn(), getAllPostByRoleAdminService: jest.fn(),
    getListNoteByPost: jest.fn(), acceptPostService: jest.fn(), activePostService: jest.fn(), banPostService: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../util/CommonUtils', () => ({ __esModule: true, default: { removeSpace: value => value.trim().replace(/\s+/g, ' ') } }));
jest.mock('react-paginate', () => props => <button onClick={() => props.onPageChange({ selected: 1 })}>Trang 2</button>);
jest.mock('../../../components/modal/NoteModal', () => () => null);
jest.mock('@ant-design/icons', () => ({ ExclamationCircleOutlined: () => null }));
jest.mock('antd', () => {
    const React = require('react');
    return { Row: ({ children }) => <div>{children}</div>, Col: ({ children }) => <div>{children}</div>,
        Modal: { confirm: jest.fn(options => options.onOk()) },
        Select: ({ value, onChange, options, disabled }) => <select aria-label="Trạng thái" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
        Input: { Search: ({ onSearch }) => { const [value, setValue] = React.useState(''); return <div>
            <input aria-label="Tìm tin" value={value} onChange={e => setValue(e.target.value)} /><button onClick={() => onSearch(value)}>Tìm kiếm</button>
        </div>; } } };
});
const user = { id: 7, companyId: 3, roleCode: 'EMPLOYER' };
const row = (patch = {}) => ({ id: 55, name: 'Tin công ty', statusCode: 'PS3', timeEnd: '1700000000000', isHot: 1,
    updatedAt: '2026-09-08T00:00:00Z', userId: 8, companyId: 3, authorFirstName: 'Lan', authorLastName: null, ...patch });
const listing = patch => ({ errCode: 0, data: [row(patch)], count: 7 });
const review = (jobPatch = {}) => ({ errCode: 0, data: { job: { id: 55, name: 'Tin công ty', companyId: 3, statusCode: 'PS3', reviewState: 'ai_requested', ...jobPatch },
    notes: [{ id: 1, authorId: 88, authorFirstName: null, authorLastName: null, note: '<script>Ghi chú cũ</script>', createdAt: null }], count: 7 } });
let originalMode;
beforeEach(() => {
    originalMode = process.env.REACT_APP_JOB_WORKSPACE_MODE; process.env.REACT_APP_JOB_WORKSPACE_MODE = 'core';
    jest.clearAllMocks(); mockParams = {}; localStorage.clear(); sessionStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    axios.get.mockReset().mockImplementation(async path => path.includes('/review') ? review() : listing());
    getAllPostByAdminService.mockReset().mockResolvedValue({ errCode: 0, data: [], count: 0 });
    getAllPostByRoleAdminService.mockReset().mockResolvedValue({ errCode: 0, data: [], count: 0 });
    getListNoteByPost.mockReset().mockResolvedValue({ errCode: 0, data: [], count: 0 });
});
afterEach(() => { if (originalMode === undefined) delete process.env.REACT_APP_JOB_WORKSPACE_MODE; else process.env.REACT_APP_JOB_WORKSPACE_MODE = originalMode; });
const query = () => Object.fromEntries(new URL(axios.get.mock.calls.at(-1)[0], 'http://test.local').searchParams);
const page2 = () => fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));
test('recruiter list is private, displays actual status and links to detail/notes without moderation controls or receipt writes', async () => {
    sessionStorage.setItem('jobfind:core-create:v1:7:3', 'keep-evidence'); render(<ManagePost />);
    await screen.findByText('Tin công ty'); expect(axios.get).toHaveBeenCalledWith('/api/jobs/manage?limit=5&offset=0&search=&statusCode=PS3', { timeout: 15000 });
    expect(screen.getByRole('cell', { name: 'Chờ kiểm duyệt' })).toBeInTheDocument(); expect(screen.getByText('Lan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sửa' })).toHaveAttribute('href', '/admin/edit-post/55/');
    expect(screen.getByRole('link', { name: 'Chú thích' })).toHaveAttribute('href', '/admin/note/55');
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument(); expect(getAllPostByAdminService).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('jobfind:core-create:v1:7:3')).toBe('keep-evidence');
});
test('search/status reset paging, mode stays pinned and manual reload does not write', async () => {
    render(<ManagePost />); await screen.findByText('Tin công ty'); page2(); await waitFor(() => expect(query().offset).toBe('5'));
    fireEvent.change(screen.getByLabelText('Tìm tin'), { target: { value: '  Tin  & %_!  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    await waitFor(() => expect(query()).toMatchObject({ offset: '0', search: 'Tin & %_!' })); await screen.findByText('Tin công ty');
    axios.get.mockResolvedValueOnce(listing({ statusCode: 'PS1' })); fireEvent.change(screen.getByLabelText('Trạng thái'), { target: { value: 'PS1' } });
    await waitFor(() => expect(query().statusCode).toBe('PS1')); await screen.findByText('Tin công ty');
    process.env.REACT_APP_JOB_WORKSPACE_MODE = 'legacy'; axios.get.mockResolvedValueOnce(listing({ statusCode: 'PS1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' })); await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(5));
    expect(getAllPostByAdminService).not.toHaveBeenCalled(); expect(acceptPostService).not.toHaveBeenCalled();
});
test.each([{ errCode: 401 }, { errCode: 403 }, { errCode: 503 }, { errCode: 0, data: [row({ companyId: 4 })], count: 1 }, { errCode: 0, data: [], count: '0' }])
('list failure %j hides old rows/count and never falls back or presents a successful empty list', async response => {
    render(<ManagePost />); await screen.findByText('Tin công ty'); axios.get.mockResolvedValueOnce(response);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' })); await screen.findByRole('alert');
    expect(screen.queryByText('Tin công ty')).not.toBeInTheDocument(); expect(screen.queryByText('Không có dữ liệu')).not.toBeInTheDocument();
    expect(screen.queryByText(/Số lượng bài viết:/)).not.toBeInTheDocument(); expect(getAllPostByAdminService).not.toHaveBeenCalled();
});
test('slow earlier filter result cannot replace newer results', async () => {
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(<ManagePost />);
    axios.get.mockResolvedValueOnce(listing({ name: 'Tin đã duyệt', statusCode: 'PS1' }));
    fireEvent.change(screen.getByLabelText('Trạng thái'), { target: { value: 'PS1' } }); await screen.findByText('Tin đã duyệt');
    await act(async () => finish(listing())); expect(screen.queryByText('Tin công ty')).not.toBeInTheDocument();
});
test('account change during a list read rejects the old company response', async () => {
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(<ManagePost />);
    localStorage.setItem('userData', JSON.stringify({ ...user, companyId: 4 })); await act(async () => finish(listing()));
    await screen.findByRole('alert'); expect(screen.queryByText('Tin công ty')).not.toBeInTheDocument();
});
test('out-of-range empty list allows returning to first page', async () => {
    render(<ManagePost />); await screen.findByText('Tin công ty'); axios.get.mockResolvedValueOnce({ errCode: 0, data: [], count: 0 }); page2();
    fireEvent.click(await screen.findByRole('button', { name: 'Về trang đầu' })); await screen.findByText('Tin công ty'); expect(query().offset).toBe('0');
});
test('historical unknown status/date displays safely without an edit action', async () => {
    mockParams = { id: '55' }; axios.get.mockResolvedValueOnce(listing({ timeEnd: 'bad', statusCode: null, name: null })); render(<ManagePost />);
    await screen.findByText('Không có nội dung'); expect(screen.getByText('Chưa rõ ngày hết hạn')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sửa' })).not.toBeInTheDocument();
});
test.each(['list', 'notes'])('%s defaults to legacy and ADMIN ignores Core/invalid flag', async page => {
    delete process.env.REACT_APP_JOB_WORKSPACE_MODE; mockParams = page === 'notes' ? { id: '55' } : {};
    const Component = page === 'notes' ? NotePost : ManagePost; const view = render(<Component />);
    await screen.findByText('Không có dữ liệu'); expect(axios.get).not.toHaveBeenCalled(); view.unmount();
    localStorage.setItem('userData', JSON.stringify({ id: 88, roleCode: 'ADMIN' })); process.env.REACT_APP_JOB_WORKSPACE_MODE = 'typo'; render(<Component />);
    await screen.findByText('Không có dữ liệu'); expect(axios.get).not.toHaveBeenCalled();
    expect(page === 'notes' ? getListNoteByPost : getAllPostByRoleAdminService).toHaveBeenCalled();
});
test.each(['list', 'notes'])('invalid flag locks %s rather than redirecting to an available API', async page => {
    process.env.REACT_APP_JOB_WORKSPACE_MODE = 'CORE'; mockParams = page === 'notes' ? { id: '55' } : {}; const Component = page === 'notes' ? NotePost : ManagePost;
    render(<Component />); await screen.findByRole('alert'); expect(axios.get).not.toHaveBeenCalled();
    expect(getAllPostByAdminService).not.toHaveBeenCalled(); expect(getListNoteByPost).not.toHaveBeenCalled();
});
test('Core review displays source-backed AI summary and historical manual notes as text, not markup', async () => {
    mockParams = { id: '55' }; render(<NotePost />); await screen.findByText('<script>Ghi chú cũ</script>');
    expect(screen.getByText(/chưa xác nhận worker/)).toBeInTheDocument(); expect(screen.getByText(/không phải lịch sử đầy đủ/)).toBeInTheDocument();
    expect(screen.getByText('Không còn thông tin người ghi nhận')).toBeInTheDocument(); expect(screen.getByText('Không rõ thời gian')).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith('/api/jobs/55/review?limit=5&offset=0', { timeout: 15000 });
    page2(); await waitFor(() => expect(query().offset).toBe('5')); expect(getListNoteByPost).not.toHaveBeenCalled();
});
test.each([['ai_requested', 'PS3', 'chưa xác nhận worker'], ['ai_failed', 'PS3', 'không phải quyết định từ chối'],
    ['ai_applied', 'PS2', 'Kết quả AI đã được áp dụng'], ['no_active_ai', 'PS3', 'Không có yêu cầu AI hiện hành'], ['untracked', 'PS3', 'Chưa xác định được luồng']])
('review %s is explicit even without manual notes', async (reviewState, statusCode, message) => {
    mockParams = { id: '55' }; const response = review({ reviewState, statusCode }); response.data.notes = []; response.data.count = 0;
    axios.get.mockResolvedValueOnce(response); render(<NotePost />); await screen.findByText(new RegExp(message));
    expect(screen.getByText(/không có nghĩa tin chưa được AI kiểm duyệt/)).toBeInTheDocument(); expect(axios.get).toHaveBeenCalledTimes(1);
});
test.each([{ errCode: 404 }, { errCode: 503 }, review({ companyId: 4 }), review({ id: 56 }), review({ reviewState: 'running' })])
('review failure %j clears previous private information without fallback', async response => {
    mockParams = { id: '55' }; render(<NotePost />); await screen.findByText('<script>Ghi chú cũ</script>'); axios.get.mockResolvedValueOnce(response);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại thông tin kiểm duyệt' })); await screen.findByRole('alert');
    expect(screen.queryByText('<script>Ghi chú cũ</script>')).not.toBeInTheDocument(); expect(screen.queryByText(/chưa xác nhận worker/)).not.toBeInTheDocument();
    expect(getListNoteByPost).not.toHaveBeenCalled();
});
test('slow note response from previous job cannot populate a new route', async () => {
    let finish; mockParams = { id: '55' }; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = render(<NotePost />);
    mockParams = { id: '56' }; const newer = review({ id: 56, name: 'Tin khác' }); newer.data.notes = []; newer.data.count = 0;
    axios.get.mockResolvedValueOnce(newer); view.rerender(<NotePost />); await screen.findByText(/Tin #56/);
    await act(async () => finish(review())); expect(screen.queryByText('<script>Ghi chú cũ</script>')).not.toBeInTheDocument();
});
test('thrown note read is recoverable only by explicit reload; account switch blocks subsequent reads', async () => {
    mockParams = { id: '55' }; axios.get.mockRejectedValueOnce(new Error('Connection lost')); render(<NotePost />); await screen.findByRole('alert');
    expect(axios.get).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Tải lại thông tin kiểm duyệt' }));
    await screen.findByText('<script>Ghi chú cũ</script>'); localStorage.setItem('userData', JSON.stringify({ ...user, id: 99 }));
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại thông tin kiểm duyệt' })); await screen.findByRole('alert');
    expect(axios.get).toHaveBeenCalledTimes(2); expect(screen.queryByText('<script>Ghi chú cũ</script>')).not.toBeInTheDocument();
});
