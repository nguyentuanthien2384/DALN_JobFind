import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import ManageUser from './User/ManageUser';
import ManageCompany from './Company/ManageCompany';
import ManageEmployer from './Company/ManageEmployer';
import ManageCv from './Cv/ManageCv';
import ManagePost from './Post/ManagePost';
import NotePost from './Post/NotePost';
import * as services from '../../service/userService';
import { getAllListCvByPostService } from '../../service/cvService';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('../../service/userService', () => ({
    getAllUsers: jest.fn(), BanUserService: jest.fn(), UnbanUserService: jest.fn(),
    getAllCompany: jest.fn(), accecptCompanyService: jest.fn(), banCompanyService: jest.fn(), unbanCompanyService: jest.fn(),
    getAllUserByCompanyIdService: jest.fn(), QuitCompanyService: jest.fn(), getDetailPostByIdService: jest.fn(),
    getAllPostByAdminService: jest.fn(), getAllPostByRoleAdminService: jest.fn(), getListNoteByPost: jest.fn(),
    banPostService: jest.fn(), activePostService: jest.fn(), acceptPostService: jest.fn(),
}));
jest.mock('../../service/cvService', () => ({ getAllListCvByPostService: jest.fn() }));
jest.mock('../../util/CommonUtils', () => ({ __esModule: true, default: { removeSpace: value => value.trim().replace(/\s+/g, ' ') } }));
jest.mock('../../components/modal/NoteModal', () => () => null);
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@ant-design/icons', () => ({ ExclamationCircleOutlined: () => null }));
jest.mock('antd', () => {
    const React = require('react');
    return { Row: ({ children }) => <div>{children}</div>, Col: ({ children }) => <div>{children}</div>,
        Modal: { confirm: options => options.onOk() },
        Select: ({ value, options, onChange }) => <select aria-label="Status" value={value} onChange={event => onChange(event.target.value)}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
        Input: { Search: ({ defaultValue = '', onSearch }) => {
            const [value, setValue] = React.useState(defaultValue);
            return <div><input aria-label="Search" value={value} onChange={event => setValue(event.target.value)} />
                <button onClick={() => onSearch(value)}>Search</button></div>;
        } }
    };
});

function Navigation() {
    const location = useLocation(), navigate = useNavigate();
    return <><output data-testid="url">{location.pathname}{location.search}</output>
        <button onClick={() => navigate(-1)}>Browser Back</button>
        <button onClick={() => navigate(1)}>Browser Forward</button></>;
}
function mount(Component, initialEntry, path = '/manage/:id?') {
    return render(<MemoryRouter initialEntries={[initialEntry]}><Navigation /><Routes>
        <Route path={path} element={<Component />} />
    </Routes></MemoryRouter>);
}
const listResult = (count = 30, data = []) => ({ errCode: 0, data, count });
beforeEach(() => {
    jest.resetAllMocks();
    localStorage.setItem('userData', JSON.stringify({ id: 1, companyId: 7, roleCode: 'ADMIN' }));
    Object.values(services).filter(jest.isMockFunction).forEach(service => service.mockResolvedValue(listResult()));
    services.getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { postDetailData: { name: 'Post' } } });
    getAllListCvByPostService.mockResolvedValue(listResult());
});

test.each([
    ['users', ManageUser, services.getAllUsers, '/manage?page=3&search=Lan'],
    ['companies', ManageCompany, services.getAllCompany, '/manage?page=3&search=Sao&censorCode=CS3'],
    ['employees', ManageEmployer, services.getAllUserByCompanyIdService, '/manage?page=3'],
    ['applications', ManageCv, getAllListCvByPostService, '/manage/55?page=3'],
    ['jobs', ManagePost, services.getAllPostByRoleAdminService, '/manage/55?page=3&search=React&censorCode=PS1'],
    ['notes', NotePost, services.getListNoteByPost, '/manage/55?page=3'],
])('%s restores its URL page and selected paginator after remount', async (_name, Component, request, url) => {
    let view = mount(Component, url);
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ offset: 10 })));
    await waitFor(() => expect(view.container.querySelector('.pagination .active')).toHaveTextContent('3'));
    expect(request.mock.calls.every(([query]) => query.offset === 10)).toBe(true);
    expect(screen.getByTestId('url')).toHaveTextContent(url);
    fireEvent.click(screen.getByLabelText('Page 4'));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 15 })));
    const savedUrl = screen.getByTestId('url').textContent;
    expect(savedUrl).toContain('page=4');
    view.unmount(); request.mockClear(); view = mount(Component, savedUrl);
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ offset: 15 })));
    await waitFor(() => expect(view.container.querySelector('.pagination .active')).toHaveTextContent('4'));
    expect(request.mock.calls.every(([query]) => query.offset === 15)).toBe(true);
});

