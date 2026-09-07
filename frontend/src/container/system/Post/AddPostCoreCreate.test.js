import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import axios from '../../../axios';
import { createPostService, getDetailCompanyByUserId, getDetailPostByIdService, updatePostService, reupPostService } from '../../../service/userService';
import { prepareLegacyCreateAttempt, settleLegacyCreateAttempt } from '../../../service/legacyCreateAttempt';
import { prepareJobCreateAttempt, settleJobCreateAttempt, readJobCreateAttempt } from '../../../service/jobCreateAttempt';
import AddPost from './AddPost';

let mockParams = {};
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useParams: () => mockParams, useNavigate: () => mockNavigate }));
jest.mock('../../../axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../../../service/userService', () => ({ createPostService: jest.fn(), getDetailCompanyByUserId: jest.fn(),
    getDetailPostByIdService: jest.fn(), updatePostService: jest.fn(), reupPostService: jest.fn() }));
jest.mock('../../../util/fetch', () => ({ useFetchAllcode: type => ({ data: [{ code: `${type}-1`, value: type }] }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('markdown-it', () => function MarkdownIt() { return { render: text => text }; });
jest.mock('react-markdown-editor-lite', () => ({ value, onChange }) => <textarea aria-label="Mô tả" value={value}
    onChange={event => onChange({ text: event.target.value, html: `<p>${event.target.value}</p>` })} />);
jest.mock('react-datepicker', () => ({ selected, disabled, onChange }) => <input aria-label="Hạn tin" disabled={disabled}
    value={selected ? new Date(selected).toISOString().slice(0, 10) : ''}
    onChange={event => onChange(new Date(`${event.target.value}T00:00:00Z`))} />);
jest.mock('reactstrap', () => ({ Modal: ({ isOpen, children }) => isOpen ? <div>{children}</div> : null, Spinner: () => <span>loading</span> }));
jest.mock('../../../components/modal/ReupPostModal', () => () => null);
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
const keyName = 'jobfind:core-create:v1:8:9';
const serverReceipt = body => ({ errCode: 0, data: { ...body, amount: Number(body.amount), timeEnd: String(body.timeEnd),
    id: 101, userId: 8, companyId: 9, statusCode: 'PS3' } });
let originalMode;
beforeEach(() => {
    originalMode = process.env.REACT_APP_JOB_CREATE_MODE; process.env.REACT_APP_JOB_CREATE_MODE = 'core';
    jest.restoreAllMocks(); jest.clearAllMocks(); mockParams = {};
    localStorage.clear(); sessionStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
    getDetailCompanyByUserId.mockReset().mockResolvedValue({ errCode: 0, data: { allowPost: 3, allowHotPost: 1 } });
    axios.post.mockReset().mockImplementation(async (path, body) => serverReceipt(body));
    createPostService.mockReset().mockImplementation(async (body, options) => ({ errCode: 0, postId: 202,
        idempotencyKey: options.idempotencyKey, replayed: true }));
    getDetailPostByIdService.mockReset().mockResolvedValue({ errCode: 0, data: { id: 77, userId: 8, companyId: 9,
        name: 'Tin đã tải', descriptionHTML: '<p>Old</p>', descriptionMarkdown: 'Old', amount: 1,
        timeEnd: '1900000000000', isHot: 0, statusCode: 'PS1', editRevision: 'jv1-' + 'a'.repeat(64) } });
});
afterEach(() => {
    if (originalMode === undefined) delete process.env.REACT_APP_JOB_CREATE_MODE;
    else process.env.REACT_APP_JOB_CREATE_MODE = originalMode;
});
const creator = async () => {
    const view = render(<AddPost />); await screen.findByText('3 bài bình thường');
    const name = view.container.querySelector('input[name="name"]');
    fireEvent.change(name, { target: { name: 'name', value: 'Backend Engineer' } });
    fireEvent.change(view.container.querySelector('input[name="amount"]'), { target: { name: 'amount', value: '2' } });
    fireEvent.change(screen.getByLabelText('Hạn tin'), { target: { value: '2030-01-02' } });
    fireEvent.change(screen.getByLabelText('Mô tả'), { target: { value: 'Build APIs' } });
    return { ...view, name };
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
const retry = async () => {
    const button = await screen.findByRole('button', { name: 'Đối chiếu / gửi lại cùng mã' });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
};
test('new Core create uses the existing validated form adapter, persists before HTTP and confirms without auto-navigation', async () => {
    const view = await creator(); fireEvent.click(view.container.querySelector('input[type="checkbox"]'));
    axios.post.mockImplementation(async (path, body, options) => {
        expect(JSON.parse(sessionStorage.getItem(keyName))).toMatchObject({ writer: 'core', status: 'pending',
            key: options.headers['Idempotency-Key'], payload: body });
        return serverReceipt(body);
    });
    save(); await screen.findByRole('button', { name: 'Xem tin đã tạo' });
    expect(axios.post).toHaveBeenCalledWith('/api/jobs', {
        name: 'Backend Engineer', descriptionHTML: '<p>Build APIs</p>', descriptionMarkdown: 'Build APIs', amount: 2,
        categoryJobCode: 'JOBTYPE-1', addressCode: 'PROVINCE-1', salaryJobCode: 'SALARYTYPE-1',
        categoryJoblevelCode: 'JOBLEVEL-1', categoryWorktypeCode: 'WORKTYPE-1', experienceJobCode: 'EXPTYPE-1',
        genderPostCode: 'GENDERPOST-1', timeEnd: Date.parse('2030-01-02T00:00:00Z'), isHot: 1
    }, { timeout: 15000, headers: { 'Idempotency-Key': expect.stringMatching(/^[a-f0-9]{32}$/) } });
    expect(screen.getByText(/AI kiểm duyệt tiêu đề/)).toBeInTheDocument();
    expect(screen.getByText(/không phải trạng thái duyệt hiện tại/)).toBeInTheDocument();
    expect(screen.getByText(/chờ duyệt thủ công/)).toBeInTheDocument();
    expect(createPostService).not.toHaveBeenCalled(); expect(mockNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(getDetailCompanyByUserId).toHaveBeenCalledTimes(2));
    expect(getDetailCompanyByUserId).toHaveBeenLastCalledWith(8, 9);
    fireEvent.click(screen.getByRole('button', { name: 'Xem tin đã tạo' })); expect(mockNavigate).toHaveBeenCalledWith('/admin/edit-post/101/');
});
test.each(['0', '100001', '1.5', ''])('invalid count %s keeps the form editable, sends nothing and stores no intent', async amount => {
    const view = await creator(); fireEvent.change(view.container.querySelector('input[name="amount"]'), { target: { name: 'amount', value: amount } }); save();
    expect(toast.error).toHaveBeenCalledWith('Số lượng nhân viên phải là số nguyên từ 1 đến 100000');
    expect(axios.post).not.toHaveBeenCalled(); expect(sessionStorage.getItem(keyName)).toBeNull(); expect(view.name).toBeEnabled();
});
test.each([{ errCode: -1, errorType: 'timeout' }, { errCode: 503, httpStatus: 503 },
    { errCode: 404, httpStatus: 404 }, { errCode: 401, httpStatus: 401 }])('refresh/rollback after %j restores the same Core writer/payload/key with only explicit retry', async error => {
    axios.post.mockResolvedValueOnce(error); const first = await creator(); save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled()); const original = axios.post.mock.calls[0]; first.unmount();
    process.env.REACT_APP_JOB_CREATE_MODE = 'legacy';
    const next = render(<AddPost />); await screen.findByText('3 bài bình thường');
    expect(screen.getByText(/Luồng tạo tin: Job Core/)).toBeInTheDocument();
    expect(next.container.querySelector('input[name="name"]')).toHaveValue('Backend Engineer');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled(); expect(axios.post).toHaveBeenCalledTimes(1);
    await retry(); await screen.findByRole('button', { name: 'Xem tin đã tạo' });
    expect(axios.post.mock.calls[1]).toEqual(original); expect(createPostService).not.toHaveBeenCalled();
});
test('expired sent deadline is replayed unchanged after remount, without new-post date validation', async () => {
    axios.post.mockResolvedValueOnce({ errCode: -1, errorType: 'timeout' }); const first = await creator(); save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled()); first.unmount();
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2031-01-01T00:00:00Z'));
    render(<AddPost />); await retry(); await screen.findByRole('button', { name: 'Xem tin đã tạo' });
    expect(axios.post.mock.calls[1]).toEqual(axios.post.mock.calls[0]);
});
test.each(['pending', 'rejected', 'succeeded', 'blocked'])('enabling Core preserves a saved legacy %s intent and its review mode', async status => {
    const old = prepareLegacyCreateAttempt(user, { userId: 8, name: 'Legacy draft', timeEnd: Date.parse('2030-01-02T00:00:00Z') }, null);
    settleLegacyCreateAttempt(user, old, { status, ...(status === 'succeeded' && { postId: 202 }) });
    render(<AddPost />); await screen.findByText('3 bài bình thường');
    expect(screen.getByText(/Luồng tạo tin: backend cũ/)).toBeInTheDocument(); expect(axios.post).not.toHaveBeenCalled();
    if (status === 'pending') { await retry(); await screen.findByRole('button', { name: 'Xem tin đã tạo' }); }
    if (status === 'rejected') { save(); await screen.findByRole('button', { name: 'Xem tin đã tạo' }); }
    if (['pending', 'rejected'].includes(status)) expect(createPostService.mock.calls[0][1].idempotencyKey).toBe(old.key);
    expect(axios.post).not.toHaveBeenCalled();
});
test('only explicit new-post action after success picks up the new mode; rollback keeps Core receipts', async () => {
    const first = await creator(); save(); await screen.findByRole('button', { name: 'Xem tin đã tạo' }); first.unmount();
    process.env.REACT_APP_JOB_CREATE_MODE = 'legacy'; render(<AddPost />);
    await screen.findByRole('button', { name: 'Tạo tin khác' }); expect(screen.getByText(/Luồng tạo tin: Job Core/)).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Tạo tin khác' }));
    expect(screen.getByText(/Luồng tạo tin: backend cũ/)).toBeInTheDocument(); expect(readJobCreateAttempt(user)).toBeNull();
    expect(createPostService).not.toHaveBeenCalled();
});
test.each([400, 409, 429])('correction after HTTP %s keeps its key/writer and does not fall back', async httpStatus => {
    axios.post.mockResolvedValueOnce({ errCode: httpStatus, httpStatus, errMessage: 'Yêu cầu bị từ chối' });
    const view = await creator(); save(); await waitFor(() => expect(view.name).toBeEnabled());
    const oldKey = axios.post.mock.calls[0][2].headers['Idempotency-Key']; process.env.REACT_APP_JOB_CREATE_MODE = 'legacy';
    fireEvent.change(view.name, { target: { name: 'name', value: 'Corrected' } }); save(); await screen.findByRole('button', { name: 'Xem tin đã tạo' });
    expect(axios.post.mock.calls[1][1].name).toBe('Corrected'); expect(axios.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(oldKey);
    expect(createPostService).not.toHaveBeenCalled();
});
test.each([{ errCode: 0, postId: 101 }, { errCode: 0, data: { id: 101, statusCode: 'PS3' } }])('malformed success %j stays blocked through refresh, with no success toast/new key', async response => {
    axios.post.mockResolvedValueOnce(response); const first = await creator(); save(); await screen.findByText(/Mã thao tác hoặc phản hồi không khớp/);
    expect(toast.success).not.toHaveBeenCalled(); first.unmount(); render(<AddPost />);
    await screen.findByText(/Mã thao tác hoặc phản hồi không khớp/); expect(screen.queryByRole('button', { name: 'Tạo tin khác' })).not.toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(1); expect(createPostService).not.toHaveBeenCalled();
});
test('double click sends once; late response persists without changing the editor after route change', async () => {
    let finish; axios.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await creator(); save(); save(); expect(axios.post).toHaveBeenCalledTimes(1);
    mockParams = { id: '77' }; view.rerender(<AddPost />);
    await waitFor(() => expect(view.name).toHaveValue('Tin đã tải'));
    await act(async () => finish(serverReceipt(axios.post.mock.calls[0][1])));
    expect(view.name).toHaveValue('Tin đã tải'); expect(toast.success).not.toHaveBeenCalled();
    expect(readJobCreateAttempt(user)).toMatchObject({ status: 'succeeded', postId: 101 });
    expect(updatePostService).not.toHaveBeenCalled(); expect(reupPostService).not.toHaveBeenCalled();
    mockParams = {}; view.rerender(<AddPost />); await screen.findByRole('button', { name: 'Xem tin đã tạo' });
    expect(axios.post).toHaveBeenCalledTimes(1);
});
test('identity change before retry blocks dispatch and leaves the original scoped intent', async () => {
    axios.post.mockResolvedValueOnce({ errCode: -1, errorType: 'network' }); await creator(); save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled()); localStorage.setItem('userData', JSON.stringify({ ...user, companyId: 10 }));
    await retry(); await screen.findByText(/Tài khoản hoặc công ty đã thay đổi/);
    expect(axios.post).toHaveBeenCalledTimes(1); expect(readJobCreateAttempt(user).status).toBe('pending');
});
test('unwritable storage preserves the draft without any POST', async () => {
    const view = await creator(); jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); }); save();
    await screen.findByText('Storage full'); expect(view.name).toHaveValue('Backend Engineer'); expect(axios.post).not.toHaveBeenCalled();
});
test.each(['pending', 'rejected'])('restored Core %s preserves null classifications instead of choosing the first option', async status => {
    const sent = prepareJobCreateAttempt(user, { name: 'Stored draft', descriptionHTML: '<p>Stored</p>', descriptionMarkdown: 'Stored',
        categoryJobCode: 'JOBTYPE-1', salaryJobCode: null, addressCode: null, genderPostCode: null,
        categoryWorktypeCode: null, categoryJoblevelCode: null, experienceJobCode: null,
        amount: 2, timeEnd: Date.parse('2030-01-02T00:00:00Z'), isHot: 0 }, null, 'core');
    settleJobCreateAttempt(user, sent, { status });
    const view = render(<AddPost />); await screen.findByText('3 bài bình thường');
    for (const field of ['salaryJobCode', 'addressCode', 'genderCode']) expect(view.container.querySelector(`select[name="${field}"]`)).toHaveValue('');
    if (status === 'pending') await retry(); else save();
    await screen.findByRole('button', { name: 'Xem tin đã tạo' });
    expect(axios.post.mock.calls[0][1]).toMatchObject({ salaryJobCode: null, addressCode: null, genderPostCode: null });
    expect(axios.post.mock.calls[0][2].headers['Idempotency-Key']).toBe(sent.key);
});
test.each(['bad-config', 'corrupt-core', 'corrupt-legacy'])('%s blocks fresh creation without rerouting or deleting evidence', async problem => {
    if (problem === 'bad-config') process.env.REACT_APP_JOB_CREATE_MODE = 'CORE';
    else sessionStorage.setItem(problem === 'corrupt-core' ? keyName : 'jobfind:legacy-create:v1:8:9', '{bad');
    render(<AddPost />); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled(); expect(axios.post).not.toHaveBeenCalled(); expect(createPostService).not.toHaveBeenCalled();
});
