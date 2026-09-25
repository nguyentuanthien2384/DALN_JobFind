import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getAllCodeService } from "../service/userService";
import { clearAllCodeCache, useFetchAllcode } from "./fetch";
import { invalidateReferenceData } from '../service/referenceDataEvents';

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

    it('orders IT levels by progression without changing filter codes or the API response', async () => {
        const rows = [
            { code: 'manager', value: 'Manager' },
            { code: 'senior', value: 'Senior' },
            { code: 'fresher', value: 'Fresher' },
            { code: 'lead', value: 'Lead' },
            { code: 'middle', value: 'Middle' },
            { code: 'junior', value: 'Junior' },
            { code: 'intern', value: 'Intern' },
        ];
        const original = [...rows];
        getAllCodeService.mockResolvedValue({ errCode: 0, data: rows });
        const first = renderHook(() => useFetchAllcode('JOBLEVEL', { retain: true }));
        await waitFor(() => expect(first.result.current.data.map(row => row.code)).toEqual([
            'intern', 'fresher', 'junior', 'middle', 'senior', 'lead', 'manager',
        ]));
        expect(rows).toEqual(original);
        first.unmount();
        const second = renderHook(() => useFetchAllcode('JOBLEVEL', { retain: true }));
        expect(second.result.current.data).toEqual(first.result.current.data);
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalledTimes(2));
    });

    it("keeps an empty list when the API reports an error", async () => {
        getAllCodeService.mockResolvedValue({ errCode: 1, data: [{ code: "BAD" }] });
        const { result } = renderHook(() => useFetchAllcode("ROLE"));
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalled());
        expect(result.current.data).toEqual([]);
    });

    it("does not reload for an ordinary rerender but loads a changed catalog type", async () => {
        getAllCodeService.mockResolvedValue({ errCode: 0, data: [] });
        const { rerender } = renderHook(({ type }) => useFetchAllcode(type), {
            initialProps: { type: "ROLE" },
        });
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalledTimes(1));
        rerender({ type: "ROLE" });
        expect(getAllCodeService).toHaveBeenCalledTimes(1);
        rerender({ type: "GENDER" });
        await waitFor(() => expect(getAllCodeService).toHaveBeenCalledTimes(2));
        expect(getAllCodeService).toHaveBeenLastCalledWith('GENDER');
    });

    it('refreshes mounted filters and forms after a catalog edit, ignoring an older pending response', async () => {
        let finishOld;
        getAllCodeService.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
        const filter = renderHook(() => useFetchAllcode('JOBLEVEL', { retain: true }));
        const updated = [{ code: 'junior', value: 'Junior Developer' }, { code: 'senior', value: 'Senior' }];
        getAllCodeService.mockResolvedValue({ errCode: 0, data: updated });
        act(() => invalidateReferenceData());
        await waitFor(() => expect(filter.result.current.data).toEqual(updated));
        await act(async () => finishOld({ errCode: 0, data: [{ code: 'nhan-vien', value: 'Nhân viên' }] }));
        expect(filter.result.current.data).toEqual(updated);
        const form = renderHook(() => useFetchAllcode('JOBLEVEL'));
        await waitFor(() => expect(form.result.current.data).toEqual(filter.result.current.data));
    });

    it('refreshes on returning to a tab without clearing loaded options on a network failure', async () => {
        const original = [{ code: 'junior', value: 'Junior' }];
        const updated = [{ code: 'junior', value: 'Junior Developer' }];
        getAllCodeService.mockResolvedValueOnce({ errCode: 0, data: original });
        const { result } = renderHook(() => useFetchAllcode('JOBLEVEL', { retain: true }));
        await waitFor(() => expect(result.current.data).toEqual(original));
        getAllCodeService.mockResolvedValueOnce({ errCode: 0, data: updated });
        act(() => window.dispatchEvent(new Event('focus')));
        await waitFor(() => expect(result.current.data).toEqual(updated));
        getAllCodeService.mockRejectedValueOnce(new Error('offline'));
        await act(async () => window.dispatchEvent(new Event('online')));
        expect(result.current.data).toEqual(updated);
    });
});
