import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getAllCodeService } from "../service/userService";
import { clearAllCodeCache, fetchAllCode, getCachedAllCode, preloadAllCode, useFetchAllcode } from "./fetch";

jest.mock("../service/userService", () => ({
    getAllCodeService: jest.fn(),
}));

describe("useFetchAllcode", () => {
    let now;
    beforeEach(() => {
        jest.clearAllMocks(); localStorage.clear(); clearAllCodeCache();
        now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });
    afterEach(() => jest.restoreAllMocks());

    it('restores filter options synchronously and preserves them when refresh fails', async () => {
        const rows = [{ code: 'remote', value: 'Remote' }];
        getAllCodeService.mockResolvedValueOnce({ errCode: 0, data: rows });
        const first = renderHook(() => useFetchAllcode('WORKTYPE', { retain: true }));
        await waitFor(() => expect(first.result.current.data).toEqual(rows));
        first.unmount();
        now.mockReturnValue(1_060_000);
        getAllCodeService.mockRejectedValueOnce(new Error('Offline'));
        const second = renderHook(() => useFetchAllcode('WORKTYPE', { retain: true }));
        expect(second.result.current.data).toEqual(rows);
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalledTimes(2));
        expect(second.result.current.data).toEqual(rows);
    });

    it('reuses fresh options by default when navigating between screens', async () => {
        const rows = [{ code: 'HN', value: 'Hà Nội' }];
        getAllCodeService.mockResolvedValue({ errCode: 0, data: rows });
        const first = renderHook(() => useFetchAllcode('PROVINCE'));
        await waitFor(() => expect(first.result.current.data).toEqual(rows));
        first.unmount();
        const second = renderHook(() => useFetchAllcode('PROVINCE'));
        expect(second.result.current.data).toEqual(rows);
        await act(async () => {});
        expect(getAllCodeService).toHaveBeenCalledTimes(1);
    });

    it('refreshes expired options and allows callers to bypass retention', async () => {
        const rows = [{ code: 'HN', value: 'Hà Nội' }];
        getAllCodeService.mockResolvedValue({ errCode: 0, data: rows });
        await fetchAllCode('PROVINCE');
        now.mockReturnValue(1_060_000);
        await fetchAllCode('PROVINCE');
        await fetchAllCode('PROVINCE', { retain: false });
        expect(getAllCodeService).toHaveBeenCalledTimes(3);
    });

    it('does not cache errors and retries on the next visit', async () => {
        getAllCodeService.mockResolvedValueOnce({ errCode: 1, data: [] })
            .mockResolvedValueOnce({ errCode: 0, data: [] });
        await fetchAllCode('PROVINCE');
        expect(getCachedAllCode('PROVINCE')).toBeNull();
        await fetchAllCode('PROVINCE');
        expect(getCachedAllCode('PROVINCE')).toEqual([]);
        expect(getAllCodeService).toHaveBeenCalledTimes(2);
    });

    it('does not reuse another account request or save a late response after invalidation', async () => {
        let finishOld;
        getAllCodeService.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
            .mockResolvedValue({ errCode: 0, data: [{ code: 'NEW' }] });
        localStorage.setItem('token_user', 'account-a');
        const oldRequest = fetchAllCode('ROLE');
        localStorage.setItem('token_user', 'account-b');
        await fetchAllCode('ROLE');
        clearAllCodeCache();
        finishOld({ errCode: 0, data: [{ code: 'OLD' }] });
        await oldRequest;
        expect(getCachedAllCode('ROLE')).toBeNull();
        await fetchAllCode('ROLE');
        expect(getCachedAllCode('ROLE')).toEqual([{ code: 'NEW' }]);
        expect(getAllCodeService).toHaveBeenCalledTimes(3);
    });

    it('does not restore pre-edit options from an in-flight request after a catalog edit', async () => {
        let finish;
        getAllCodeService.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const request = fetchAllCode('JOBTYPE');
        clearAllCodeCache();
        finish({ errCode: 0, data: [{ code: 'REMOVED' }] });
        await request;
        expect(getCachedAllCode('JOBTYPE')).toBeNull();
    });

    it("loads all-code data for the requested type", async () => {
        const rows = [{ code: "ADMIN", value: "Admin" }];
        getAllCodeService.mockResolvedValue({ errCode: 0, data: rows });

        const { result } = renderHook(() => useFetchAllcode("ROLE"));
        expect(result.current.data).toEqual([]);
        await waitFor(() => expect(result.current.data).toEqual(rows));
        expect(getAllCodeService).toHaveBeenCalledTimes(1);
        expect(getAllCodeService).toHaveBeenCalledWith("ROLE");
    });

    it("keeps an empty list when the API reports an error", async () => {
        getAllCodeService.mockResolvedValue({ errCode: 1, data: [{ code: "BAD" }] });
        const { result } = renderHook(() => useFetchAllcode("ROLE"));
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalled());
        expect(result.current.data).toEqual([]);
    });

    it("loads only once even when the component rerenders", async () => {
        getAllCodeService.mockResolvedValue({ errCode: 0, data: [] });
        const { rerender } = renderHook(({ type }) => useFetchAllcode(type), {
            initialProps: { type: "ROLE" },
        });
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalledTimes(1));
        rerender({ type: "GENDER" });
        expect(getAllCodeService).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent in-flight requests and skips preloading already cached types", async () => {
        let finish;
        getAllCodeService.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const first = renderHook(() => useFetchAllcode("PROVINCE", { retain: true }));
        const second = renderHook(() => useFetchAllcode("PROVINCE", { retain: true }));
        const shared = fetchAllCode("PROVINCE", { retain: true });

        expect(getAllCodeService).toHaveBeenCalledTimes(1);
        const rows = [{ code: "HN", value: "Hà Nội" }];
        await act(async () => {
            finish({ errCode: 0, data: rows });
            await shared;
        });
        expect(first.result.current.data).toEqual(rows);
        expect(second.result.current.data).toEqual(rows);

        getAllCodeService.mockResolvedValueOnce({ errCode: 0, data: [{ code: "IT", value: "IT" }] });
        await preloadAllCode(["PROVINCE", "JOBTYPE"]);
        expect(getAllCodeService).toHaveBeenCalledTimes(2);
        expect(getAllCodeService).toHaveBeenLastCalledWith("JOBTYPE");
    });
});
