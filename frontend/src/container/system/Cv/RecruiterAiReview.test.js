import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import RecruiterAiReview from './RecruiterAiReview';
import { getCandidateSearchJobs } from '../../../service/cvService';
import { matchCvPdfAi, getAiTask } from '../../../service/aiSearchService';
import { resolvePdfSource } from '../../../components/documents/documentSource';
import { recruiterIntentKey } from '../../../service/recruiterAi';
import { SESSION_ENDED_EVENT } from '../../../auth/sessionExpiry';

jest.mock('../../../service/cvService', () => ({ getCandidateSearchJobs: jest.fn() }));
jest.mock('../../../service/aiSearchService', () => ({
    createAiRequestOptions: () => ({ idempotencyKey: 'a'.repeat(32) }), matchCvPdfAi: jest.fn(), getAiTask: jest.fn(),
}));
jest.mock('../../../components/documents/documentSource', () => ({ resolvePdfSource: jest.fn() }));
jest.mock('antd', () => ({ Select: ({ value, onChange, options = [], disabled, 'aria-label': label }) =>
    <select aria-label={label} value={value || ''} disabled={disabled} onChange={event => onChange(Number(event.target.value))}>
        <option value="">Chọn tin</option>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select> }));

const sessionUser = JSON.stringify({ id: 5, companyId: 8, roleCode: 'COMPANY' });
const props = { source: '/files/profile.pdf', candidateId: '99', token: 'session-5', sessionUser };
const storageKey = recruiterIntentKey(5, 99);
const saved = { version: 1, key: 'a'.repeat(32), digest: 'b'.repeat(64), jobId: 7, taskId: 'task-1' };
const result = { score: 82, summary: 'Có kinh nghiệm React', matchedSkills: ['React'], missingSkills: ['Docker'], strengths: ['Dự án thực tế'], concerns: ['Cần hỏi thêm về kiểm thử'] };
const done = { errCode: 0, data: { id: 'task-1', type: 'match_cv', status: 'done', result } };
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Phân tích CV bằng AI' }));

beforeAll(() => { Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto }); global.TextEncoder = TextEncoder; });
beforeEach(() => {
    jest.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('token_user', props.token); localStorage.setItem('userData', sessionUser);
    window.history.replaceState({}, '', '/admin/candiate/99/?jobId=7');
    getCandidateSearchJobs.mockResolvedValue({ errCode: 0, data: [{ id: 7, name: 'Frontend Developer' }] });
    resolvePdfSource.mockResolvedValue(new Blob(['%PDF-1.7\nPrivate candidate CV'], { type: 'application/pdf' }));
    matchCvPdfAi.mockResolvedValue({ errCode: 0, taskId: 'task-1' }); getAiTask.mockResolvedValue(done);
});

test('only explicit action reads authorized PDF and sends one paid match despite double click', async () => {
    render(<RecruiterAiReview {...props} />);
    expect(resolvePdfSource).not.toHaveBeenCalled(); expect(matchCvPdfAi).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Tin tuyển dụng để đối chiếu')).toHaveValue('7');
    const button = screen.getByRole('button', { name: 'Phân tích CV bằng AI' });
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText('82/100')).toBeInTheDocument();
    expect(resolvePdfSource).toHaveBeenCalledWith(props.source, expect.objectContaining({ signal: expect.anything() }));
    expect(matchCvPdfAi).toHaveBeenCalledTimes(1);
    expect(matchCvPdfAi).toHaveBeenCalledWith(btoa('%PDF-1.7\nPrivate candidate CV'), 7,
        expect.objectContaining({ idempotencyKey: 'a'.repeat(32), signal: expect.anything() }));
    expect(screen.getByText('Docker')).toBeInTheDocument();
    expect(screen.getByText(/tại thời điểm gửi/)).toBeInTheDocument();
    const raw = sessionStorage.getItem(storageKey);
    expect(raw).toContain('task-1'); expect(raw).not.toContain('Private'); expect(raw).not.toContain('PDF'); expect(raw).not.toContain('React');
});

