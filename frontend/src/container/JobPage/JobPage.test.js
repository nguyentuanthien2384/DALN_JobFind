import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getListPostService } from "../../service/userService";
import JobPage from "./JobPage";
import { BrowserRouter, MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { clearJobSearchHistory, SEARCH_SNAPSHOT_TTL } from "./jobSearchHistory";

jest.mock("react-router-dom", () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual("react-router");
});

jest.mock("../../service/userService", () => ({
    getListPostService: jest.fn(),
}));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { removeSpace: (value) => value.trim().replace(/\s+/g, " ") },
}));
jest.mock("./LeftPage/LeftBar", () => (props) => (
    <div>
        <button onClick={() => props.worktype("REMOTE")}>work-type</button>
        <button onClick={() => props.recieveSalary("HIGH")}>salary</button>
        <button onClick={() => props.recieveExp("SENIOR")}>experience</button>
        <button onClick={() => props.recieveJobType("TECH")}>job-type</button>
        <button onClick={() => props.recieveJobLevel("LEAD")}>job-level</button>
        <button onClick={() => props.recieveLocation("HCM")}>location</button>
    </div>
));
jest.mock("./RightPage/RightContent", () => (props) => (
    <div>
        <span data-testid="job-count">{props.count}</span>
        <input aria-label="Search draft" value={props.searchDraft} onChange={event => props.onSearchDraftChange(event.target.value)} />
        <button onClick={() => props.handleSearch(props.searchDraft)}>submit-draft</button>
        {props.post.map((item) => <span key={item.id}>{item.name}</span>)}
        <button onClick={() => props.handleSearch("  React   Engineer  ")}>search</button>
        <button onClick={() => props.handleSearch("")}>clear-search</button>
    </div>
));
jest.mock("react-paginate", () => (props) => (
    <div>
        <span data-testid="page-count">{props.pageCount}</span>
        <span data-testid="force-page">{String(props.forcePage)}</span>
        <button onClick={() => props.onPageChange({ selected: 2 })}>page-three</button>
    </div>
));

const success = {
    errCode: 0,
    count: 12,
    data: [{ id: 1, name: "React Developer" }],
};

const expectLatestQuery = async (expected) => {
    await waitFor(() => expect(getListPostService).toHaveBeenLastCalledWith(
        expect.objectContaining(expected)
    ));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
};

