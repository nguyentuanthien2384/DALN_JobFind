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
    runCases(cv, [
        ["createNewCv", "post", [{ postId: 2 }], "/api/create-new-cv", { postId: 2 }],
        ["getAllListCvByPostService", "get", [{ limit: 10, offset: 1, postId: 2 }], "/api/get-all-list-cv-by-post?limit=10&offset=1&postId=2"],
        ["getDetailCvService", "get", [2, "EMPLOYER"], "/api/get-detail-cv-by-id?cvId=2&roleCode=EMPLOYER"],
        ["getAllListCvByUserIdService", "get", [{ limit: 10, offset: 1, userId: 3 }], "/api/get-all-cv-by-userId?limit=10&offset=1&userId=3"],
        ["getStatisticalCv", "get", [{ limit: 5, offset: 0, fromDate: "a", toDate: "b", companyId: 4 }], "/api/get-statistical-cv?limit=5&offset=0&fromDate=a&toDate=b&companyId=4"],
        ["getFilterCv", "get", [{ limit: 5, offset: 0, experienceJobCode: "E", categoryJobCode: "IT", listSkills: "JS,TS", otherSkills: "Go", salaryCode: "S", provinceCode: "HN" }], "/api/fillter-cv-by-selection?limit=5&offset=0&experienceJobCode=E&categoryJobCode=IT&listSkills=JS,TS&otherSkills=Go&salaryCode=S&provinceCode=HN"],
        ["checkSeeCandiate", "get", [{ candidateId: 3 }], "/api/check-see-candiate?candidateId=3"],
    ]);
});

describe("applicationService", () => {
    runCases(applications, [
        ["getApplicationBoard", "get", [12], "/api/applications/board?jobId=12"],
        ["getStages", "get", [], "/api/applications/stages"],
        ["getApplications", "get", [{ status: "screening", page: 2, empty: "", nil: null }], "/api/applications?status=screening&page=2"],
        ["getApplicationDetail", "get", [4], "/api/applications/4"],
        ["moveApplicationStage", "patch", [4, "interview", "qualified"], "/api/applications/4/stage", { stage: "interview", reason: "qualified" }],
        ["sendApplicationDecision", "post", [4, "accepted", "Welcome"], "/api/applications/4/decision-notification", { decision: "accepted", message: "Welcome" }],
        ["rateApplication", "patch", [4, 5], "/api/applications/4/rating", { rating: 5 }],
        ["addApplicationNote", "post", [4, "Strong profile"], "/api/applications/4/notes", { body: "Strong profile" }],
        ["getFunnel", "get", [12], "/api/applications/funnel?jobId=12"],
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
            ["/api/applications/board"],
            ["/api/applications/funnel"],
            ["/api/applications?"],
            ["/api/talent-pool?"],
        ]);
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
