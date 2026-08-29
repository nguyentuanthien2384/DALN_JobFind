import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { getAllCodeService } from "../service/userService";
import { useFetchAllcode } from "./fetch";

jest.mock("../service/userService", () => ({
    getAllCodeService: jest.fn(),
}));

describe("useFetchAllcode", () => {
    beforeEach(() => jest.clearAllMocks());

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
