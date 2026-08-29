import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useFetchAllcode } from "../../util/fetch";
import LeftBar from "./LeftPage/LeftBar";
import RightContent from "./RightPage/RightContent";

jest.mock("../../util/fetch", () => ({ useFetchAllcode: jest.fn() }));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children }) => React.createElement("a", { href: to }, children),
    };
});
jest.mock("antd", () => ({
    Input: {
        Search: ({ onSearch, placeholder }) => (
            <button type="button" onClick={() => onSearch("backend")}>
                {placeholder}
            </button>
        ),
    },
}));
jest.mock("../../components/Job/Job", () => ({ data }) => <span>{data.title}</span>);

const allCodes = {
    JOBTYPE: [{ code: "IT", value: "Công nghệ" }],
    JOBLEVEL: [{ code: "LEAD", value: "Trưởng nhóm" }],
    SALARYTYPE: [{ code: "HIGH", value: "Trên 20 triệu" }],
    EXPTYPE: [{ code: "THREE", value: "3 năm" }],
    WORKTYPE: [{ code: "REMOTE", value: "Từ xa" }],
    PROVINCE: [{ code: "HN", value: "Hà Nội" }],
};

describe("job filters and results", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useFetchAllcode.mockImplementation((type) => ({ data: allCodes[type] }));
    });

    it("renders every all-code group and forwards selected filters", () => {
        const props = {
            worktype: jest.fn(),
            recieveSalary: jest.fn(),
            recieveExp: jest.fn(),
            recieveJobType: jest.fn(),
            recieveJobLevel: jest.fn(),
            recieveLocation: jest.fn(),
        };
        render(<LeftBar {...props} />);

        expect(useFetchAllcode.mock.calls.map(([type]) => type)).toEqual([
            "JOBTYPE", "JOBLEVEL", "SALARYTYPE", "EXPTYPE", "WORKTYPE", "PROVINCE",
        ]);
        const selects = screen.getAllByRole("combobox");
        fireEvent.change(selects[0], { target: { value: "IT" } });
        fireEvent.change(selects[1], { target: { value: "HN" } });
        fireEvent.click(screen.getByLabelText("Từ xa"));
        fireEvent.click(screen.getByLabelText("3 năm"));
        fireEvent.click(screen.getByLabelText("Trưởng nhóm"));
        fireEvent.click(screen.getByLabelText("Trên 20 triệu"));

        expect(props.recieveJobType).toHaveBeenCalledWith("IT");
        expect(props.recieveLocation).toHaveBeenCalledWith("HN");
        expect(props.worktype).toHaveBeenCalledWith("REMOTE");
        expect(props.recieveExp).toHaveBeenCalledWith("THREE");
        expect(props.recieveJobLevel).toHaveBeenCalledWith("LEAD");
        expect(props.recieveSalary).toHaveBeenCalledWith("HIGH");
    });

    it("renders result links and forwards the search term", () => {
        const handleSearch = jest.fn();
        render(
            <RightContent
                count={2}
                post={[{ id: 4, title: "React" }, { id: 5, title: "Node" }]}
                handleSearch={handleSearch}
            />
        );

        expect(screen.getByText("2 công việc được tìm thấy")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "React" })).toHaveAttribute("href", "/detail-job/4");
        expect(screen.getByRole("link", { name: "Node" })).toHaveAttribute("href", "/detail-job/5");
        fireEvent.click(screen.getByRole("button", { name: "Nhập tên bài đăng" }));
        expect(handleSearch).toHaveBeenCalledWith("backend");
    });

    it("renders an empty result list without crashing", () => {
        render(
            <RightContent count={0} post={[]} handleSearch={jest.fn()} />
        );
        expect(screen.getByText("0 công việc được tìm thấy")).toBeInTheDocument();
        expect(screen.queryByText("React")).not.toBeInTheDocument();
    });
});
