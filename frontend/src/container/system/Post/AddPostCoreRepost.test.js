import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import axios from '../../../axios';
import { getDetailPostByIdService, updatePostService, reupPostService } from '../../../service/userService';
import { prepareLegacyRepostAttempt, settleLegacyRepostAttempt } from '../../../service/legacyRepostAttempt';
import { readCoreJobSnapshot, prepareCoreEditPending } from '../../../service/jobEditSession';
import { readJobRepostAttempt, prepareJobRepostAttempt, coreRepostSource } from '../../../service/jobRepostAttempt';
import AddPost from './AddPost';

let mockParams = { id: '55' }, mockDeadline = Date.parse('2031-01-01');
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
jest.mock('../../../components/modal/ReupPostModal', () => ({ isOpen, handleFunc, blocked, reviewMode }) => isOpen
    ? <button data-mode={reviewMode} disabled={blocked} onClick={() => handleFunc(mockDeadline)}>Xác nhận đăng lại</button> : null);
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
const revision = letter => 'jv1-' + letter.repeat(64);
const job = () => ({ id: 55, userId: 7, companyId: 9, statusCode: 'PS1', isHot: 1, timeEnd: '1700000000000',
    name: 'Tin đã tải', descriptionHTML: '<p>Cũ</p>', descriptionMarkdown: 'Cũ', amount: 2,
    categoryJobCode: 'IT', addressCode: 'OLD', salaryJobCode: null, genderPostCode: null,
    categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null, editRevision: revision('a') });
let source, originalEditMode, originalRepostMode;
const receipt = sent => ({ errCode: 0, data: { ...sent.expected, id: 101, userId: 8, companyId: 9,
    statusCode: 'PS3', timeEnd: String(sent.payload.timeEnd) } });
const pending = () => prepareJobRepostAttempt(user, 55, { timeEnd: mockDeadline, expectedRevision: revision('a') }, null, 'core',
    coreRepostSource({ errCode: 0, data: job() }, 55, user, revision('a')));
