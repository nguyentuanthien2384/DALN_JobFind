import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getListPostService } from "../../service/userService";
import JobPage from "./JobPage";

jest.mock("../../service/userService", () => ({
    getListPostService: jest.fn(),
}));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { removeSpace: (value) => value.trim().replace(/\s+/g, " ") },
}));
jest.mock("./LeftPage/LeftBar", () => (props) => (
    <div>
        <button onClick={() => props.worktype("REMOTE")}>work-type</button>
        <button onClick={() => props.recieveSalary("HIGH")}>salary</button>
        <button onClick={() => props.recieveExp("SENIOR")}>experience</button>
        <button onClick={() => props.recieveJobType("TECH")}>job-type</button>
        <button onClick={() => props.recieveJobLevel("LEAD")}>job-level</button>
        <button onClick={() => props.recieveLocation("HCM")}>location</button>
    </div>
));
jest.mock("./RightPage/RightContent", () => (props) => (
    <div>
        <span data-testid="job-count">{props.count}</span>
        {props.post.map((item) => <span key={item.id}>{item.name}</span>)}
        <button onClick={() => props.handleSearch("  React   Engineer  ")}>search</button>
    </div>
));
jest.mock("react-paginate", () => (props) => (
    <div>
        <span data-testid="page-count">{props.pageCount}</span>
        <span data-testid="force-page">{String(props.forcePage)}</span>
        <button onClick={() => props.onPageChange({ selected: 2 })}>page-three</button>
    </div>
));

const success = {
    errCode: 0,
    count: 12,
    data: [{ id: 1, name: "React Developer" }],
};

const expectLatestQuery = async (expected) => {
    await waitFor(() => expect(getListPostService).toHaveBeenLastCalledWith(
        expect.objectContaining(expected)
    ));
};

describe("JobPage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.history.replaceState({}, "", "/job");
        getListPostService.mockResolvedValue(success);
    });

    it("applies a category filter supplied by a home-page deep link", async () => {
        window.history.replaceState({}, "", "/job?categoryJobCode=IT%20%26%20Data");
        render(<JobPage />);

        await expectLatestQuery({
            categoryJobCode: "IT & Data",
            offset: 0,
        });
    });

    it("loads the first page and displays returned jobs and pagination", async () => {
        render(<JobPage />);

        await expectLatestQuery({
            limit: 5,
            offset: 0,
            categoryJobCode: "",
            addressCode: "",
            salaryJobCode: [],
            categoryJoblevelCode: [],
            categoryWorktypeCode: [],
            experienceJobCode: [],
            search: "",
        });
        expect(await screen.findByText("React Developer")).toBeInTheDocument();
        expect(screen.getByTestId("job-count")).toHaveTextContent("12");
        expect(screen.getByTestId("page-count")).toHaveTextContent("3");
        expect(screen.getByTestId("force-page")).toHaveTextContent("0");
    });

    it.each([
        ["work-type", "categoryWorktypeCode", "REMOTE"],
        ["salary", "salaryJobCode", "HIGH"],
        ["experience", "experienceJobCode", "SENIOR"],
        ["job-level", "categoryJoblevelCode", "LEAD"],
    ])("adds and removes the %s multi-select filter", async (button, field, value) => {
        render(<JobPage />);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: [value], offset: 0 });

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: [], offset: 0 });
    });

    it.each([
        ["job-type", "categoryJobCode", "TECH"],
        ["location", "addressCode", "HCM"],
    ])("toggles the %s single-select filter", async (button, field, value) => {
        render(<JobPage />);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: value });

        fireEvent.click(screen.getByRole("button", { name: button }));
        await expectLatestQuery({ [field]: "" });
    });

    it("normalizes a search and keeps active filters when changing page", async () => {
        render(<JobPage />);
        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: "work-type" }));
        await expectLatestQuery({ categoryWorktypeCode: ["REMOTE"] });
        fireEvent.click(screen.getByRole("button", { name: "search" }));
        await expectLatestQuery({ search: "React Engineer", offset: 0 });

        fireEvent.click(screen.getByRole("button", { name: "page-three" }));
        await expectLatestQuery({
            limit: 5,
            offset: 10,
            categoryWorktypeCode: ["REMOTE"],
            search: "React Engineer",
            sortName: undefined,
        });
        expect(screen.getByTestId("force-page")).toHaveTextContent("2");
    });

    it("keeps the current empty result when the API returns an error", async () => {
        getListPostService.mockResolvedValue({ errCode: 1, data: [{ id: 9, name: "ignored" }] });
        render(<JobPage />);

        await waitFor(() => expect(getListPostService).toHaveBeenCalled());
        expect(screen.queryByText("ignored")).not.toBeInTheDocument();
        expect(screen.getByTestId("job-count")).toHaveTextContent("0");
    });
});