describe("JobPage", () => {
    it('Back restores the applied keyword instead of the draft submitted on the next history entry', async () => {
        const Navigation = () => { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Back</button>; };
        render(<MemoryRouter initialEntries={['/job?page=3&search=React']}><Navigation /><JobPage /></MemoryRouter>);
        await expectLatestQuery({ offset: 10, search: 'React' });
        fireEvent.change(screen.getByLabelText('Search draft'), { target: { value: 'Vue' } });
        fireEvent.click(screen.getByText('submit-draft'));
        await expectLatestQuery({ offset: 0, search: 'Vue' });
        fireEvent.click(screen.getByText('Back'));
        expect(screen.getByLabelText('Search draft')).toHaveValue('React');
        expect(screen.getByTestId('force-page')).toHaveTextContent('2');
    });
    it('keeps page and every selected filter after a browser remount with no saved snapshot', async () => {
        const first = render(<BrowserRouter><JobPage /></BrowserRouter>);
        await screen.findByText('React Developer');
        for (const button of ['work-type', 'salary', 'experience', 'job-type', 'job-level', 'location', 'search']) {
            fireEvent.click(screen.getByRole('button', { name: button }));
            await screen.findByText('React Developer');
        }
        fireEvent.click(screen.getByRole('button', { name: 'page-three' }));
        await expectLatestQuery({ offset: 10 });
        expect(new URLSearchParams(window.location.search).get('page')).toBe('3');
        first.unmount(); clearJobSearchHistory(); getListPostService.mockClear();
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        await expectLatestQuery({ offset: 10, search: 'React Engineer', categoryWorktypeCode: ['REMOTE'],
            salaryJobCode: ['HIGH'], experienceJobCode: ['SENIOR'], categoryJobCode: 'TECH',
            categoryJoblevelCode: ['LEAD'], addressCode: 'HCM' });
        expect(screen.getByTestId('force-page')).toHaveTextContent('2');
        expect(getListPostService).toHaveBeenCalledTimes(1);
    });
    it('repairs an out-of-range URL to the last page after a successful response', async () => {
        window.history.replaceState({}, '', '/job?page=99&categoryJobCode=TECH');
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        await expectLatestQuery({ offset: 10, categoryJobCode: 'TECH' });
        expect(new URLSearchParams(window.location.search).get('page')).toBe('3');
        expect(getListPostService).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 490 }));
    });
    it('keeps an expired snapshot visible while refreshing and on a temporary network failure', async () => {
        const Navigation = () => {
            const navigate = useNavigate();
            return <><button onClick={() => navigate('/detail-job/1')}>open-detail</button>
                <button onClick={() => navigate(-1)}>browser-back</button></>;
        };
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
        try {
            render(<MemoryRouter initialEntries={['/job']}><Navigation /><Routes>
                <Route path="/job" element={<JobPage />} />
                <Route path="/detail-job/:id" element={<p>Detail</p>} />
            </Routes></MemoryRouter>);
            await screen.findByText('React Developer');
            fireEvent.click(screen.getByRole('button', { name: 'open-detail' }));
            clock.mockReturnValue(now + SEARCH_SNAPSHOT_TTL + 1);
            let reject;
            getListPostService.mockImplementationOnce(() => new Promise((resolve, failure) => { reject = failure; }));
            fireEvent.click(screen.getByRole('button', { name: 'browser-back' }));
            expect(screen.getByText('React Developer')).toBeInTheDocument();
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
            expect(getListPostService).toHaveBeenCalledTimes(2);
            reject(new Error('Mất kết nối'));
            await screen.findByText('Mất kết nối');
            expect(screen.getByText('React Developer')).toBeInTheDocument();
            expect(screen.getByTestId('page-count')).toHaveTextContent('3');
        } finally { clock.mockRestore(); }
    });
    it('restores filters, results and page immediately on Back without refetching', async () => {
        const Navigation = () => {
            const navigate = useNavigate();
            return <><button onClick={() => navigate('/detail-job/1')}>open-detail</button>
                <button onClick={() => navigate(-1)}>browser-back</button>
                <button onClick={() => navigate('/job')}>fresh-search</button></>;
        };
        render(<React.StrictMode><MemoryRouter initialEntries={['/job']}>
            <Navigation /><Routes><Route path="/job" element={<JobPage />} />
                <Route path="/detail-job/:id" element={<p>Detail</p>} /></Routes>
        </MemoryRouter></React.StrictMode>);
        await screen.findByText('React Developer');
        fireEvent.click(screen.getByRole('button', { name: 'work-type' }));
        await expectLatestQuery({ categoryWorktypeCode: ['REMOTE'] });
        fireEvent.click(screen.getByRole('button', { name: 'search' }));
        await expectLatestQuery({ search: 'React Engineer' });
        fireEvent.click(screen.getByRole('button', { name: 'page-three' }));
        await expectLatestQuery({ offset: 10 });
        Object.defineProperty(window, 'scrollY', { value: 950, configurable: true });
        fireEvent.scroll(window);
        fireEvent.click(screen.getByRole('button', { name: 'open-detail' }));
        const requests = getListPostService.mock.calls.length;
        window.scrollTo.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'browser-back' }));
        expect(screen.getByText('React Developer')).toBeInTheDocument();
        expect(screen.getByTestId('force-page')).toHaveTextContent('2');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(window.scrollTo).toHaveBeenCalledWith(0, 950);
        expect(getListPostService).toHaveBeenCalledTimes(requests);
        fireEvent.click(screen.getByRole('button', { name: 'fresh-search' }));
        await expectLatestQuery({ offset: 0, search: '', categoryWorktypeCode: [] });
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    });
    it('discards a late response from the old filter and shows only the latest results', async () => {
        let release;
        getListPostService.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        fireEvent.click(screen.getByRole('button', { name:'search' }));
        await screen.findByText('React Developer');
        release({errCode:0,count:1,data:[{id:9,name:'Obsolete result'}]});
        await waitFor(()=>expect(screen.queryByText('Obsolete result')).not.toBeInTheDocument());
    });
    it('clears old rows on failure and retries the same filters explicitly', async () => {
        render(<BrowserRouter><JobPage /></BrowserRouter>);await screen.findByText('React Developer');
        getListPostService.mockRejectedValueOnce(new Error('Offline'));
        fireEvent.click(screen.getByRole('button',{name:'salary'}));await screen.findByText('Offline');
        expect(screen.queryByText('React Developer')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));await screen.findByText('React Developer');
        expect(getListPostService).toHaveBeenLastCalledWith(expect.objectContaining({salaryJobCode:['HIGH'],offset:0}));
    });
    beforeEach(() => {
        jest.clearAllMocks();
        clearJobSearchHistory();
        window.history.replaceState({}, "", "/job");
        getListPostService.mockResolvedValue(success);
    });

    it("applies a category filter supplied by a home-page deep link", async () => {
        window.history.replaceState({}, "", "/job?categoryJobCode=IT%20%26%20Data");
        render(<BrowserRouter><JobPage /></BrowserRouter>);

        await expectLatestQuery({
            categoryJobCode: "IT & Data",
            offset: 0,
        });
    });

    it("loads the first page and displays returned jobs and pagination", async () => {
        render(<BrowserRouter><JobPage /></BrowserRouter>);

        await expectLatestQuery({
            limit: 5,
            offset: 0,
            categoryJobCode: "",
            addressCode: "",
            salaryJobCode: [],
            categoryJoblevelCode: [],
            categoryWorktypeCode: [],
            experienceJobCode: [],
            search: "",
        });
        expect(await screen.findByText("React Developer")).toBeInTheDocument();
        expect(screen.getByTestId("job-count")).toHaveTextContent("12");
        expect(screen.getByTestId("page-count")).toHaveTextContent("3");
        expect(screen.getByTestId("force-page")).toHaveTextContent("0");
    });

    it.each([
        ["work-type", "categoryWorktypeCode", "REMOTE"],
        ["salary", "salaryJobCode", "HIGH"],
        ["experience", "experienceJobCode", "SENIOR"],
        ["job-level", "categoryJoblevelCode", "LEAD"],
    ])("adds and removes the %s multi-select filter", async (button, field, value) => {
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: [value], offset: 0 });

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: [], offset: 0 });
    });

    it.each([
        ["job-type", "categoryJobCode", "TECH"],
        ["location", "addressCode", "HCM"],
    ])("toggles the %s single-select filter", async (button, field, value) => {
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: value });

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: "" });
    });

    it("normalizes a search and keeps active filters when changing page", async () => {
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: "work-type" }));
        await expectLatestQuery({ categoryWorktypeCode: ["REMOTE"] });
        fireEvent.click(screen.getByRole("button", { name: "search" }));
        await expectLatestQuery({ search: "React Engineer", offset: 0 });

        fireEvent.click(screen.getByRole("button", { name: "page-three" }));
        await expectLatestQuery({
            limit: 5,
            offset: 10,
            categoryWorktypeCode: ["REMOTE"],
            search: "React Engineer",
            sortName: undefined,
        });
        expect(screen.getByTestId("force-page")).toHaveTextContent("2");
    });

    it("returns to the first unfiltered page after the search keyword is cleared", async () => {
        render(<BrowserRouter><JobPage /></BrowserRouter>);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: "search" }));
        await expectLatestQuery({ search: "React Engineer", offset: 0 });
        fireEvent.click(screen.getByRole("button", { name: "page-three" }));
        await expectLatestQuery({ search: "React Engineer", offset: 10 });

        fireEvent.click(screen.getByRole("button", { name: "clear-search" }));
        await expectLatestQuery({ search: "", offset: 0 });
        expect(screen.getByTestId("force-page")).toHaveTextContent("0");
    });

    it("keeps the current empty result when the API returns an error", async () => {
        getListPostService.mockResolvedValue({ errCode: 1, data: [{ id: 9, name: "ignored" }] });
        render(<BrowserRouter><JobPage /></BrowserRouter>);

        await waitFor(() => expect(getListPostService).toHaveBeenCalled());
        expect(screen.queryByText("ignored")).not.toBeInTheDocument();
        expect(screen.getByTestId("job-count")).toHaveTextContent("0");
    });
});