beforeEach(() => {
    originalEditMode = process.env.REACT_APP_JOB_EDIT_MODE; originalRepostMode = process.env.REACT_APP_JOB_REPOST_MODE;
    process.env.REACT_APP_JOB_EDIT_MODE = 'legacy'; process.env.REACT_APP_JOB_REPOST_MODE = 'core';
    jest.restoreAllMocks(); jest.clearAllMocks(); mockParams = { id: '55' }; mockDeadline = Date.parse('2031-01-01'); source = job();
    localStorage.clear(); sessionStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
    axios.get.mockReset().mockImplementation(async () => ({ errCode: 0, data: { ...source } })); axios.put.mockReset();
    axios.post.mockReset().mockImplementation(async () => receipt(readJobRepostAttempt(user, 55)));
    getDetailPostByIdService.mockReset().mockImplementation(async () => ({ errCode: 0, data: { ...source } }));
    updatePostService.mockReset(); reupPostService.mockReset().mockImplementation(async (body, options) => ({ errCode: 0, postId: 101,
        sourcePostId: Number(body.postId), replayed: false, idempotencyKey: options.idempotencyKey }));
});
afterEach(() => {
    if (originalEditMode === undefined) delete process.env.REACT_APP_JOB_EDIT_MODE; else process.env.REACT_APP_JOB_EDIT_MODE = originalEditMode;
    if (originalRepostMode === undefined) delete process.env.REACT_APP_JOB_REPOST_MODE; else process.env.REACT_APP_JOB_REPOST_MODE = originalRepostMode;
});
const editor = async () => {
    const view = render(<AddPost />), name = await screen.findByDisplayValue(source.name);
    return { ...view, name };
};
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Đăng lại' }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đăng lại' }));
const retry = () => fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu đăng lại cùng mã' }));
const change = view => fireEvent.change(view.name, { target: { name: 'name', value: 'Bản sửa chưa lưu' } });
const reload = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại tin' })); fireEvent.click(screen.getByRole('button', { name: 'Bỏ phần chưa lưu và tải lại' }));
};
test.each(['legacy', 'core'])('Core repost independent of %s editor; copies private stored source, not unsaved draft; explicit navigation only', async mode => {
    process.env.REACT_APP_JOB_EDIT_MODE = mode; const view = await editor(); change(view); open();
    expect(screen.getByRole('button', { name: 'Xác nhận đăng lại' })).toHaveAttribute('data-mode', 'core'); confirm();
    await screen.findByRole('button', { name: 'Xem tin đăng lại' });
    const sent = readJobRepostAttempt(user, 55); expect(sent.expected.name).toBe('Tin đã tải'); expect(view.name).toHaveValue('Bản sửa chưa lưu');
    expect(axios.get).toHaveBeenLastCalledWith('/api/jobs/55/manage', { timeout: 15000 });
    expect(axios.post).toHaveBeenCalledWith('/api/jobs/55/repost', { timeEnd: mockDeadline, expectedRevision: revision('a') },
        { timeout: 15000, headers: { 'Idempotency-Key': sent.key } });
    expect(axios.put).not.toHaveBeenCalled(); expect(updatePostService).not.toHaveBeenCalled(); expect(reupPostService).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled(); expect(screen.getByText(/Luồng đăng lại: Job Core/)).toHaveTextContent('chưa được công khai');
    fireEvent.click(screen.getByRole('button', { name: 'Xem tin đăng lại' })); expect(mockNavigate).toHaveBeenCalledWith('/admin/edit-post/101/');
});
test('default legacy performs no Core preflight or POST and shows manual moderation', async () => {
    delete process.env.REACT_APP_JOB_REPOST_MODE; await editor(); open(); confirm(); await screen.findByRole('button', { name: 'Xem tin đăng lại' });
    expect(reupPostService).toHaveBeenCalledTimes(1); expect(axios.get).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
    expect(screen.getByText(/Luồng đăng lại: backend cũ/)).toHaveTextContent('duyệt thủ công');
});
test('view pins mode before a request is created; changing build flag never reroutes an open form', async () => {
    await editor(); process.env.REACT_APP_JOB_REPOST_MODE = 'legacy'; open(); confirm();
    await screen.findByRole('button', { name: 'Xem tin đăng lại' }); expect(axios.post).toHaveBeenCalledTimes(1); expect(reupPostService).not.toHaveBeenCalled();
});
test.each([{ errCode: 503 }, { errCode: 404 }, { errCode: 0, data: { ...job(), companyId: 99 } },
    { errCode: 0, data: { ...job(), editRevision: revision('b') } }, { errCode: 0, data: { ...job(), editRevision: null } },
    { errCode: 0, data: { ...job(), statusCode: 'PS4' } }, { errCode: 0, data: { ...job(), timeEnd: String(Date.parse('2035-01-01')) } }])
