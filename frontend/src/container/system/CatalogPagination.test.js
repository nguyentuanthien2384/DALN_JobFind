import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { getListAllCodeService, getListSkill, getAllPackageCv, getAllPackage, DeleteSkillService } from '../../service/userService';
import ManageExpType from './ExpType/ManageExpType';
import ManageJobLevel from './JobLevel/ManageJobLevel';
import ManageJobType from './JobType/ManageJobType';
import ManageWorkType from './WorkType/ManageWorkType';
import ManageSalaryType from './SalaryType/ManageSalaryType';
import ManageJobSkill from './JobSkill/ManageJobSkill';
import ManagePackageCv from './PackageCv/ManagePackageCv';
import ManagePackagePost from './PackagePost/ManagePackagePost';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('../../service/userService', () => ({
    getListAllCodeService: jest.fn(), getListSkill: jest.fn(),
    getAllPackageCv: jest.fn(), getAllPackage: jest.fn(),
    DeleteAllcodeService: jest.fn(), DeleteSkillService: jest.fn(),
    setActiveTypePackageCv: jest.fn(), setActiveTypePackage: jest.fn(),
}));
jest.mock('../../util/fetch', () => ({ useFetchAllcode: () => ({ data: [
    { code: 'DEV', value: 'Development' }, { code: 'OPS', value: 'Operations' },
] }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-image-lightbox', () => () => null);
jest.mock('@ant-design/icons', () => ({ ExclamationCircleOutlined: () => null }));
jest.mock('antd', () => ({
    Input: { Search: ({ value, onChange, onSearch }) => <div>
        <input aria-label="Search catalog" value={value} onChange={onChange} />
        <button onClick={() => onSearch(value)}>Search</button>
    </div> },
    Select: ({ value, onChange, options }) => <select aria-label="Category" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>,
    Modal: { confirm: options => options.onOk() },
    Row: ({ children }) => <div>{children}</div>, Col: ({ children }) => <div>{children}</div>,
}));

const item = { id: 1, code: 'DEV_1', value: 'Catalog item', name: 'Catalog item',
    jobTypeSkillData: { value: 'Development' }, isActive: 1, price: 5 };
const response = (name = 'Catalog item', count = 16) => ({ errCode: 0, count, data: [{ ...item, name, value: name }] });
const configs = [
    ['experience', ManageExpType, getListAllCodeService],
    ['level', ManageJobLevel, getListAllCodeService],
    ['job type', ManageJobType, getListAllCodeService],
    ['work type', ManageWorkType, getListAllCodeService],
    ['salary', ManageSalaryType, getListAllCodeService],
    ['skills', ManageJobSkill, getListSkill],
    ['CV package', ManagePackageCv, getAllPackageCv],
    ['post package', ManagePackagePost, getAllPackage],
];

function Navigation() {
    const location = useLocation();
    const navigate = useNavigate();
    return <>
        <output data-testid="url">{location.pathname + location.search}</output>
        <button onClick={() => navigate(-1)}>Back</button>
        <button onClick={() => navigate('/catalog?page=2&search=fast')}>Fast query</button>
    </>;
}
function show(Component, url = '/catalog?page=3&search=React&categoryJobCode=DEV&keep=yes') {
    return render(<MemoryRouter initialEntries={[url]}><Navigation /><Component /></MemoryRouter>);
}
function params() { return new URL(screen.getByTestId('url').textContent, 'http://localhost').searchParams; }

beforeEach(() => {
    jest.resetAllMocks();
    [getListAllCodeService, getListSkill, getAllPackageCv, getAllPackage].forEach(fetch => fetch.mockResolvedValue(response()));
});

it.each(configs)('%s retains the requested page and search after a reload', async (_, Component, fetch) => {
    const first = show(Component);
    await screen.findAllByText('Catalog item');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, search: 'React' }));
    expect(screen.getByLabelText('Search catalog')).toHaveValue('React');
    expect(first.container.querySelector('.pagination .active')).toHaveTextContent('3');
    const url = screen.getByTestId('url').textContent;
    first.unmount();
    const reloaded = show(Component, url);
    await screen.findAllByText('Catalog item');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, search: 'React' }));
    expect(reloaded.container.querySelector('.pagination .active')).toHaveTextContent('3');
});

it('only resets on a changed search and restores page, search and category when navigating back', async () => {
    const view = show(ManageJobSkill);
    await screen.findAllByText('Catalog item');
    expect(screen.getByLabelText('Category')).toHaveValue('DEV');
    fireEvent.click(screen.getByText('Search'));
    expect(params().get('page')).toBe('3');
    fireEvent.change(screen.getByLabelText('Search catalog'), { target: { value: 'Node' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(getListSkill).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, search: 'Node', categoryJobCode: 'DEV' })));
    expect(params().get('keep')).toBe('yes');
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() => expect(getListSkill).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, search: 'React', categoryJobCode: 'DEV' })));
    expect(screen.getByLabelText('Search catalog')).toHaveValue('React');
    expect(view.container.querySelector('.pagination .active')).toHaveTextContent('3');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'OPS' } });
    await waitFor(() => expect(getListSkill).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, search: 'React', categoryJobCode: 'OPS' })));
});

it('writes a clicked page into the URL and keeps it after remounting', async () => {
    const view = show(ManagePackagePost, '/catalog?search=React');
    await screen.findAllByText('Catalog item');
    fireEvent.click(view.container.querySelector('a[aria-label="Page 3"]'));
    await waitFor(() => expect(getAllPackage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, search: 'React' })));
    expect(params().get('page')).toBe('3');
    const url = screen.getByTestId('url').textContent;
    view.unmount();
    show(ManagePackagePost, url);
    await screen.findAllByText('Catalog item');
    expect(getAllPackage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, search: 'React' }));
});

it('refreshes deletion with the active category and clamps a removed last page', async () => {
    let total = 16;
    getListSkill.mockImplementation(async () => response('Catalog item', total));
    DeleteSkillService.mockImplementation(async () => { total = 15; return { errCode: 0 }; });
    const view = show(ManageJobSkill, '/catalog?page=4&search=React&categoryJobCode=DEV');
    await screen.findAllByText('Catalog item');
    fireEvent.click(screen.getByText('Xóa'));
    await waitFor(() => expect(params().get('page')).toBe('3'));
    await waitFor(() => expect(getListSkill).toHaveBeenLastCalledWith({ offset: 10, limit: 5, search: 'React', categoryJobCode: 'DEV' }));
    expect(getListSkill.mock.calls.map(([query]) => query.offset)).toEqual([15, 15, 10]);
    expect(view.container.querySelector('.pagination .active')).toHaveTextContent('3');
});

it('ignores an older response so it cannot reset the new query or replace its rows', async () => {
    let finishOld;
    getListAllCodeService.mockImplementation(({ search }) => search === 'slow'
        ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(response('Fast result')));
    show(ManageExpType, '/catalog?page=3&search=slow');
    fireEvent.click(screen.getByText('Fast query'));
    await screen.findByText('Fast result');
    await act(async () => finishOld(response('Old result', 1)));
    expect(params().get('page')).toBe('2');
    expect(params().get('search')).toBe('fast');
    expect(screen.queryByText('Old result')).not.toBeInTheDocument();
    expect(screen.getByText('Fast result')).toBeInTheDocument();
});
