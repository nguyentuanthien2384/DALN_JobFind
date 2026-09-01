import {
    checkFavoritePostService,
    getDetailPostByIdService,
    getRelatedPostService,
} from "../../service/userService";
import {
    clearJobDetailResourceCache,
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
});
