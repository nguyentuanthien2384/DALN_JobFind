import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "react-toastify";
import {
    addApplicationNote,
    getApplicationBoard,
    getApplicationDetail,
    getFunnel,
    moveApplicationStage,
    rateApplication,
    saveToTalentPool,
    sendApplicationDecision,
} from "../../../service/applicationService";
import { getAllPostByAdminService } from "../../../service/userService";
import KanbanBoard from "./KanbanBoard";

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
    useNavigate: () => mockNavigate,
}));
jest.mock("../../../service/applicationService", () => ({
    addApplicationNote: jest.fn(),
    getApplicationBoard: jest.fn(),
    getApplicationDetail: jest.fn(),
    getFunnel: jest.fn(),
    moveApplicationStage: jest.fn(),
    rateApplication: jest.fn(),
    saveToTalentPool: jest.fn(),
    sendApplicationDecision: jest.fn(),
}));
jest.mock("../../../service/userService", () => ({
    getAllPostByAdminService: jest.fn(),
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));

const candidate = {
    id: 1,
    candidate_id: 10,
    candidate_name: "Lan Nguyen",
    candidate_email: "lan@example.com",
    job_title: "Frontend Developer",
    stage: "applied",
    is_read: false,
    rating: 2,
    match_score: 84,
};

const boardResponse = () => ({
    errCode: 0,
    data: {
        total: 1,
        columns: [
            { stage: "applied", label: "Mới ứng tuyển", count: 1, items: [{ ...candidate }] },
            { stage: "interview", label: "Phỏng vấn", count: 0, items: [] },
        ],
    },
});

const funnelResponse = {
    errCode: 0,
    data: {
        funnel: [
            { stage: "applied", label: "Mới", count: 1 },
            { stage: "interview", label: "Phỏng vấn", count: 0 },
        ],
        conversionRate: 25,
    },
};

const detailResponse = {
    errCode: 0,
    data: {
        ...candidate,
        applied_at: "2026-08-20T10:00:00Z",
        candidate_phone: "0912345678",
        cover_letter: "Tôi phù hợp với vị trí này.",
        legacy_cv_id: 77,
        notes: [],
        timeline: [],
    },
};

const renderLoadedBoard = async () => {
    const view = render(<KanbanBoard />);
    expect(await screen.findByText("Lan Nguyen")).toBeInTheDocument();
    return view;
};

describe("KanbanBoard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.setItem("userData", JSON.stringify({ id: 3, companyId: 9, roleCode: "EMPLOYER" }));
        getAllPostByAdminService.mockResolvedValue({
            errCode: 0,
            data: [{ id: 12, postDetailData: { name: "Frontend Developer" } }],
        });
        getApplicationBoard.mockImplementation(async () => boardResponse());
        getFunnel.mockResolvedValue(funnelResponse);
        moveApplicationStage.mockResolvedValue({ errCode: 0 });
        getApplicationDetail.mockResolvedValue(detailResponse);
        rateApplication.mockResolvedValue({ errCode: 0 });
        addApplicationNote.mockResolvedValue({
            errCode: 0,
            data: { id: 5, body: "Phỏng vấn tốt", created_at: "2026-08-29T10:00:00Z" },
        });
        saveToTalentPool.mockResolvedValue({ errCode: 0 });
        sendApplicationDecision.mockResolvedValue({ errCode: 0, data: { decision: "rejected" } });
    });

    it("loads jobs, the board and funnel, then filters by job", async () => {
        await renderLoadedBoard();
        expect(getAllPostByAdminService).toHaveBeenCalledWith({
            limit: 100,
            offset: 0,
            companyId: 9,
            search: "",
            censorCode: "",
        });
        expect(getApplicationBoard).toHaveBeenCalledWith("");
        expect(screen.getByText(/Tổng cộng/)).toHaveTextContent("Tổng cộng 1 hồ sơ.");
        expect(screen.getByText("25%")).toBeInTheDocument();

        fireEvent.change(screen.getByRole("combobox"), { target: { value: "12" } });
        await waitFor(() => expect(getApplicationBoard).toHaveBeenLastCalledWith("12"));
        expect(getFunnel).toHaveBeenLastCalledWith("12");
    });

    it("moves a card optimistically and refreshes the funnel", async () => {
        await renderLoadedBoard();
        const card = screen.getByRole("button", { name: "Hồ sơ Lan Nguyen" });
        const target = screen.getByRole("region", { name: "Phỏng vấn" });
        fireEvent.dragStart(card);
        fireEvent.dragOver(target);
        expect(target).toHaveClass("over");
        fireEvent.drop(target);

        await waitFor(() => expect(moveApplicationStage).toHaveBeenCalledWith(1, "interview"));
        expect(within(target).getByText("Lan Nguyen")).toBeInTheDocument();
        expect(toast.success).toHaveBeenCalledWith("Đã chuyển Lan Nguyen sang bước mới");
        expect(getFunnel).toHaveBeenCalledTimes(2);
    });

    it("restores the original column when a move fails", async () => {
        moveApplicationStage.mockResolvedValue({ errCode: 4, errMessage: "Transition denied" });
        await renderLoadedBoard();
        const source = screen.getByRole("region", { name: "Mới ứng tuyển" });
        const target = screen.getByRole("region", { name: "Phỏng vấn" });
        fireEvent.dragStart(screen.getByRole("button", { name: "Hồ sơ Lan Nguyen" }));
        fireEvent.drop(target);

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Transition denied"));
        expect(within(source).getByText("Lan Nguyen")).toBeInTheDocument();
        expect(getFunnel).toHaveBeenCalledTimes(1);
    });

    it("ignores a drop into the current stage", async () => {
        await renderLoadedBoard();
        const source = screen.getByRole("region", { name: "Mới ứng tuyển" });
        fireEvent.dragStart(screen.getByRole("button", { name: "Hồ sơ Lan Nguyen" }));
        fireEvent.drop(source);
        expect(moveApplicationStage).not.toHaveBeenCalled();
    });

    it("opens details, rates, adds notes, saves talent and opens the legacy CV", async () => {
        await renderLoadedBoard();
        fireEvent.click(screen.getByText("Lan Nguyen"));
        await screen.findByText("Tôi phù hợp với vị trí này.");
        const modal = screen.getByRole("dialog", { name: "Chi tiết hồ sơ Lan Nguyen" });
        expect(getApplicationDetail).toHaveBeenCalledWith(1);
        expect(within(modal).getByText("Tôi phù hợp với vị trí này.")).toBeInTheDocument();

        fireEvent.click(within(modal).getByTitle("5 sao"));
        await waitFor(() => expect(rateApplication).toHaveBeenCalledWith(1, 5));
        expect(toast.success).toHaveBeenCalledWith("Đã chấm 5 sao");

        const note = within(modal).getByPlaceholderText("Nhận xét về ứng viên…");
        fireEvent.change(note, { target: { value: "  Phỏng vấn tốt  " } });
        fireEvent.click(within(modal).getByRole("button", { name: "Thêm" }));
        await waitFor(() => expect(addApplicationNote).toHaveBeenCalledWith(1, "Phỏng vấn tốt"));
        expect(within(modal).getByText("Phỏng vấn tốt")).toBeInTheDocument();

        fireEvent.click(within(modal).getByRole("button", { name: "Lưu vào kho ứng viên" }));
        await waitFor(() => expect(saveToTalentPool).toHaveBeenCalledWith({
            candidateId: 10,
            candidateName: "Lan Nguyen",
            note: 'Từ hồ sơ ứng tuyển "Frontend Developer"',
        }));
        fireEvent.click(within(modal).getByRole("button", { name: "Xem file CV" }));
        expect(mockNavigate).toHaveBeenCalledWith("/admin/user-cv/77");
    });

    it("asks for confirmation and sends a trimmed decision message", async () => {
        await renderLoadedBoard();
        fireEvent.click(screen.getByText("Lan Nguyen"));
        await screen.findByText("Tôi phù hợp với vị trí này.");
        const modal = screen.getByRole("dialog", { name: "Chi tiết hồ sơ Lan Nguyen" });
        fireEvent.change(within(modal).getByPlaceholderText("Lời nhắn thêm cho ứng viên (không bắt buộc)"), {
            target: { value: "  Cảm ơn bạn  " },
        });
        const confirm = jest.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

        fireEvent.click(within(modal).getByRole("button", { name: "Gửi trúng tuyển" }));
        expect(sendApplicationDecision).not.toHaveBeenCalled();
        fireEvent.click(within(modal).getByRole("button", { name: "Gửi không trúng tuyển" }));
        await waitFor(() => expect(sendApplicationDecision).toHaveBeenCalledWith(1, "rejected", "Cảm ơn bạn"));
        expect(confirm).toHaveBeenLastCalledWith("Gửi email thông báo không trúng tuyển đến lan@example.com?");
        expect(toast.success).toHaveBeenCalledWith("Đã gửi email thông báo không trúng tuyển");
        await waitFor(() => expect(getApplicationBoard).toHaveBeenCalledTimes(2));
        confirm.mockRestore();
    });

    it("shows load and detail errors without crashing", async () => {
        getApplicationBoard.mockResolvedValue({ errCode: 1, errMessage: "Board unavailable" });
        getFunnel.mockResolvedValue({ errCode: 1 });
        const { rerender } = render(<KanbanBoard />);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Board unavailable"));
        expect(screen.getByText(/Tổng cộng/)).toHaveTextContent("Tổng cộng 0 hồ sơ.");

        getApplicationBoard.mockImplementation(async () => boardResponse());
        getApplicationDetail.mockResolvedValue({ errCode: 1 });
        rerender(<KanbanBoard key="fresh" />);
        await screen.findByText("Lan Nguyen");
        fireEvent.click(screen.getByText("Lan Nguyen"));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không mở được hồ sơ"));
    });
});
