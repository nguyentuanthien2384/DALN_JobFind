import {
    checkFavoritePostService,
    getDetailPostByIdService,
    getRelatedPostService,
} from "../../service/userService";
import {
    clearJobDetailResourceCache,
    getCachedJobDetail,
    invalidateJobDetail,
    loadFavoriteState,
    loadJobDetail,
    loadRelatedJobs,
    prefetchJobDetail,
} from "./jobDetailResource";

jest.mock("../../service/userService", () => ({
    checkFavoritePostService: jest.fn(),
    getDetailPostByIdService: jest.fn(),
    getRelatedPostService: jest.fn(),
}));

describe("job detail resource", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        clearJobDetailResourceCache();
    });

    it("reuses prefetched detail data when the route opens", async () => {
        const response = { errCode: 0, data: { id: 42, companyData: { id: 9 } } };
        getDetailPostByIdService.mockResolvedValue(response);

        await prefetchJobDetail(42);
        await expect(loadJobDetail("42")).resolves.toEqual(response);

        expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
        expect(getDetailPostByIdService).toHaveBeenCalledWith(42);
    });

    it("joins simultaneous requests for detail, related jobs and favorite state", async () => {
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { id: 7 } });
        getRelatedPostService.mockResolvedValue({ errCode: 0, data: [] });
        checkFavoritePostService.mockResolvedValue({ errCode: 0, isFavorite: false });

        await Promise.all([
            loadJobDetail(7),
            loadJobDetail("7"),
            loadRelatedJobs(7),
            loadRelatedJobs("7"),
            loadFavoriteState(7, 3),
            loadFavoriteState("7", "3"),
        ]);

        expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
        expect(getRelatedPostService).toHaveBeenCalledTimes(1);
        expect(checkFavoritePostService).toHaveBeenCalledTimes(1);
    });

    it("does not cache a failed prefetch", async () => {
        getDetailPostByIdService
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ errCode: 0, data: { id: 8 } });

        await expect(prefetchJobDetail(8)).resolves.toBeNull();
        await expect(loadJobDetail(8)).resolves.toEqual({ errCode: 0, data: { id: 8 } });
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(2);
    });

    it('fetches fresh application totals after invalidation', async () => {
        getDetailPostByIdService.mockResolvedValueOnce({ errCode: 0, data: { id: 7, applicationCount: 4 } })
            .mockResolvedValueOnce({ errCode: 0, data: { id: 7, applicationCount: 5 } });
        await loadJobDetail(7);
        invalidateJobDetail(7);
        expect((await loadJobDetail(7)).data.applicationCount).toBe(5);
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(2);
    });

    it('never reuses privileged detail after logout or caches a late privileged response', async () => {
        localStorage.setItem('token_user', 'privileged');
        let finish;
        getDetailPostByIdService.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const oldRequest = loadJobDetail(7);
        await Promise.resolve();
        localStorage.removeItem('token_user');
        expect(getCachedJobDetail(7)).toBeNull();
        getDetailPostByIdService.mockResolvedValueOnce({ errCode: 0, data: null });
        await loadJobDetail(7);
        finish({ errCode: 0, data: { id: 7, statusCode: 'PS3' } });
        await oldRequest;
        expect(getCachedJobDetail(7)).toBeNull();
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(2);
    });

    it('starts a fresh request after submission even if an older detail request is pending', async () => {
        let finishOld;
        getDetailPostByIdService.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
            .mockResolvedValueOnce({ errCode: 0, data: { id: 7, applicationCount: 5 } });
        const oldRequest = loadJobDetail(7);
        await Promise.resolve();
        invalidateJobDetail(7);
        expect((await loadJobDetail(7)).data.applicationCount).toBe(5);
        finishOld({ errCode: 0, data: { id: 7, applicationCount: 4 } });
        expect(await oldRequest).toEqual({ stale: true });
        expect(getCachedJobDetail(7).applicationCount).toBe(5);
    });
});
