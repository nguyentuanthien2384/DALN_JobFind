import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loadJobSuggestions } from "../../../service/jobSuggestions";
import JobSearchAutocomplete from "./JobSearchAutocomplete";

jest.mock("../../../service/jobSuggestions", () => ({
    loadJobSuggestions: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({useNavigate: () => mockNavigate}));

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
    it('updates the restored URL keyword in place without remounting or reporting another input change', () => {
        const onValueChange = jest.fn(), onSearch = jest.fn();
        const view = render(<JobSearchAutocomplete value="React" onValueChange={onValueChange} onSearch={onSearch} />);
        const input = screen.getByRole('combobox', { name: 'Tìm kiếm việc làm' });
        typeKeyword('Vue');
        expect(onValueChange).toHaveBeenLastCalledWith('Vue');
        view.rerender(<JobSearchAutocomplete value="Node" onValueChange={onValueChange} onSearch={onSearch} />);
        expect(screen.getByRole('combobox', { name: 'Tìm kiếm việc làm' })).toBe(input);
        expect(input).toHaveValue('Node');
        expect(onValueChange).toHaveBeenCalledTimes(1);
    });
    let scrollIntoViewMock;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        loadJobSuggestions.mockResolvedValue({ errCode: 0, data: [] });
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
        expect(screen.getByRole("option", { name: /Xem tất cả kết quả cho.*r/i })).toBeInTheDocument();
        await finishDebounce();
        expect(loadJobSuggestions).not.toHaveBeenCalled();

        typeKeyword("re");
        await finishDebounce();
        expect(loadJobSuggestions).toHaveBeenCalledWith("re");
    });

    it("renders actual jobs and navigates directly to the selected job", async () => {
        const onSearch = jest.fn();
        loadJobSuggestions.mockResolvedValue({
            errCode: 0,
            data: [
                { id: 1, name: "React Developer", companyName: "Acme", detailPath: "/detail-job/1" },
                { id: 2, name: "React Developer", companyName: "Duplicate", detailPath: "/detail-job/2" },
                { id: 3, name: "React Native Engineer", companyName: "Mobile Co", detailPath: "/detail-job/3" },
            ],
        });
        render(<JobSearchAutocomplete onSearch={onSearch} />);

        typeKeyword("react");
        await finishDebounce();

        expect(await screen.findByText("Acme")).toBeInTheDocument();
        expect(screen.getByText("Duplicate")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("option", { name: /React Native Engineer Mobile Co/i }));

        expect(mockNavigate).toHaveBeenCalledWith("/detail-job/3");
        expect(onSearch).not.toHaveBeenCalled();
        expect(screen.getByRole("combobox")).toHaveValue("react");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it('shows a sourced PL/SQL vacancy and opens its external detail without submitting another search', async () => {
        const onSearch = jest.fn();
        loadJobSuggestions.mockResolvedValue({data:[{id:'external-plsql',name:'Lập trình PL/SQL',companyName:'VNPT',addressText:'Hà Nội, Hải Phòng',listingSource:'external',detailPath:'/external-job/external-plsql'}]});
        render(<JobSearchAutocomplete onSearch={onSearch} />);
        typeKeyword('PL');
        await finishDebounce();
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('Lập trình PL/SQL');
        expect(options[0]).toHaveTextContent('Hà Nội, Hải Phòng');
        expect(options[0]).toHaveTextContent('Tin từ nguồn bên ngoài');
        fireEvent.click(options[0]);
        expect(mockNavigate).toHaveBeenCalledWith('/external-job/external-plsql');
        expect(onSearch).not.toHaveBeenCalled();
    });

    it('keeps the all-results action and distinguishes no matches from a failed source', async () => {
        const onSearch = jest.fn();
        render(<JobSearchAutocomplete onSearch={onSearch} />);
        typeKeyword('zzzz');
        await finishDebounce();
        expect(screen.getByRole('status')).toHaveTextContent('Chưa có công việc gợi ý');
        fireEvent.click(screen.getByRole('option',{name:/Xem tất cả kết quả cho/}));
        expect(onSearch).toHaveBeenCalledWith('zzzz');
        loadJobSuggestions.mockResolvedValueOnce({data:[],unavailable:true});
        typeKeyword('PL');
        await finishDebounce();
        expect(screen.getByRole('status')).toHaveTextContent('Chưa tải được một số gợi ý');
    });

    it("supports keyboard selection, ordinary submit, escape, clear and outside click", async () => {
        const onSearch = jest.fn();
        loadJobSuggestions.mockResolvedValue({
            errCode: 0,
            data: [{ id: 1, name: "Node Developer", companyName: "Acme", detailPath: "/detail-job/1" }],
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
        fireEvent.keyDown(input, { key: "Enter" });
        expect(mockNavigate).toHaveBeenLastCalledWith("/detail-job/1");

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
        loadJobSuggestions
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
                data: [{ id: 1, name: "React Developer", companyName: "Old result", detailPath: "/detail-job/1" }],
            });
            await Promise.resolve();
        });

        expect(screen.queryByText("Old result")).not.toBeInTheDocument();
        fireEvent.submit(screen.getByRole("combobox").closest("form"));
        expect(onSearch).toHaveBeenCalledWith("redux");
    });

    it("handles a rejected suggestion request without rendering a broken option", async () => {
        loadJobSuggestions.mockRejectedValue(new Error("network"));
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
        loadJobSuggestions.mockResolvedValue({
            errCode: 0,
            data: Array.from({ length: 8 }, (_, index) => ({
                id: index + 1,
                name: `Tuyển dụng vị trí ${index + 1}`,
                companyName: `Công ty ${index + 1}`,
                detailPath: `/detail-job/${index+1}`,
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
        fireEvent.keyDown(input, { key: "ArrowUp" });
        const lastOption = screen.getByRole("option", { name: /Tuyển dụng vị trí 8 Công ty 8/i });
        expect(input).toHaveAttribute("aria-activedescendant", lastOption.id);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
    });
});