('preflight %j preserves unsaved form and cannot silently rebase, persist or POST', async response => {
    const view = await editor(); change(view); axios.get.mockResolvedValueOnce(response); open(); confirm(); await screen.findByRole('alert');
    expect(view.name).toHaveValue('Bản sửa chưa lưu'); expect(sessionStorage.length).toBe(0); expect(axios.post).not.toHaveBeenCalled();
    expect(reupPostService).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Tải lại tin' })).toBeEnabled();
});
test('double confirm and Save during source preflight cannot create overlapping writes', async () => {
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await editor(); change(view); open(); confirm(); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(axios.get).toHaveBeenCalledTimes(1); expect(updatePostService).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
    await act(async () => finish({ errCode: 0, data: job() })); await screen.findByRole('button', { name: 'Xem tin đăng lại' });
    expect(axios.post).toHaveBeenCalledTimes(1);
});
test('late source preflight after route change never persists or posts the old intent', async () => {
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = await editor(); open(); confirm();
    mockParams = { id: '56' }; source = { ...job(), id: 56, name: 'Tin khác' }; view.rerender(<AddPost />);
    await waitFor(() => expect(view.name).toHaveValue('Tin khác'));
    await act(async () => finish({ errCode: 0, data: job() })); expect(axios.post).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
});
test('identity switch during preflight never persists/posts; same account must reload explicitly', async () => {
    let finish; axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await editor(); open(); confirm();
    localStorage.setItem('userData', JSON.stringify({ ...user, companyId: 10 })); await act(async () => finish({ errCode: 0, data: job() }));
    await screen.findByRole('alert'); expect(axios.post).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
});
test.each([{ errCode: -1, errorType: 'timeout' }, { errCode: 401, httpStatus: 401 }, { errCode: 404, httpStatus: 404 }, { errCode: 503, httpStatus: 503 }])
('uncertain POST %j survives reload/rollback and missing source; explicit retry has no new preflight/date/key', async response => {
    axios.post.mockResolvedValueOnce(response); const view = await editor(); open(); confirm();
    await screen.findByRole('button', { name: 'Đối chiếu đăng lại cùng mã' }); const sent = readJobRepostAttempt(user, 55);
    view.unmount(); process.env.REACT_APP_JOB_REPOST_MODE = 'legacy'; getDetailPostByIdService.mockResolvedValueOnce({ errCode: 404 });
    jest.spyOn(Date, 'now').mockReturnValue(mockDeadline + 1); render(<AddPost />); await screen.findByRole('alert');
    expect(axios.post).toHaveBeenCalledTimes(1); retry(); await screen.findByRole('button', { name: 'Xem tin đăng lại' });
    expect(axios.get).toHaveBeenCalledTimes(1); expect(axios.post.mock.calls[1]).toEqual(axios.post.mock.calls[0]);
    expect(readJobRepostAttempt(user, 55)).toMatchObject({ key: sent.key, status: 'succeeded', expected: sent.expected }); expect(reupPostService).not.toHaveBeenCalled();
});
test('thrown transport error retains record with no fallback; malformed success locks new/retry actions', async () => {
    axios.post.mockRejectedValueOnce(new Error('lost')); const view = await editor(); change(view); open(); confirm();
    await screen.findByRole('button', { name: 'Đối chiếu đăng lại cùng mã' }); const sent = readJobRepostAttempt(user, 55);
    axios.post.mockResolvedValueOnce({ errCode: 0, data: { ...receipt(sent).data, name: 'Wrong copy' } }); retry();
    await waitFor(() => expect(readJobRepostAttempt(user, 55).status).toBe('blocked'));
    expect(screen.queryByRole('button', { name: 'Đối chiếu đăng lại cùng mã' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng lại' })).toBeDisabled(); expect(view.name).toHaveValue('Bản sửa chưa lưu');
    expect(toast.success).not.toHaveBeenCalled(); expect(reupPostService).not.toHaveBeenCalled();
});
test('409 requires explicit source reload; correction retains original key/writer but updates revision/copy/deadline', async () => {
    axios.post.mockResolvedValueOnce({ errCode: 2, httpStatus: 409, errorType: 'conflict' }); const view = await editor(); open(); confirm();
    await screen.findByRole('alert'); const sent = readJobRepostAttempt(user, 55); expect(sent.status).toBe('rejected');
    source = { ...source, name: 'Tin hiện tại', editRevision: revision('b') }; process.env.REACT_APP_JOB_REPOST_MODE = 'legacy'; reload();
    await waitFor(() => expect(view.name).toHaveValue('Tin hiện tại')); mockDeadline += 86400000; open(); confirm();
    await screen.findByRole('button', { name: 'Xem tin đăng lại' }); const next = readJobRepostAttempt(user, 55);
    expect(next).toMatchObject({ key: sent.key, writer: 'core', payload: { expectedRevision: revision('b'), timeEnd: mockDeadline }, expected: { name: 'Tin hiện tại' } });
    expect(reupPostService).not.toHaveBeenCalled();
});
test('late valid POST settles only old source record without changing the new view or navigating', async () => {
    let finish; axios.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = await editor(); open(); confirm();
    await waitFor(() => expect(axios.post).toHaveBeenCalled()); const sent = readJobRepostAttempt(user, 55);
    mockParams = { id: '56' }; source = { ...job(), id: 56, name: 'Tin khác' }; view.rerender(<AddPost />); await waitFor(() => expect(view.name).toHaveValue('Tin khác'));
    await act(async () => finish(receipt(sent))); expect(readJobRepostAttempt(user, 55).status).toBe('succeeded');
    expect(view.name).toHaveValue('Tin khác'); expect(toast.success).not.toHaveBeenCalled(); expect(mockNavigate).not.toHaveBeenCalled();
});
test.each(['pending', 'rejected', 'blocked', 'succeeded'])('existing legacy %s pins the old path when Core is enabled', async status => {
    const payload = { userId: 8, postId: '55', timeEnd: mockDeadline, expectedRevision: revision('a') };
    const old = prepareLegacyRepostAttempt(user, 55, payload, null);
    settleLegacyRepostAttempt(user, 55, old, { status, ...(status === 'succeeded' && { postId: 101 }) }); await editor();
    expect(screen.getByText(/Luồng đăng lại: backend cũ/)).toBeInTheDocument();
    if (status === 'pending') retry();
    if (status === 'rejected') { open(); confirm(); }
    if (['pending', 'rejected'].includes(status)) {
        await screen.findByRole('button', { name: 'Xem tin đăng lại' });
    }
    expect(reupPostService.mock.calls).toEqual(['pending', 'rejected'].includes(status) ? [[payload, { idempotencyKey: old.key }]] : []);
    expect(axios.get).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
});
test.each(['collision', 'corrupt', 'config'])('%s blocks fresh repost without removing evidence or blocking the separate editor', async problem => {
    if (problem === 'collision') { pending(); prepareLegacyRepostAttempt(user, 55, { userId: 8, postId: '55', timeEnd: mockDeadline, expectedRevision: revision('a') }, null); }
    if (problem === 'corrupt') sessionStorage.setItem('jobfind:core-repost:v1:8:9:55', '{bad');
    if (problem === 'config') process.env.REACT_APP_JOB_REPOST_MODE = 'CORE';
    const size = sessionStorage.length; await editor(); expect(screen.getByRole('button', { name: 'Đăng lại' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled(); expect(sessionStorage.length).toBe(size); expect(axios.post).not.toHaveBeenCalled();
});
test('pending Core repost remains explicitly replayable with invalid flag and an unresolved Core edit, without automatic read or write', async () => {
    const sent = pending(), base = readCoreJobSnapshot({ errCode: 0, data: job() }, 55, user);
    prepareCoreEditPending(user, base, { ...base.form, name: 'Bản sửa cần đối chiếu' }); process.env.REACT_APP_JOB_REPOST_MODE = 'typo';
    render(<AddPost />); await screen.findByText(/Lần sửa qua Job Core trước/); expect(axios.get).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
    retry(); await screen.findByRole('button', { name: 'Xem tin đăng lại' }); expect(axios.get).not.toHaveBeenCalled();
    expect(readJobRepostAttempt(user, 55)).toMatchObject({ key: sent.key, status: 'succeeded' });
});
test('storage failure after source preflight preserves form and sends nothing', async () => {
    const view = await editor(); change(view); jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Storage full'); });
    open(); confirm(); await screen.findByRole('alert'); expect(axios.get).toHaveBeenCalledTimes(1); expect(axios.post).not.toHaveBeenCalled();
    expect(view.name).toHaveValue('Bản sửa chưa lưu');
});
