import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { getAllCodeService } from "../service/userService";
import { clearAllCodeCache, useFetchAllcode } from "./fetch";

jest.mock("../service/userService", () => ({
    getAllCodeService: jest.fn(),
}));

describe("useFetchAllcode", () => {
    beforeEach(() => { jest.clearAllMocks(); clearAllCodeCache(); });

    it('restores filter options synchronously and preserves them when refresh fails', async () => {
        const rows = [{ code: 'remote', value: 'Remote' }];
        getAllCodeService.mockResolvedValueOnce({ errCode: 0, data: rows });
        const first = renderHook(() => useFetchAllcode('WORKTYPE', { retain: true }));
        await waitFor(() => expect(first.result.current.data).toEqual(rows));
        first.unmount();
        getAllCodeService.mockRejectedValueOnce(new Error('Offline'));
        const second = renderHook(() => useFetchAllcode('WORKTYPE', { retain: true }));
        expect(second.result.current.data).toEqual(rows);
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalledTimes(2));
        expect(second.result.current.data).toEqual(rows);
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
});
