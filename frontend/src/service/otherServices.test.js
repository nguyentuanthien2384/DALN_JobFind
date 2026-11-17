import axios from "../axios";
import * as cv from "./cvService";
import * as applications from "./applicationService";
import * as ai from "./aiSearchService";
import * as reports from "./adminReportService";

// This Jest/jsdom version predates Web Crypto; use Node's real implementation.
beforeAll(() => { Object.defineProperty(globalThis, "crypto", { value: require("crypto").webcrypto, configurable: true }); });

jest.mock("../axios", () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const runCases = (namespace, cases) => {
    test.each(cases)("%s builds the expected request", async (...row) => {
        const [name, method, args, url, body] = row;
        const expected = { request: name };
        axios[method].mockResolvedValueOnce(expected);
        await expect(namespace[name](...args)).resolves.toBe(expected);
        expect(axios[method]).toHaveBeenCalledWith(...(body === undefined ? [url] : [url, body]));
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    Object.values(axios).forEach((mock) => mock.mockResolvedValue({ errCode: 0 }));
});

describe("cvService", () => {
    it("encodes special skills and keyword characters without changing their meaning", async () => {
        await cv.getFilterCv({ limit: 5, offset: 0, otherSkills: ['C++', 'C#', '.NET'], keyword: 'R&D', skillMode: 'all', minMatch: 70, sort: 'name' });
        const params = new URL(axios.get.mock.calls[0][0], 'https://jobfind.test').searchParams;
        expect(params.get('otherSkills')).toBe('C++,C#,.NET');
        expect(params.get('keyword')).toBe('R&D');
        expect(params.get('minMatch')).toBe('70');
        expect(params.get('skillMode')).toBe('all');
        expect(params.get('sort')).toBe('name');
    });
    runCases(cv, [
        ["createNewCv", "post", [{ postId: 2 }], "/api/create-new-cv", { postId: 2 }],
        ["getAllListCvByPostService", "get", [{ limit: 10, offset: 1, postId: 2 }], "/api/get-all-list-cv-by-post?limit=10&offset=1&postId=2"],
        ["getDetailCvService", "get", [2, "EMPLOYER"], "/api/get-detail-cv-by-id?cvId=2&roleCode=EMPLOYER"],
        ["getAllListCvByUserIdService", "get", [{ limit: 10, offset: 1, userId: 3 }], "/api/get-all-cv-by-userId?limit=10&offset=1&userId=3"],
        ["getStatisticalCv", "get", [{ limit: 5, offset: 0, fromDate: "a", toDate: "b", companyId: 4 }], "/api/get-statistical-cv?limit=5&offset=0&fromDate=a&toDate=b&companyId=4"],
        ["getFilterCv", "get", [{ limit: 5, offset: 0, experienceJobCode: "E", categoryJobCode: "IT", listSkills: "JS,TS", otherSkills: "Go", salaryCode: "S", provinceCode: "HN" }], "/api/fillter-cv-by-selection?limit=5&offset=0&experienceJobCode=E&categoryJobCode=IT&listSkills=JS%2CTS&otherSkills=Go&salaryCode=S&provinceCode=HN"],
        ["checkSeeCandiate", "get", [{ candidateId: 3 }], "/api/check-see-candiate?candidateId=3"],
    ]);
});

describe("applicationService", () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('token_user', 'jf-session:application-service-test');
        localStorage.setItem('userData', JSON.stringify({ id: 3, roleCode: 'EMPLOYER', companyId: 9 }));
    });

    runCases(applications, [
        ["getStages", "get", [], "/api/applications/stages"],
        ["getApplications", "get", [{ status: "screening", page: 2, empty: "", nil: null }], "/api/applications?status=screening&page=2"],
        ["getApplicationDetail", "get", [4], "/api/applications/4"],
        ["moveApplicationStage", "patch", [4, "interview", "qualified"], "/api/applications/4/stage", { stage: "interview", reason: "qualified" }],
        ["sendApplicationDecision", "post", [4, "accepted", "Welcome"], "/api/applications/4/decision-notification", { decision: "accepted", message: "Welcome" }],
        ["rateApplication", "patch", [4, 5], "/api/applications/4/rating", { rating: 5 }],
        ["addApplicationNote", "post", [4, "Strong profile"], "/api/applications/4/notes", { body: "Strong profile" }],
        ["getTalentPool", "get", [{ skill: "React", page: 1, empty: undefined }], "/api/talent-pool?skill=React&page=1"],
        ["saveToTalentPool", "post", [{ candidateId: 8 }], "/api/talent-pool", { candidateId: 8 }],
        ["removeFromTalentPool", "delete", [8], "/api/talent-pool/8"],
        ["getMyApplications", "get", [], "/api/my-applications"],
    ]);

    it("omits optional job and query parameters", async () => {
        await applications.getApplicationBoard();
        await applications.getFunnel();
        await applications.getApplications();
        await applications.getTalentPool();
        expect(axios.get.mock.calls).toEqual([
            ["/api/applications/board", { timeout: 15000 }],
            ["/api/applications/funnel", { timeout: 15000 }],
            ["/api/applications?"],
            ["/api/talent-pool?"],
        ]);
    });

    it.each([
        ['getApplicationBoard', '/api/applications/board?jobId=12'],
        ['getFunnel', '/api/applications/funnel?jobId=12'],
    ])('%s shares only a pending read and bounds its network wait', async (name, url) => {
        let finish;
        axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const first = applications[name](12);
        const duplicate = applications[name](12);
        expect(duplicate).toBe(first);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get).toHaveBeenLastCalledWith(url, { timeout: 15000 });
        const result = { errCode: 0, data: { total: 4 } };
        finish(result);
        await expect(first).resolves.toBe(result);
        await expect(duplicate).resolves.toBe(result);
        await applications[name](12);
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['user identity', { id: 4 }, undefined],
        ['role', { roleCode: 'ADMIN' }, undefined],
        ['company', { companyId: 10 }, undefined],
        ['company approval', { companyCensorCode: 'CS2' }, undefined],
        ['session', {}, 'jf-session:another-session'],
    ])('isolates pending reads when the %s changes', async (_label, userPatch, session) => {
        const finishes = [];
        axios.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
        const first = applications.getApplicationBoard(12);
        localStorage.setItem('userData', JSON.stringify({ id: 3, roleCode: 'EMPLOYER', companyId: 9, ...userPatch }));
        if (session) localStorage.setItem('token_user', session);
        const next = applications.getApplicationBoard(12);
        expect(next).not.toBe(first);
        expect(axios.get).toHaveBeenCalledTimes(2);
        finishes.forEach(finish => finish({ errCode: 0 }));
        await Promise.all([first, next]);
    });

    it('keeps different job filters and board/funnel endpoints independent', async () => {
        const finishes = [];
        axios.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
        const requests = [applications.getApplicationBoard(12), applications.getApplicationBoard(13), applications.getFunnel(12)];
        expect(new Set(requests).size).toBe(3);
        expect(axios.get).toHaveBeenCalledTimes(3);
        finishes.forEach(finish => finish({ errCode: 0 }));
        await Promise.all(requests);
    });

    it.each(['getApplicationBoard', 'getFunnel'])('%s permits a fresh request after rejection', async (name) => {
        let rejectPending;
        axios.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPending = reject; }));
        const first = applications[name](12);
        expect(applications[name](12)).toBe(first);
        const error = new Error('Request timed out');
        const rejected = expect(first).rejects.toBe(error);
        rejectPending(error);
        await rejected;
        await applications[name](12);
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['moveApplicationStage', [4, 'interview', 'qualified'], 'patch'],
        ['sendApplicationDecision', [4, 'accepted', 'Welcome'], 'post'],
        ['sendInterviewInvitation', [4, 'Interview', { interviewDate: '2026-11-18' }], 'post'],
        ['rateApplication', [4, 5], 'patch'],
        ['addApplicationNote', [4, 'Strong profile'], 'post'],
    ])('%s invalidates pending snapshots only after its successful write', async (name, args, method) => {
        const finishes = [];
        axios.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
        const oldBoard = applications.getApplicationBoard(12);
        const oldFunnel = applications.getFunnel(12);
        await applications[name](...args);
        expect(axios[method]).toHaveBeenCalledTimes(1);
        const freshBoard = applications.getApplicationBoard(12);
        const freshFunnel = applications.getFunnel(12);
        expect(freshBoard).not.toBe(oldBoard);
        expect(freshFunnel).not.toBe(oldFunnel);
        expect(axios.get).toHaveBeenCalledTimes(4);

        finishes[0]({ errCode: 0, data: 'old board' });
        finishes[1]({ errCode: 0, data: 'old funnel' });
        await Promise.all([oldBoard, oldFunnel]);
        expect(applications.getApplicationBoard(12)).toBe(freshBoard);
        expect(applications.getFunnel(12)).toBe(freshFunnel);
        finishes[2]({ errCode: 0, data: 'fresh board' });
        finishes[3]({ errCode: 0, data: 'fresh funnel' });
        await Promise.all([freshBoard, freshFunnel]);
    });

    it('does not invalidate snapshots when an application mutation is rejected', async () => {
        let finish;
        axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = applications.getFunnel(12);
        axios.patch.mockResolvedValueOnce({ errCode: 4, errMessage: 'Transition denied' });
        await applications.moveApplicationStage(4, 'interview');
        expect(applications.getFunnel(12)).toBe(pending);
        finish({ errCode: 0 });
        await pending;
    });

    it('invalidates the initiating scope when a write completes after the account changes', async () => {
        const finishes = [];
        axios.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
        const oldScopeRead = applications.getFunnel(12);
        let finishMutation;
        axios.patch.mockImplementationOnce(() => new Promise(resolve => { finishMutation = resolve; }));
        const mutation = applications.rateApplication(4, 5);
        localStorage.setItem('token_user', 'jf-session:another-account');
        localStorage.setItem('userData', JSON.stringify({ id: 8, roleCode: 'COMPANY', companyId: 15 }));
        const otherScopeRead = applications.getFunnel(12);
        finishMutation({ errCode: 0 });
        await mutation;
        expect(applications.getFunnel(12)).toBe(otherScopeRead);

        localStorage.setItem('token_user', 'jf-session:application-service-test');
        localStorage.setItem('userData', JSON.stringify({ id: 3, roleCode: 'EMPLOYER', companyId: 9 }));
        const freshScopeRead = applications.getFunnel(12);
        expect(freshScopeRead).not.toBe(oldScopeRead);
        expect(axios.get).toHaveBeenCalledTimes(3);
        finishes.forEach(finish => finish({ errCode: 0 }));
        await Promise.all([oldScopeRead, otherScopeRead, freshScopeRead]);
    });

    it('allows another service to invalidate snapshots after changing an application', async () => {
        const finishes = [];
        axios.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
        const oldRead = applications.getApplicationBoard(12);
        applications.invalidateApplicationSnapshots();
        const freshRead = applications.getApplicationBoard(12);
        expect(freshRead).not.toBe(oldRead);
        expect(axios.get).toHaveBeenCalledTimes(2);
        finishes.forEach(finish => finish({ errCode: 0 }));
        await Promise.all([oldRead, freshRead]);
    });
});

