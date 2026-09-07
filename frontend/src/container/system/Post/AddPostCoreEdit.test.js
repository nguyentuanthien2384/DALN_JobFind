import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import axios from '../../../axios';
import { getDetailPostByIdService, updatePostService, reupPostService } from '../../../service/userService';
import { readCoreEditPending, readCoreJobSnapshot, prepareCoreEditPending } from '../../../service/jobEditSession';
import AddPost from './AddPost';

let mockParams = { id: '55' };
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useParams: () => mockParams, useNavigate: () => mockNavigate }));
jest.mock('../../../axios', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn() } }));
jest.mock('../../../service/userService', () => ({ getDetailPostByIdService: jest.fn(), updatePostService: jest.fn(),
    reupPostService: jest.fn(), createPostService: jest.fn(), getDetailCompanyByUserId: jest.fn() }));
jest.mock('../../../util/fetch', () => ({ useFetchAllcode: type => ({ data: [{ code: `${type}-1`, value: type }] }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('markdown-it', () => function MarkdownIt() { return { render: text => text }; });
jest.mock('react-markdown-editor-lite', () => ({ value, onChange }) => <textarea aria-label="Mô tả" value={value}
    onChange={event => onChange({ text: event.target.value, html: `<p>${event.target.value}</p>` })} />);
jest.mock('react-datepicker', () => ({ selected, disabled }) => <input aria-label="Hạn tin" disabled={disabled}
    value={selected ? new Date(selected).toISOString().slice(0, 10) : ''} readOnly />);
jest.mock('reactstrap', () => ({ Modal: ({ isOpen, children }) => isOpen ? <div>{children}</div> : null, Spinner: () => <span>loading</span> }));
jest.mock('../../../components/modal/ReupPostModal', () => ({ isOpen, handleFunc, blocked }) => isOpen
    ? <button disabled={blocked} onClick={() => handleFunc(Date.parse('2031-01-01'))}>Xác nhận đăng lại</button> : null);
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
const revision = letter => 'jv1-' + letter.repeat(64);
const job = () => ({ id: 55, userId: 7, companyId: 9, statusCode: 'PS1', isHot: 1, timeEnd: '1700000000000',
    name: 'Tin đã tải', descriptionHTML: '<p>Cũ</p>', descriptionMarkdown: 'Cũ', amount: 2,
    categoryJobCode: 'IT', addressCode: 'OLD-CODE', salaryJobCode: null, genderPostCode: null,
    categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null, editRevision: revision('a') });
let originalMode, source;
beforeEach(() => {
    originalMode = process.env.REACT_APP_JOB_EDIT_MODE; process.env.REACT_APP_JOB_EDIT_MODE = 'core';
    jest.restoreAllMocks(); jest.clearAllMocks(); mockParams = { id: '55' }; source = job();
    localStorage.clear(); sessionStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
    axios.get.mockReset().mockImplementation(async () => ({ errCode: 0, data: { ...source } }));
    axios.put.mockReset().mockImplementation(async (path, { expectedRevision, ...patch }) => {
        source = { ...source, ...patch, statusCode: 'PS3', editRevision: revision('b') }; return { errCode: 0, data: { ...source } };
    });
    getDetailPostByIdService.mockReset(); updatePostService.mockReset();
    reupPostService.mockReset().mockImplementation(async (body, options) => ({ errCode: 0, postId: 101, sourcePostId: Number(body.postId),
        replayed: false, idempotencyKey: options.idempotencyKey }));
});
afterEach(() => { if (originalMode === undefined) delete process.env.REACT_APP_JOB_EDIT_MODE; else process.env.REACT_APP_JOB_EDIT_MODE = originalMode; });
const editor = async () => {
    const view = render(<AddPost />), name = view.container.querySelector('input[name="name"]');
    await waitFor(() => expect(name).toHaveValue('Tin đã tải')); return { ...view, name };
};
const changeName = (view, value = 'Bản sửa cần giữ') => fireEvent.change(view.name, { target: { name: 'name', value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
const reload = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại tin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ phần chưa lưu và tải lại' }));
};
test('uses only the private management read, preserves unknown/null codes and shows the separate AI/manual boundary', async () => {
    const view = await editor(); expect(axios.get).toHaveBeenCalledWith('/api/jobs/55/manage', { timeout: 15000 });
    expect(getDetailPostByIdService).not.toHaveBeenCalled();
    expect(screen.getByText(/Luồng xem\/sửa: Job Core/)).toHaveTextContent('kể cả tin trước đó duyệt thủ công');
    expect(view.container.querySelector('select[name="addressCode"]')).toHaveValue('OLD-CODE');
    expect(view.container.querySelector('select[name="salaryJobCode"]')).toHaveValue('');
    expect(screen.getByLabelText('Hạn tin')).toBeDisabled();
});
test.each(['PS1', 'PS2', 'PS3'])('no-op from %s sends no PUT or new AI request; explicit metadata edit sends only diff + loaded revision', async statusCode => {
    source.statusCode = statusCode; const view = await editor(); save();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Không có thay đổi')); expect(axios.put).not.toHaveBeenCalled();
    expect(readCoreEditPending(user, 55)).toBeNull();
    fireEvent.change(view.container.querySelector('input[name="amount"]'), { target: { name: 'amount', value: '3' } }); save();
    await screen.findByText('Trạng thái lúc tải: Chờ kiểm duyệt');
    expect(axios.put).toHaveBeenCalledWith('/api/jobs/55', { amount: 3, expectedRevision: revision('a') }, { timeout: 15000 });
    expect(updatePostService).not.toHaveBeenCalled(); expect(readCoreEditPending(user, 55)).toBeNull();
    expect(source.timeEnd).toBe('1700000000000'); expect(source.isHot).toBe(1);
});
test('successful save advances the baseline and revision; a second save only includes new changes', async () => {
    const view = await editor(); changeName(view); save(); await waitFor(() => expect(toast.success).toHaveBeenCalled());
    save(); expect(axios.put).toHaveBeenCalledTimes(1);
    axios.put.mockImplementationOnce(async (path, { expectedRevision, ...patch }) => ({ errCode: 0, data: { ...source, ...patch, editRevision: revision('c') } }));
    fireEvent.change(view.container.querySelector('input[name="amount"]'), { target: { name: 'amount', value: '4' } }); save();
    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(2));
    expect(axios.put.mock.calls[1][1]).toEqual({ amount: 4, expectedRevision: revision('b') });
    await waitFor(() => expect(readCoreEditPending(user, 55)).toBeNull());
});
test('client validation keeps fields editable and never writes storage or HTTP', async () => {
    const view = await editor(); fireEvent.change(view.container.querySelector('input[name="amount"]'), { target: { name: 'amount', value: '0' } }); save();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Số lượng')); expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    expect(axios.put).not.toHaveBeenCalled(); expect(readCoreEditPending(user, 55)).toBeNull();
});
test.each([{ errCode: 4, httpStatus: 409, errorType: 'conflict' }, { errCode: -1, errorType: 'timeout' },
    { errCode: 401, httpStatus: 401 }, { errCode: 400, httpStatus: 400 }, { errCode: 503, httpStatus: 503 }, { errCode: 0 }, null])
('response %j keeps submitted draft through refresh and rollback with no automatic read/write/fallback', async error => {
    axios.put.mockResolvedValueOnce(error); const view = await editor(); changeName(view); save(); await screen.findByRole('alert');
    expect(view.name).toHaveValue('Bản sửa cần giữ'); expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    const pending = readCoreEditPending(user, 55); expect(pending.patch).toEqual({ name: 'Bản sửa cần giữ', expectedRevision: revision('a') });
    view.unmount(); process.env.REACT_APP_JOB_EDIT_MODE = 'legacy'; const next = render(<AddPost />);
    await screen.findByText(/Lần sửa qua Job Core trước/);
    expect(next.container.querySelector('input[name="name"]')).toHaveValue('Bản sửa cần giữ');
    expect(axios.get).toHaveBeenCalledTimes(1); expect(axios.put).toHaveBeenCalledTimes(1); expect(updatePostService).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Đăng lại' })).toBeDisabled();
    expect(getDetailPostByIdService).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
});
test('only explicit discard + a valid private reread clears pending; it never claims the old PUT succeeded or replays it', async () => {
    axios.put.mockResolvedValueOnce({ errCode: -1, errorType: 'timeout' }); const view = await editor(); changeName(view); save();
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Tải lại tin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Giữ biểu mẫu' })); expect(view.name).toHaveValue('Bản sửa cần giữ');
    expect(axios.get).toHaveBeenCalledTimes(1); source = { ...source, name: 'Bản hiện tại', editRevision: revision('c') };
    process.env.REACT_APP_JOB_EDIT_MODE = 'legacy'; reload(); await waitFor(() => expect(view.name).toHaveValue('Bản hiện tại'));
    expect(readCoreEditPending(user, 55)).toBeNull(); expect(toast.success).not.toHaveBeenCalled(); expect(axios.put).toHaveBeenCalledTimes(1);
    changeName(view, 'Sửa lần mới'); save(); await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(axios.put.mock.calls[1][1]).toEqual({ name: 'Sửa lần mới', expectedRevision: revision('c') });
    expect(getDetailPostByIdService).not.toHaveBeenCalled(); expect(updatePostService).not.toHaveBeenCalled();
});
test.each([{ errCode: 503 }, { errCode: 0, data: { ...job(), editRevision: null } }])('failed/incomplete reconciliation %j keeps draft and storage, never falls back', async response => {
    axios.put.mockResolvedValueOnce({ errCode: -1 }); const view = await editor(); changeName(view); save(); await screen.findByRole('alert');
    const pending = readCoreEditPending(user, 55); axios.get.mockResolvedValueOnce(response); reload();
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2)); await screen.findByRole('alert');
    expect(view.name).toHaveValue('Bản sửa cần giữ'); expect(readCoreEditPending(user, 55)).toEqual(pending);
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled(); expect(getDetailPostByIdService).not.toHaveBeenCalled();
});
test('double click submits once and freezes fields; late response cannot overwrite a different job view', async () => {
    let finish; axios.put.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await editor(); changeName(view); save(); save(); expect(axios.put).toHaveBeenCalledTimes(1); expect(view.name).toBeDisabled();
    mockParams = { id: '56' }; source = { ...job(), id: 56, name: 'Tin khác' }; view.rerender(<AddPost />);
    await waitFor(() => expect(view.name).toHaveValue('Tin khác'));
    await act(async () => finish({ errCode: 0, data: { ...job(), name: 'Bản sửa cần giữ', statusCode: 'PS3', editRevision: revision('b') } }));
    expect(view.name).toHaveValue('Tin khác'); expect(toast.success).not.toHaveBeenCalled(); expect(readCoreEditPending(user, 55)).toBeNull();
});
test('a late private read cannot overwrite a different route', async () => {
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<AddPost />); mockParams = { id: '56' }; source = { ...job(), id: 56, name: 'Tin khác' }; view.rerender(<AddPost />);
    const name = view.container.querySelector('input[name="name"]'); await waitFor(() => expect(name).toHaveValue('Tin khác'));
    await act(async () => finish({ errCode: 0, data: job() })); expect(name).toHaveValue('Tin khác');
});
test.each([{ errCode: 404, httpStatus: 404 }, { errCode: 503 }, { errCode: 0, data: { ...job(), companyId: 99 } },
    { errCode: 0, data: { ...job(), salaryJobCode: undefined } }])('read %j fails closed without public/legacy fallback', async response => {
    axios.get.mockResolvedValueOnce(response); render(<AddPost />); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled(); expect(getDetailPostByIdService).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalledTimes(1); expect(axios.put).not.toHaveBeenCalled();
});
test.each([{ editRevision: null }, { timeEnd: 'bad' }, { statusCode: 'PS4' }])('invalid revision/date or blocked status %j disables write/repost', async patch => {
    source = { ...source, ...patch }; await editor(); expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    const button = screen.queryByRole('button', { name: 'Đăng lại' }); if (button) expect(button).toBeDisabled();
    expect(axios.put).not.toHaveBeenCalled();
});
test('ADMIN still only views, even with Core enabled and no company', async () => {
    localStorage.setItem('userData', JSON.stringify({ id: 1, roleCode: 'ADMIN' })); const view = await editor();
    expect(screen.queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument(); expect(view.name).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Đăng lại' })).not.toBeInTheDocument(); expect(axios.put).not.toHaveBeenCalled();
});
test('account/company change after loading blocks PUT before persistence', async () => {
    const view = await editor(); changeName(view); localStorage.setItem('userData', JSON.stringify({ ...user, companyId: 10 })); save();
    await screen.findByRole('alert'); expect(axios.put).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
});
test('transport throw retains submitted draft and original revision', async () => {
    axios.put.mockRejectedValueOnce(new Error('Connection lost')); const view = await editor(); changeName(view); save();
    await screen.findByRole('alert'); expect(view.name).toHaveValue('Bản sửa cần giữ'); expect(readCoreEditPending(user, 55).patch.expectedRevision).toBe(revision('a'));
});
test('storage failure before dispatch keeps form and sends nothing', async () => {
    const view = await editor(); changeName(view); jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); }); save();
    await screen.findByRole('alert'); expect(axios.put).not.toHaveBeenCalled(); expect(view.name).toHaveValue('Bản sửa cần giữ');
});
test.each(['config', 'storage'])('invalid %s cannot reroute to legacy', async problem => {
    if (problem === 'config') process.env.REACT_APP_JOB_EDIT_MODE = 'CORE';
    else sessionStorage.setItem('jobfind:core-edit:v1:8:9:55', '{bad');
    render(<AddPost />); await screen.findByRole('alert'); expect(axios.get).not.toHaveBeenCalled(); expect(getDetailPostByIdService).not.toHaveBeenCalled();
});
test('fresh repost still uses the legacy writer and guarded current revision, without changing the unsaved Core edit', async () => {
    const view = await editor(); changeName(view); fireEvent.click(screen.getByRole('button', { name: 'Đăng lại' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đăng lại' })); await screen.findByRole('button', { name: 'Xem tin đăng lại' });
    expect(reupPostService).toHaveBeenCalledWith({ userId: 8, postId: '55', timeEnd: Date.parse('2031-01-01'), expectedRevision: revision('a') },
        { idempotencyKey: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(axios.post).not.toHaveBeenCalled(); expect(axios.put).not.toHaveBeenCalled(); expect(view.name).toHaveValue('Bản sửa cần giữ');
});
test('a newer pending record appearing while reconciliation reads cannot be cleared by the older view', async () => {
    axios.put.mockResolvedValueOnce({ errCode: -1 }); const view = await editor(); changeName(view); save(); await screen.findByRole('alert');
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); reload();
    // Simulate another editor of this same tab replacing the evidence after it
    // separately reconciled the old record. The stale view must fail its CAS.
    sessionStorage.removeItem('jobfind:core-edit:v1:8:9:55');
    const base = readCoreJobSnapshot({ errCode: 0, data: source }, 55, user);
    const newer = prepareCoreEditPending(user, base, { ...base.form, name: 'Thao tác mới' });
    await act(async () => finish({ errCode: 0, data: source }));
    expect(readCoreEditPending(user, 55)).toEqual(newer); expect(view.name).toHaveValue('Bản sửa cần giữ');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
});
test('a legacy view cannot write around a newly pending Core edit; reload discovers and pins that Core intent without clearing it', async () => {
    process.env.REACT_APP_JOB_EDIT_MODE = 'legacy'; getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: source });
    const view = await editor(); changeName(view, 'Nháp legacy');
    const base = readCoreJobSnapshot({ errCode: 0, data: source }, 55, user);
    const pending = prepareCoreEditPending(user, base, { ...base.form, name: 'Nháp Core đã gửi' });
    save(); await screen.findByRole('alert'); expect(updatePostService).not.toHaveBeenCalled(); expect(view.name).toHaveValue('Nháp legacy');
    reload(); await waitFor(() => expect(view.name).toHaveValue('Nháp Core đã gửi'));
    expect(readCoreEditPending(user, 55)).toEqual(pending); expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalled(); expect(axios.put).not.toHaveBeenCalled();
    expect(screen.getByText(/Luồng xem\/sửa: Job Core/)).toBeInTheDocument();
});
