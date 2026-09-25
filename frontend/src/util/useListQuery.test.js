import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import useListQuery, { clampListPage, readListQuery } from './useListQuery';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});

const defaults = { page: 0, search: '', tags: [], minimum: 0, active: false };

test('restores old job level bookmarks with canonical selected values and no duplicates', () => {
    const params = new URLSearchParams({ categoryJoblevelCode: JSON.stringify(['nhan-vien', 'junior', 'truong-phong', 'giam-doc', 'senior']), page: '3' });
    expect(readListQuery(`?${params}`, { categoryJoblevelCode: [], page: 0 })).toEqual({
        categoryJoblevelCode: ['junior', 'lead', 'manager', 'senior'], page: 2,
    });
});
let lastSetter;
function QueryList({ prefix = '', clampTo }) {
    const [query, setQuery] = useListQuery(defaults, { prefix });
    if (!prefix) lastSetter = setQuery;
    useEffect(() => {
        if (clampTo === undefined) return;
        const valid = clampListPage(query.page, clampTo, 5);
        if (valid !== query.page) setQuery({ page: valid }, { replace: true });
    }, [query.page, clampTo, setQuery]);
    return <>
        <output data-testid={`${prefix}query`}>{JSON.stringify(query)}</output>
        <button onClick={() => setQuery(previous => ({ page: previous.page + 1 }))}>{prefix}Next</button>
        <button onClick={() => setQuery({ search: 'edited' })}>{prefix}Edit</button>
        <button onClick={() => setQuery({ tags: [7, '7', 'C++', 'Đà Nẵng'], minimum: 4.5, active: true })}>{prefix}Typed filters</button>
        <button onClick={() => setQuery(defaults)}>{prefix}Clear</button>
    </>;
}
function Navigation() {
    const location = useLocation();
    const navigate = useNavigate();
    const [, setLeft] = useListQuery({ page: 0, search: '' }, { prefix: 'left.' });
    const [, setRight] = useListQuery({ page: 0, search: '' }, { prefix: 'right.' });
    return <>
        <output data-testid="url">{location.pathname + location.search + location.hash}</output>
        <output data-testid="route-state">{JSON.stringify(location.state)}</output>
        <button onClick={() => navigate(-1)}>Back</button>
        <button onClick={() => navigate(1)}>Forward</button>
        <button onClick={() => {
            setLeft({ page: 2, search: 'CV' });
            setRight(previous => ({ page: previous.page + 1, search: 'Job' }));
        }}>Change both</button>
    </>;
}
function show(url, children = <QueryList />, { entries, index } = {}) {
    return render(<MemoryRouter initialEntries={entries || [url]} initialIndex={index}>
        <Navigation />{children}
    </MemoryRouter>);
}
const query = (prefix = '') => JSON.parse(screen.getByTestId(`${prefix}query`).textContent);
const url = () => new URL(screen.getByTestId('url').textContent, 'http://localhost');

it('pins time-dependent defaults when paging so tomorrow reloads the same date range', () => {
    function Statistics({ today }) {
        const [query, setQuery] = useListQuery({ page: 0, fromDate: today, toDate: today },
            { prefix: 'cv.', persistDefaults: ['fromDate', 'toDate'] });
        return <><output data-testid="range">{query.fromDate}/{query.toDate}/{query.page}</output>
            <button onClick={() => setQuery({ page: 2 })}>Statistics page 3</button></>;
    }
    const first = show('/statistics', <Statistics today="2026-09-21" />);
    fireEvent.click(screen.getByText('Statistics page 3'));
    const savedUrl = screen.getByTestId('url').textContent;
    first.unmount();
    show(savedUrl, <Statistics today="2026-09-22" />);
    expect(screen.getByTestId('range')).toHaveTextContent('2026-09-21/2026-09-21/2');
});

it('merges simultaneous updates from independent lists without losing either namespace', () => {
    show('/lists?keep=yes&left.page=2&right.page=4#results', <><QueryList prefix="left." /><QueryList prefix="right." /></>);
    fireEvent.click(screen.getByText('Change both'));
    expect(query('left.')).toMatchObject({ page: 2, search: 'CV' });
    expect(query('right.')).toMatchObject({ page: 4, search: 'Job' });
    expect(url().searchParams.get('left.page')).toBe('3');
    expect(url().searchParams.get('right.page')).toBe('5');
    expect(url().searchParams.get('keep')).toBe('yes');
    expect(url().hash).toBe('#results');
});