describe("aiSearchService", () => {
    runCases(ai, [
        ["searchJobs", "get", [{ q: "React dev", page: 2, blank: "", nil: null }], "/api/search/jobs?q=React+dev&page=2"],
        ["suggestJobs", "get", ["C# & .NET"], "/api/search/suggest?q=C%23%20%26%20.NET"],
        ["getSearchFacets", "get", [], "/api/search/facets"],
        ["getRelatedJobs", "get", [7, 3], "/api/search/related/7?limit=3"],
        ["getAiTask", "get", ["task-1"], "/api/ai/tasks/task-1"],
        ["getMyProfile", "get", [], "/api/profile"],
        ["updateMyProfile", "put", [{ name: "Lan" }], "/api/profile", { name: "Lan" }],
        ["listMyCvs", "get", [], "/api/profile/cvs"],
        ["createMyCv", "post", [{ title: "CV" }], "/api/profile/cvs", { title: "CV" }],
        ["updateMyCv", "put", [3, { title: "CV2" }], "/api/profile/cvs/3", { title: "CV2" }],
        ["deleteMyCv", "delete", [3], "/api/profile/cvs/3"],
        ["importParsedCv", "post", [{ name: "Lan" }, "cv.pdf"], "/api/profile/cvs/import", { parsed: { name: "Lan" }, fileName: "cv.pdf" }],
        ["getSystemStatus", "get", [], "/status"],
    ]);

    it("uses defaults for related jobs and cover-letter language", async () => {
        await ai.getRelatedJobs(8);
        await ai.coverLetterAi("resume", 8);
        expect(axios.get).toHaveBeenCalledWith("/api/search/related/8?limit=6");
        expect(axios.post).toHaveBeenCalledWith("/api/ai/cover-letter", {
            resumeText: "resume",
            jobId: 8,
            language: "en",
        }, { headers: { "Idempotency-Key": expect.any(String) }, timeout: 15000 });
    });

    it("returns a completed AI task result", async () => {
        axios.get.mockResolvedValueOnce({ errCode: 0, data: { status: "done", result: { score: 91 } } });
        await expect(ai.waitForAiTask("task-1", { intervalMs: 0, timeoutMs: 1000 })).resolves.toEqual({ score: 91 });
    });

    it("throws the backend AI failure", async () => {
        axios.get.mockResolvedValueOnce({ errCode: 0, data: { status: "failed", error: "Bad CV" } });
        await expect(ai.waitForAiTask("task-1", { intervalMs: 0, timeoutMs: 1000 })).rejects.toThrow("Bad CV");
    });

    it("uses a fallback failure message", async () => {
        axios.get.mockResolvedValueOnce({ errCode: 0, data: { status: "failed" } });
        await expect(ai.waitForAiTask("task-1", { intervalMs: 0, timeoutMs: 1000 })).rejects.toThrow("Xử lý AI thất bại");
    });

    it("polls pending tasks before returning the result", async () => {
        axios.get
            .mockResolvedValueOnce({ errCode: 0, data: { status: "pending" } })
            .mockResolvedValueOnce({ errCode: 0, data: { status: "done", result: "ready" } });
        await expect(ai.waitForAiTask("task-1", { intervalMs: 0, timeoutMs: 1000 })).resolves.toBe("ready");
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("times out when a task never completes", async () => {
        const now = jest.spyOn(Date, "now")
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2);
        axios.get.mockResolvedValue({ errCode: 1 });
        await expect(ai.waitForAiTask("task-1", { intervalMs: 0, timeoutMs: 1 })).rejects.toThrow("Quá thời gian chờ kết quả AI");
        now.mockRestore();
    });
});

describe("adminReportService", () => {
    runCases(reports, [
        ["getOverview", "get", [{ from: "2026-01-01", empty: "" }], "/api/admin/reports/overview?from=2026-01-01"],
        ["getTimeseries", "get", [{ interval: "day" }], "/api/admin/reports/timeseries?interval=day"],
        ["getDistribution", "get", [], "/api/admin/reports/distribution"],
        ["getSystemFunnel", "get", [], "/api/admin/reports/funnel"],
        ["getActivity", "get", [{ limit: 5 }], "/api/admin/reports/activity?limit=5"],
        ["getAuditLogs", "get", [{ page: 2, actor: null }], "/api/admin/audit?page=2"],
        ["getTargetHistory", "get", ["post", 51], "/api/admin/audit/target/post/51"],
        ["getMasterData", "get", ["skills"], "/api/admin/master-data?type=skills"],
        ["saveMasterDataTag", "post", [{ type: "skill", value: "React" }], "/api/admin/master-data", { type: "skill", value: "React" }],
        ["deleteMasterDataTag", "delete", [7], "/api/admin/master-data/7"],
    ]);

    it("does not append a question mark when report filters are absent", async () => {
        await reports.getOverview();
        expect(axios.get).toHaveBeenCalledWith("/api/admin/reports/overview");
    });
});
