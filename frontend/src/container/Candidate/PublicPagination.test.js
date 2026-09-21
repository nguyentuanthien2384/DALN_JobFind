import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import ListCompany from '../Company/ListCompany';
import SavedJobs from './SavedJobs';
import ManageCvCandidate from './ManageCvCandidate';
import { getListCompany, getFavoritePostByUserService, toggleFavoritePostService } from '../../service/userService';
import { getAllListCvByUserIdService } from '../../service/cvService';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('../../service/userService', () => ({ getListCompany: jest.fn(), getFavoritePostByUserService: jest.fn(), toggleFavoritePostService: jest.fn() }));
jest.mock('../../service/cvService', () => ({ getAllListCvByUserIdService: jest.fn() }));
jest.mock('../../service/applicationService', () => ({ getMyApplications: jest.fn() }));
jest.mock('../../util/CommonUtils', () => ({ __esModule: true, default: { removeSpace: value => value.trim().replace(/\s+/g, ' '), formatDate: () => 5 } }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('antd', () => ({ Input: { Search: ({ defaultValue, onSearch, placeholder }) => {
    const [value, setValue] = require('react').useState(defaultValue);
    return <form onSubmit={event => { event.preventDefault(); onSearch(value); }}>
        <input placeholder={placeholder} value={value} onChange={event => setValue(event.target.value)} />
        <button type="submit">Search</button>
    </form>;
} } }));
jest.mock('react-paginate', () => props => <div data-testid="pager" data-page={props.forcePage}>
    <button onClick={() => props.onPageChange({ selected: 1 })}>Page 2</button>
</div>);

const Location = () => {
    const location = useLocation();
    const navigate = useNavigate();
    return <><span data-testid="url">{location.pathname + location.search}</span><button onClick={() => navigate(-1)}>Back</button></>;
};
const show = (Component, url) => render(<MemoryRouter initialEntries={[url]}><Location /><Component /></MemoryRouter>);
const company = { id: 12, name: 'Test company', descriptionHTML: '<p>Company description</p>' };
const saved = id => ({ createdAt: 12345, postFavoriteData: {
    id, timeEnd: Date.now() + 86400000, userPostData: { userCompanyData: { name: 'Test company', thumbnail: '/logo.png' } },
    postDetailData: { name: `Saved job ${id}`, provincePostData: { value: 'Hà Nội' }, salaryTypePostData: { value: '20 triệu' } },
} });
const application = { id: 7, userId: 9, postId: 12, isChecked: 0, postCvData: { id: 12, postDetailData: { name: 'Applied job' } } };

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('userData', JSON.stringify({ id: 9, roleCode: 'CANDIDATE' }));
    localStorage.setItem('token_user', 'pagination-test-token');
    process.env.REACT_APP_APPLICATION_PROGRESS_ENABLED = 'false';
    getListCompany.mockResolvedValue({ errCode: 0, count: 30, data: [company] });
    getFavoritePostByUserService.mockResolvedValue({ errCode: 0, count: 30, data: [saved(21)] });
    getAllListCvByUserIdService.mockResolvedValue({ errCode: 0, count: 30, data: [application] });
});
afterEach(() => delete process.env.REACT_APP_APPLICATION_PROGRESS_ENABLED);

test('company page and search survive a reload, page changes and browser Back', async () => {
    const first = show(ListCompany, '/company?page=3&search=Sao+Viet&source=keep');
    await screen.findByText('Company description');
    expect(getListCompany).toHaveBeenLastCalledWith({ limit: 6, offset: 12, search: 'Sao Viet' });
    expect(screen.getByPlaceholderText('Nhập tên công ty')).toHaveValue('Sao Viet');
    expect(screen.getByTestId('pager')).toHaveAttribute('data-page', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(getListCompany).toHaveBeenLastCalledWith({ limit: 6, offset: 6, search: 'Sao Viet' }));
    const url = screen.getByTestId('url').textContent;
    expect(url).toContain('source=keep');
    first.unmount();
    show(ListCompany, url);
    await waitFor(() => expect(getListCompany).toHaveBeenCalledTimes(3));
    expect(getListCompany).toHaveBeenLastCalledWith({ limit: 6, offset: 6, search: 'Sao Viet' });
    fireEvent.change(screen.getByPlaceholderText('Nhập tên công ty'), { target: { value: 'Other company' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(getListCompany).toHaveBeenLastCalledWith({ limit: 6, offset: 0, search: 'Other company' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(getListCompany).toHaveBeenLastCalledWith({ limit: 6, offset: 6, search: 'Sao Viet' }));
    expect(screen.getByPlaceholderText('Nhập tên công ty')).toHaveValue('Sao Viet');
});

test.each([
    ['saved jobs', SavedJobs, getFavoritePostByUserService, 10, 'Saved job 21'],
    ['submitted applications', ManageCvCandidate, getAllListCvByUserIdService, 5, 'Applied job'],
])('%s retain the selected page after remount and browser Back', async (name, Component, service, size, label) => {
    const first = show(Component, '/candidate/list?page=3&source=keep');
    await screen.findByText(label);
    expect(service).toHaveBeenLastCalledWith({ userId: 9, limit: size, offset: size * 2 });
    expect(screen.getByTestId('pager')).toHaveAttribute('data-page', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(service).toHaveBeenLastCalledWith({ userId: 9, limit: size, offset: size }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(service).toHaveBeenLastCalledWith({ userId: 9, limit: size, offset: size * 2 }));
    const url = screen.getByTestId('url').textContent;
    expect(url).toContain('source=keep');
    first.unmount();
    show(Component, url);
    await screen.findByText(label);
    expect(service).toHaveBeenCalledTimes(4);
    expect(service).toHaveBeenLastCalledWith({ userId: 9, limit: size, offset: size * 2 });
});

test('removing the last saved job on the final page selects the remaining final page', async () => {
    getFavoritePostByUserService.mockResolvedValueOnce({ errCode: 0, count: 21, data: [saved(21)] })
        .mockResolvedValueOnce({ errCode: 0, count: 20, data: [] })
        .mockResolvedValueOnce({ errCode: 0, count: 20, data: [saved(20)] });
    toggleFavoritePostService.mockResolvedValue({ errCode: 0, errMessage: 'Đã bỏ lưu' });
    show(SavedJobs, '/candidate/saved?page=3&source=keep');
    fireEvent.click(await screen.findByRole('button', { name: /Bỏ lưu/ }));
    expect(await screen.findByText('Saved job 20')).toBeInTheDocument();
    expect(toggleFavoritePostService).toHaveBeenCalledWith({ userId: 9, postId: 21 });
    expect(getFavoritePostByUserService.mock.calls.map(([params]) => params.offset)).toEqual([20, 20, 10]);
    expect(screen.getByTestId('pager')).toHaveAttribute('data-page', '1');
    expect(screen.getByTestId('url').textContent).toContain('page=2');
    expect(screen.getByTestId('url').textContent).toContain('source=keep');
});

test('an old company response cannot clamp a newly selected page', async () => {
    let finishOld;
    getListCompany.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    show(ListCompany, '/company?page=3&search=Test');
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await screen.findByText('Company description');
    await act(async () => finishOld({ errCode: 0, count: 0, data: [] }));
    expect(screen.getByTestId('url').textContent).toContain('page=2');
    expect(screen.getByText('Company description')).toBeInTheDocument();
});