test('job filter changes reset page once; Back and Forward restore filters and page together', async () => {
    mount(ManagePost, '/manage?page=3&search=React&censorCode=PS1&campaign=keep');
    await screen.findByText('Số lượng bài viết: 30');
    expect(screen.getByLabelText('Search')).toHaveValue('React');
    expect(screen.getByLabelText('Status')).toHaveValue('PS1');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PS2' } });
    await waitFor(() => expect(services.getAllPostByRoleAdminService).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, search: 'React', censorCode: 'PS2' })));
    expect(screen.getByTestId('url')).toHaveTextContent('campaign=keep');
    fireEvent.click(screen.getByText('Browser Back'));
    await waitFor(() => expect(services.getAllPostByRoleAdminService).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, search: 'React', censorCode: 'PS1' })));
    expect(screen.getByLabelText('Status')).toHaveValue('PS1');
    fireEvent.click(screen.getByText('Browser Forward'));
    await waitFor(() => expect(services.getAllPostByRoleAdminService).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, censorCode: 'PS2' })));
});

test('an out-of-range URL clamps only after a successful count and reloads the last valid page', async () => {
    services.getAllCompany.mockResolvedValue(listResult(8));
    const view = mount(ManageCompany, '/manage?page=50&search=Sao&censorCode=CS3');
    await waitFor(() => expect(services.getAllCompany).toHaveBeenLastCalledWith({ limit: 5, offset: 5, search: 'Sao', censorCode: 'CS3' }));
    expect(services.getAllCompany.mock.calls[0][0].offset).toBe(245);
    expect(screen.getByTestId('url')).toHaveTextContent('page=2');
    expect(view.container.querySelector('.pagination .active')).toHaveTextContent('2');
});

test('a failed page read leaves the requested job URL intact', async () => {
    services.getAllPostByRoleAdminService.mockResolvedValue({ errCode: 503, errMessage: 'Unavailable' });
    mount(ManagePost, '/manage?page=3&censorCode=PS1');
    await screen.findByRole('alert');
    expect(screen.getByTestId('url')).toHaveTextContent('/manage?page=3&censorCode=PS1');
    expect(services.getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
});

test('slow previous page cannot replace the company count after navigation', async () => {
    let finish;
    services.getAllCompany.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    services.getAllCompany.mockResolvedValue(listResult(20));
    mount(ManageCompany, '/manage?page=3');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CS1' } });
    await screen.findByText('Số lượng công ty: 20');
    await act(async () => finish(listResult(0)));
    expect(screen.getByText('Số lượng công ty: 20')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('censorCode=CS1');
});

test('removing the final employee of the last page reloads the preceding page', async () => {
    const employee = { id: 22, firstName: 'Lan', lastName: 'Nguyen', genderData: { value: 'Nữ' },
        userAccountData: { phonenumber: '0900', roleData: { value: 'Employer' }, statusAccountData: { value: 'Active' } } };
    services.getAllUserByCompanyIdService.mockResolvedValueOnce(listResult(11, [employee])).mockResolvedValue(listResult(10));
    services.QuitCompanyService.mockResolvedValue({ errCode: 0 });
    mount(ManageEmployer, '/manage?page=3');
    fireEvent.click(await screen.findByText('Thôi việc'));
    await waitFor(() => expect(services.getAllUserByCompanyIdService).toHaveBeenLastCalledWith({ limit: 5, offset: 5, companyId: 7 }));
    expect(screen.getByTestId('url')).toHaveTextContent('page=2');
});


test('pending employee pages retain layout while blocking actions on the previous rows', async () => {
    const employee = { id: 22, firstName: 'Lan', lastName: 'Nguyen', genderData: { value: 'Nữ' },
        userAccountData: { phonenumber: '0900', roleData: { value: 'Employer' }, statusAccountData: { value: 'Active' } } };
    services.getAllUserByCompanyIdService.mockResolvedValueOnce(listResult(6, [employee]));
    const view = mount(ManageEmployer, '/manage');
    await screen.findByText('Lan Nguyen');
    const pager = view.container.querySelector('.pagination');
    let finish;
    services.getAllUserByCompanyIdService.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByLabelText('Page 2'));
    expect(view.container.querySelector('.stable-list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Lan Nguyen').closest('[inert]')).not.toBeNull();
    expect(view.container.querySelector('.pagination')).toBe(pager);
    fireEvent.click(screen.getByText('Thôi việc'));
    expect(services.QuitCompanyService).not.toHaveBeenCalled();
    await act(async () => finish(listResult(6, [{ ...employee, firstName: 'Mai' }])));
    expect(screen.getByRole('table')).toHaveTextContent('Mai Nguyen');
    expect(screen.queryByText('Lan Nguyen')).not.toBeInTheDocument();
});
