import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { getListJobTypeAndCountPost, getRecommendedPostService } from "../../service/userService";
import Category from "./Category";
import Categories from "./Categories";
import FeatureJob from "./FeatureJob";
import FeaturesJobs from "./FeaturesJobs";
import RecommendedJobs from "./RecommendedJobs";
import Job from "../Job/Job";

jest.mock("../../service/userService", () => ({
    getListJobTypeAndCountPost: jest.fn(),
    getRecommendedPostService: jest.fn(),
}));
jest.mock("react-toastify", () => ({ toast: { error: jest.fn() } }));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
    };
});

const job = (id, name = `Job ${id}`) => ({
    id,
    timePost: Date.now(),
    userPostData: { userCompanyData: { thumbnail: `/company-${id}.png` } },
    postDetailData: {
        name,
        jobLevelPostData: { value: "Senior" },
        provincePostData: { value: "Hà Nội" },
        salaryTypePostData: { value: "20 triệu" },
        workTypePostData: { value: "Toàn thời gian" },
    },
});

describe("home job components", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });

    it("renders a category", () => {
        render(<Category data={{
            amount: 12,
            postDetailData: { jobTypePostData: { code: "IT & Data", image: "/it.png", value: "Công nghệ" } },
        }} />);
        expect(screen.getByRole("img", { name: "Công nghệ" })).toHaveAttribute("src", "/it.png");
        expect(screen.getByRole("link", { name: "Công nghệ" })).toHaveAttribute(
            "href",
            "/job?categoryJobCode=IT%20%26%20Data"
        );
        expect(screen.getByText("12")).toBeInTheDocument();
    });

    it("loads and renders categories", async () => {
        getListJobTypeAndCountPost.mockResolvedValue({
            errCode: 0,
            data: [{ amount: 3, postDetailData: { jobTypePostData: { image: "/it.png", value: "IT" } } }],
        });
        render(<Categories />);
        expect(await screen.findByText("IT")).toBeInTheDocument();
        expect(getListJobTypeAndCountPost).toHaveBeenCalledWith({ limit: 4, offset: 0 });
    });

    it("reports a category loading failure", async () => {
        getListJobTypeAndCountPost.mockResolvedValue({ errCode: 1, message: "No categories" });
        render(<Categories />);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No categories"));
    });

    it("renders one or many job cards with detail links", () => {
        const rows = [job(1, "React Developer"), job(2, "Node Developer")];
        const { rerender } = render(<FeatureJob data={rows[0]} />);
        expect(screen.getByText("React Developer")).toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: /React Developer|Toàn thời gian/ })[0]).toHaveAttribute("href", "/detail-job/1");
        expect(screen.getByText("Hà Nội")).toBeInTheDocument();

        rerender(<FeaturesJobs dataFeature={rows} />);
        expect(screen.getByText("Node Developer")).toBeInTheDocument();
    });

    it("renders the legacy Job card fields", () => {
        render(<Job data={job(3, "QA Engineer")} />);
        expect(screen.getByText("QA Engineer")).toBeInTheDocument();
        expect(screen.getByText("Senior")).toBeInTheDocument();
        expect(screen.getByText("20 triệu")).toBeInTheDocument();
        expect(screen.getByText("Toàn thời gian").tagName).toBe("SPAN");
    });

    it("does not request recommendations for anonymous or non-candidate users", () => {
        const { rerender } = render(<RecommendedJobs />);
        expect(getRecommendedPostService).not.toHaveBeenCalled();
        localStorage.setItem("userData", JSON.stringify({ id: 2, roleCode: "EMPLOYER" }));
        rerender(<RecommendedJobs key="employer" />);
        expect(getRecommendedPostService).not.toHaveBeenCalled();
    });

    it("shows successful candidate recommendations and hides an empty response", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 2, roleCode: "CANDIDATE" }));
        getRecommendedPostService.mockResolvedValueOnce({ errCode: 0, data: [job(7, "Matched Job")] });
        const { unmount } = render(<RecommendedJobs />);
        expect(await screen.findByText("Việc làm phù hợp với bạn")).toBeInTheDocument();
        expect(screen.getByText("Matched Job")).toBeInTheDocument();
        expect(getRecommendedPostService).toHaveBeenCalledWith({ userId: 2, limit: 5 });
        unmount();

        getRecommendedPostService.mockResolvedValueOnce({ errCode: 1 });
        const view = render(<RecommendedJobs />);
        await waitFor(() => expect(getRecommendedPostService).toHaveBeenCalledTimes(2));
        expect(view.container).toBeEmptyDOMElement();
    });
});
