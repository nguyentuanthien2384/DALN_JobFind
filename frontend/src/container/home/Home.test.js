import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { getListPostService } from "../../service/userService";
import Home from "./home";

jest.mock("../../service/userService", () => ({
    getListPostService: jest.fn(),
}));
jest.mock("../../components/home/Categories", () => () => (
    <div data-testid="home-categories">categories</div>
));
jest.mock("../../components/home/RecommendedJobs", () => () => (
    <div data-testid="recommended-jobs">recommended</div>
));
jest.mock("../../components/home/FeaturesJobs", () => ({ dataFeature = [] }) => (
    <div data-testid="feature-jobs">{dataFeature.map((item) => item.name).join(",")}</div>
));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
    };
});

const baseQuery = {
    limit: 5,
    offset: 0,
    categoryJobCode: "",
    addressCode: "",
    salaryJobCode: "",
    categoryJoblevelCode: "",
    categoryWorktypeCode: "",
    experienceJobCode: "",
    sortName: false,
};

describe("public Home page", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("loads regular and hot jobs with the expected filters", async () => {
        getListPostService
            .mockResolvedValueOnce({ errCode: 0, data: [{ name: "Newest job" }] })
            .mockResolvedValueOnce({ errCode: 0, data: [{ name: "Hot job" }] });

        render(<Home />);

        expect(screen.getByRole("heading", {
            name: "Hãy tìm công việc phù hợp với bạn nào",
        })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tìm việc ngay" })).toHaveAttribute(
            "href",
            "/job"
        );
        expect(screen.getByTestId("home-categories")).toBeInTheDocument();
        expect(screen.getByTestId("recommended-jobs")).toBeInTheDocument();

        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(2));
        expect(getListPostService).toHaveBeenNthCalledWith(1, baseQuery);
        expect(getListPostService).toHaveBeenNthCalledWith(2, {
            ...baseQuery,
            isHot: 1,
        });
        const sections = screen.getAllByTestId("feature-jobs");
        expect(sections[0]).toHaveTextContent("Hot job");
        expect(sections[1]).toHaveTextContent("Newest job");
    });

    it("keeps each job section empty when its corresponding request fails", async () => {
        getListPostService
            .mockResolvedValueOnce({ errCode: 1, data: [{ name: "Ignored regular" }] })
            .mockResolvedValueOnce({ errCode: 1, data: [{ name: "Ignored hot" }] });

        render(<Home />);

        await waitFor(() => expect(getListPostService).toHaveBeenCalledTimes(2));
        screen.getAllByTestId("feature-jobs").forEach((section) => {
            expect(section).toBeEmptyDOMElement();
        });
    });
});