test('unknown POST result keeps identical key across refresh and blocks changed PDF replay', async () => {
    matchCvPdfAi.mockResolvedValueOnce({ errCode: -1, httpStatus: 503 });
    const view = render(<RecruiterAiReview {...props} />); start();
    await screen.findByText('Đối chiếu yêu cầu đã gửi');
    const first = matchCvPdfAi.mock.calls[0]; view.unmount();
    render(<RecruiterAiReview {...props} />);
    resolvePdfSource.mockResolvedValueOnce(new Blob(['%PDF-1.7\nDifferent CV'], { type: 'application/pdf' }));
    fireEvent.click(screen.getByText('Đối chiếu yêu cầu đã gửi'));
    await screen.findByText(/CV hoặc tin tuyển dụng đã thay đổi/);
    expect(matchCvPdfAi).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Đối chiếu yêu cầu đã gửi'));
    await screen.findByText('82/100');
    expect(matchCvPdfAi.mock.calls[1].slice(0, 2)).toEqual(first.slice(0, 2));
    expect(matchCvPdfAi.mock.calls[1][2].idempotencyKey).toEqual(first[2].idempotencyKey);
});

test('refresh restores accepted task through GET only and cancellation preserves recovery metadata', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
    getAiTask.mockImplementation((id, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }))));
    render(<RecruiterAiReview {...props} />);
    expect(getAiTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Kiểm tra kết quả AI'));
    await waitFor(() => expect(getAiTask).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Dừng chờ'));
    await screen.findByText(/Đã dừng chờ/);
    expect(JSON.parse(sessionStorage.getItem(storageKey))).toEqual(saved);
    expect(resolvePdfSource).not.toHaveBeenCalled(); expect(matchCvPdfAi).not.toHaveBeenCalled();
    getAiTask.mockResolvedValue(done); fireEvent.click(screen.getByText('Kiểm tra kết quả AI'));
    await screen.findByText('82/100'); expect(matchCvPdfAi).not.toHaveBeenCalled();
});

test('wrong task or malformed result never appears as valid score and confirmed terminal task may reset', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
    getAiTask.mockResolvedValueOnce({ ...done, data: { ...done.data, id: 'another-task' } });
    render(<RecruiterAiReview {...props} />); fireEvent.click(screen.getByText('Kiểm tra kết quả AI'));
    await screen.findByText('Kết quả không thuộc yêu cầu phân tích đang xem.');
    expect(screen.queryByText('82/100')).not.toBeInTheDocument();
    getAiTask.mockResolvedValueOnce({ ...done, data: { ...done.data, result: { ...result, score: 101 } } });
    fireEvent.click(screen.getByText('Kiểm tra kết quả AI')); await screen.findByText('Điểm phù hợp không hợp lệ.');
    expect(screen.queryByText('101/100')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Phân tích mới'));
    expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(screen.getByLabelText('Tin tuyển dụng để đối chiếu')).toBeEnabled();
    expect(matchCvPdfAi).not.toHaveBeenCalled();
});

test('expiry cancels work and late accepted response cannot change or expose session state', async () => {
    let resolve;
    matchCvPdfAi.mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<RecruiterAiReview {...props} />); start();
    await waitFor(() => expect(matchCvPdfAi).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event(SESSION_ENDED_EVENT));
    await act(async () => resolve({ errCode: 0, taskId: 'private-late-id' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(getAiTask).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).not.toContain('private-late-id');
});

test('unmount before PDF finishes prevents POST and new candidate does not inherit old intent', async () => {
    let resolve;
    resolvePdfSource.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<RecruiterAiReview {...props} />); start(); view.unmount();
    await act(async () => resolve(new Blob(['%PDF-1.7\nlate'], { type: 'application/pdf' })));
    expect(matchCvPdfAi).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBeNull();
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
    render(<RecruiterAiReview {...props} candidateId="100" />);
    expect(screen.getByText('Phân tích CV bằng AI')).toBeEnabled(); expect(screen.queryByText('Kiểm tra kết quả AI')).not.toBeInTheDocument();
});

test('PDF loading failure and oversized CV do not send any AI request', async () => {
    resolvePdfSource.mockRejectedValueOnce(new Error('Bạn không có quyền mở tài liệu.'));
    render(<RecruiterAiReview {...props} />); start();
    await screen.findByText('Bạn không có quyền mở tài liệu.'); expect(matchCvPdfAi).not.toHaveBeenCalled();
    resolvePdfSource.mockResolvedValueOnce({ size: 6 * 1024 * 1024 }); start();
    await screen.findByText(/AI hỗ trợ CV PDF không quá 5 MiB/); expect(matchCvPdfAi).not.toHaveBeenCalled();
});

test('storage errors stop before paid submission', async () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    render(<RecruiterAiReview {...props} />); start();
    await screen.findByText('Storage unavailable'); expect(matchCvPdfAi).not.toHaveBeenCalled(); spy.mockRestore();
});
