import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import FilterCv from './FilterCv';
import { getFilterCv } from '../../../service/cvService';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('../../../service/cvService', () => ({ getFilterCv: jest.fn(), getCandidateSearchJobs: jest.fn() }));
jest.mock('../../../service/userService', () => ({ getAllSkillByJobCode: jest.fn(async () => ({ errCode: 0, data: [{ id: 8, name: 'React' }] })) }));
jest.mock('../../../util/fetch', () => ({ useFetchAllcode: type => ({ data: [{ code: type, value: type }] }) }));
jest.mock('@ant-design/icons', () => ({ ExclamationCircleOutlined: () => null }));
jest.mock('antd', () => ({ Modal: { confirm: jest.fn() }, Select: ({ value, onChange, options = [], mode, 'aria-label': label }) =>
    <select aria-label={label} multiple={Boolean(mode)} value={value ?? (mode ? [] : '')}
        onChange={event => onChange(options.find(item => String(item.value) === event.target.value)?.value ?? event.target.value)}>
        {!mode && <option value="">All</option>}{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select> }));
jest.mock('react-paginate', () => ({ forcePage, onPageChange }) => <>
    <span data-testid="current-page">{forcePage + 1}</span><button onClick={() => onPageChange({ selected: 2 })}>Trang 3</button></>);
const candidate = { userId: 7, userSettingData: { firstName: 'Ứng', lastName: 'Viên' }, skills: [] };
function Navigation() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}
const mount = () => render(<BrowserRouter><Navigation /><FilterCv /></BrowserRouter>);
const ready = async () => {
    await waitFor(() => expect(screen.getByRole('region', { name: 'Kết quả tìm ứng viên' })).toHaveAttribute('aria-busy', 'false'), { timeout: 3000 });
    return screen.findByText('Ứng Viên');
};
beforeEach(() => {
    jest.clearAllMocks(); localStorage.clear();
    localStorage.setItem('userData', JSON.stringify({ id: 1, roleCode: 'ADMIN' }));
    window.history.replaceState({}, '', '/admin/filter-cv');
    getFilterCv.mockResolvedValue({ errCode: 0, data: [candidate], count: 15 });
});
test('reload restores the current CV page and complete matching criteria, including typed skills', async () => {
    const params = new URLSearchParams({ page: '3', keyword: 'React', categoryJobCode: 'JOBTYPE', provinceCode: 'PROVINCE',
        experienceJobCode: 'EXPTYPE', salaryCode: 'SALARYTYPE', listSkills: JSON.stringify([8, 'C++']), skillMode: 'all', minMatch: '70', sort: 'name' });
    window.history.replaceState({}, '', `/admin/filter-cv?${params}`);
    const first = mount(); await ready(); first.unmount(); getFilterCv.mockClear();
    mount(); await ready();
    expect(getFilterCv).toHaveBeenCalledTimes(1);
    expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, keyword: 'React', categoryJobCode: 'JOBTYPE',
        provinceCode: 'PROVINCE', experienceJobCode: 'EXPTYPE', salaryCode: 'SALARYTYPE', listSkills: [8], otherSkills: ['C++'],
        skillMode: 'all', minMatch: 70, sort: 'name' }));
    expect(screen.getByLabelText('Từ khóa')).toHaveValue('React');
    expect(screen.getByTestId('current-page')).toHaveTextContent('3');
});
test('changing a criterion resets the page and Back/Forward restores both', async () => {
    window.history.replaceState({}, '', '/admin/filter-cv?page=3');
    mount(); await ready();
    fireEvent.change(screen.getByLabelText('Ngành nghề'), { target: { value: 'JOBTYPE' } }); await ready();
    expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, categoryJobCode: 'JOBTYPE' }));
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() => expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, categoryJobCode: '' })));
    await ready(); fireEvent.click(screen.getByText('Forward'));
    await waitFor(() => expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, categoryJobCode: 'JOBTYPE' })));
});
test('successful counts clamp to the last page while a temporary failure keeps the requested page', async () => {
    window.history.replaceState({}, '', '/admin/filter-cv?page=9&keyword=React');
    getFilterCv.mockRejectedValueOnce(new Error('Mất kết nối'));
    mount(); await screen.findByText('Mất kết nối');
    expect(new URLSearchParams(window.location.search).get('page')).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' })); await ready();
    expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, keyword: 'React' }));
    expect(new URLSearchParams(window.location.search).get('page')).toBe('3');
});


test('pending pages keep candidate cards stable but block stale actions, then clear them if the page fails', async () => {
    const first = mount(); await ready();
    let failPage;
    getFilterCv.mockImplementationOnce(() => new Promise((resolve, reject) => { failPage = reject; }));
    const oldCandidate = screen.getByText('Ứng Viên');
    const staleOpen = screen.getByRole('button', { name: 'Xem chi tiết ứng viên' });
    fireEvent.click(screen.getByRole('button', { name: 'Trang 3' }));
    expect(oldCandidate).toBeInTheDocument();
    expect(oldCandidate.closest('[inert]')).not.toBeNull();
    fireEvent.click(staleOpen);
    expect(window.location.pathname).toBe('/admin/filter-cv');
    expect(screen.getByLabelText('Từ khóa')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trang 3' })).toBeInTheDocument();
    await waitFor(() => expect(failPage).toBeDefined());
    await act(async () => failPage(new Error('Mất kết nối trang mới')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mất kết nối trang mới');
    expect(screen.queryByText('Ứng Viên')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('page')).toBe('3');
    first.unmount();
});