it('merges simultaneous clamps and replaces the stale history entry', async () => {
    show(null, <><QueryList prefix="left." clampTo={6} /><QueryList prefix="right." clampTo={0} /></>, {
        entries: ['/before?keep=original', '/lists?left.page=9&right.page=8&right.search=Job&keep=yes'], index: 1,
    });
    await waitFor(() => expect(query('left.').page).toBe(1));
    expect(query('right.')).toMatchObject({ page: 0, search: 'Job' });
    expect(url().searchParams.get('left.page')).toBe('2');
    expect(url().searchParams.has('right.page')).toBe(false);
    expect(url().searchParams.get('keep')).toBe('yes');
    fireEvent.click(screen.getByText('Back'));
    expect(url().pathname).toBe('/before');
    fireEvent.click(screen.getByText('Forward'));
    expect(query('left.').page).toBe(1);
    expect(query('right.').page).toBe(0);
});

it('Back followed immediately by editing uses the restored query, not a pending newer query', () => {
    show('/lists?page=3&search=old&keep=yes#saved');
    const stableSetter = lastSetter;
    fireEvent.click(screen.getByText('Next'));
    expect(query().page).toBe(3);
    fireEvent.click(screen.getByText('Back'));
    expect(query()).toMatchObject({ page: 2, search: 'old' });
    fireEvent.click(screen.getByText('Edit'));
    expect(query()).toMatchObject({ page: 2, search: 'edited' });
    expect(url().searchParams.get('page')).toBe('3');
    expect(url().hash).toBe('#saved');
    expect(lastSetter).toBe(stableSetter);
});

it('round-trips typed filters and reloads them from the URL, keeping hash and unrelated parameters', () => {
    const view = show({ pathname: '/lists', search: '?page=3&keep=one&keep=two', hash: '#results', state: { from: 'home' } });
    fireEvent.click(screen.getByText('Typed filters'));
    expect(query()).toMatchObject({ page: 2, tags: [7, '7', 'C++', 'Đà Nẵng'], minimum: 4.5, active: true });
    expect(url().searchParams.getAll('keep')).toEqual(['one', 'two']);
    expect(screen.getByTestId('route-state')).toHaveTextContent('{"from":"home"}');
    const savedUrl = screen.getByTestId('url').textContent;
    view.unmount();
    show(savedUrl);
    expect(query()).toMatchObject({ page: 2, tags: [7, '7', 'C++', 'Đà Nẵng'], minimum: 4.5, active: true });
    expect(url().hash).toBe('#results');
    fireEvent.click(screen.getByText('Clear'));
    expect(query()).toEqual(defaults);
    expect(url().search).toBe('?keep=one&keep=two');
});

it.each(['', '0', '-1', 'NaN', 'Infinity', '2.5', 'abc', '100001', '9007199254740992'])('reads malformed page %j safely without changing unrelated URL state', page => {
    show(`/lists?page=${encodeURIComponent(page)}&search=React&keep=yes`);
    expect(query().page).toBe(0);
    expect(query().search).toBe('React');
    fireEvent.click(screen.getByText('Next'));
    expect(query().page).toBe(1);
    expect(url().searchParams.get('page')).toBe('2');
    expect(url().searchParams.get('keep')).toBe('yes');
});

it('does not clamp until a trustworthy count arrives and maps an empty result to the first page', () => {
    expect(clampListPage(3, undefined, 5)).toBe(3);
    expect(clampListPage(3, null, 5)).toBe(3);
    expect(clampListPage(3, '', 5)).toBe(3);
    expect(clampListPage(3, 1.5, 5)).toBe(3);
    expect(clampListPage(3, NaN, 5)).toBe(3);
    expect(clampListPage(3, -1, 5)).toBe(3);
    expect(clampListPage(3, 0, 5)).toBe(0);
    expect(clampListPage(3, 10, 5)).toBe(1);
});

it('rejects invalid array contents and nonfinite numeric filters', () => {
    const params = new URLSearchParams({ tags: JSON.stringify([1, { private: 'value' }]), minimum: 'Infinity', active: 'invalid' });
    expect(readListQuery(`?${params}`, defaults)).toEqual(defaults);
    params.set('tags', 'not-json');
    expect(readListQuery(`?${params}`, defaults).tags).toEqual([]);
});

it('composes repeated functional changes before a render using the latest pending values', () => {
    show('/lists?page=3');
    act(() => {
        lastSetter(previous => ({ page: previous.page + 1 }));
        lastSetter(previous => ({ page: previous.page + 1 }));
    });
    expect(query().page).toBe(4);
    expect(url().searchParams.get('page')).toBe('5');
});
