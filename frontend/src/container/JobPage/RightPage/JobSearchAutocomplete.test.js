import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { suggestJobs } from "../../../service/aiSearchService";
import JobSearchAutocomplete from "./JobSearchAutocomplete";

jest.mock("../../../service/aiSearchService", () => ({
    suggestJobs: jest.fn(),
}));

const typeKeyword = (value) => {
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm kiếm việc làm" }), {
        target: { value },
    });
};

const finishDebounce = async () => {
    await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve();
    });
};

describe("JobSearchAutocomplete", () => {
    let scrollIntoViewMock;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        suggestJobs.mockResolvedValue({ errCode: 0, data: [] });
        scrollIntoViewMock = jest.fn();
        Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
            configurable: true,
            value: scrollIntoViewMock,
        });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("opens immediately but only requests remote suggestions from two characters", async () => {
        render(<JobSearchAutocomplete onSearch={jest.fn()} />);

        typeKeyword("r");
        expect(screen.getByRole("listbox", { name: "Gợi ý tìm kiếm" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /r.*Tìm kiếm việc làm/i })).toBeInTheDocument();
        await finishDebounce();
        expect(suggestJobs).not.toHaveBeenCalled();

        typeKeyword("re");
        await finishDebounce();
        expect(suggestJobs).toHaveBeenCalledWith("re");
    });

    it("renders job suggestions with their companies and submits one selected with the mouse", async () => {
        const onSearch = jest.fn();
        suggestJobs.mockResolvedValue({
            errCode: 0,
            data: [
                { id: 1, name: "React Developer", companyName: "Acme" },
                { id: 2, name: "React Developer", companyName: "Duplicate" },
                { id: 3, name: "React Native Engineer", companyName: "Mobile Co" },
            ],
        });
        render(<JobSearchAutocomplete onSearch={onSearch} />);

        typeKeyword("react");
        await finishDebounce();

        expect(await screen.findByText("Acme")).toBeInTheDocument();
        expect(screen.getByText("Duplicate")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("option", { name: /React Native Engineer Mobile Co/i }));

        expect(onSearch).toHaveBeenCalledWith("React Native Engineer");
        expect(screen.getByRole("combobox")).toHaveValue("React Native Engineer");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("supports keyboard selection, ordinary submit, escape, clear and outside click", async () => {
        const onSearch = jest.fn();
        suggestJobs.mockResolvedValue({
            errCode: 0,
            data: [{ id: 1, name: "Node Developer", companyName: "Acme" }],
        });
        render(
            <div>
                <JobSearchAutocomplete onSearch={onSearch} />
                <button type="button">Bên ngoài</button>
            </div>
        );

        typeKeyword("node");
        await finishDebounce();
        const input = screen.getByRole("combobox");
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onSearch).toHaveBeenLastCalledWith("Node Developer");

        typeKeyword("  backend   engineer  ");
        fireEvent.submit(input.closest("form"));
        expect(onSearch).toHaveBeenLastCalledWith("backend engineer");

        typeKeyword("java");
        fireEvent.keyDown(input, { key: "Escape" });
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

        fireEvent.focus(input);
        expect(screen.getByRole("listbox")).toBeInTheDocument();
        const outsideButton = screen.getByRole("button", { name: "Bên ngoài" });
        fireEvent.blur(input, { relatedTarget: outsideButton });
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

        fireEvent.focus(input);
        fireEvent.mouseDown(outsideButton);
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Xóa từ khóa" }));
        expect(input).toHaveValue("");
        expect(onSearch).toHaveBeenLastCalledWith("");
    });

    it("ignores stale responses and keeps typed search usable when suggestions fail", async () => {
        let resolveFirst;
        suggestJobs
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ errCode: -1, errMessage: "offline" });
        const onSearch = jest.fn();
        render(<JobSearchAutocomplete onSearch={onSearch} />);

        typeKeyword("react");
        await finishDebounce();
        typeKeyword("redux");
        await finishDebounce();

        await act(async () => {
            resolveFirst({
                errCode: 0,
                data: [{ id: 1, name: "React Developer", companyName: "Old result" }],
            });
            await Promise.resolve();
        });

        expect(screen.queryByText("Old result")).not.toBeInTheDocument();
        fireEvent.submit(screen.getByRole("combobox").closest("form"));
        expect(onSearch).toHaveBeenCalledWith("redux");
    });

    it("handles a rejected suggestion request without rendering a broken option", async () => {
        suggestJobs.mockRejectedValue(new Error("network"));
        render(<JobSearchAutocomplete onSearch={jest.fn()} />);

        typeKeyword("python");
        await finishDebounce();

        await waitFor(() => expect(screen.queryByText("Đang tìm gợi ý phù hợp...")).not.toBeInTheDocument());
        expect(screen.getAllByRole("option")).toHaveLength(1);
    });

    it("restores the initial result list when the keyword is deleted manually", () => {
        const onSearch = jest.fn();
        render(<JobSearchAutocomplete onSearch={onSearch} />);

        typeKeyword("react");
        fireEvent.submit(screen.getByRole("combobox").closest("form"));
        expect(onSearch).toHaveBeenLastCalledWith("react");

        typeKeyword("");
        expect(onSearch).toHaveBeenLastCalledWith("");
        expect(screen.getByRole("combobox")).toHaveValue("");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("does not intercept IME composition and keeps keyboard options visible", async () => {
        suggestJobs.mockResolvedValue({
            errCode: 0,
            data: Array.from({ length: 8 }, (_, index) => ({
                id: index + 1,
                name: `Tuyển dụng vị trí ${index + 1}`,
                companyName: `Công ty ${index + 1}`,
            })),
        });
        render(<JobSearchAutocomplete onSearch={jest.fn()} />);

        typeKeyword("Tuyển");
        await finishDebounce();
        const input = screen.getByRole("combobox");

        fireEvent.compositionStart(input);
        fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 229 });
        expect(input).not.toHaveAttribute("aria-activedescendant");

        fireEvent.compositionEnd(input);
        fireEvent.keyDown(input, { key: "ArrowUp" });
        const lastOption = screen.getByRole("option", { name: /Tuyển dụng vị trí 8 Công ty 8/i });
        expect(input).toHaveAttribute("aria-activedescendant", lastOption.id);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
    });
});
