import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    sendInterviewInvitation,
} from "../../../service/applicationService";
import { getAllPostByAdminService, getDetailCompanyById } from "../../../service/userService";
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
    sendInterviewInvitation: jest.fn(),
}));
jest.mock("../../../service/userService", () => ({
    getAllPostByAdminService: jest.fn(),
    getDetailCompanyById: jest.fn(),
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));

const candidate = {
    id: 1,
    candidate_id: 10,
    candidate_name: "Lan Nguyen",
    candidate_email: "lan@candidate.vn",
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

// Ma buoc that cua application-service: keo vao "phong_van" mo thu moi phong van.
const pipelineBoard = () => ({
    errCode: 0,
    data: {
        total: 1,
        columns: [
            { stage: "dang_xem_xet", label: "Đang xem xét", count: 1, items: [{ ...candidate, stage: "dang_xem_xet" }] },
            { stage: "phong_van", label: "Phỏng vấn", count: 0, items: [] },
            { stage: "tu_choi", label: "Từ chối", count: 0, items: [] },
        ],
    },
});

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
        sendInterviewInvitation.mockResolvedValue({ errCode: 0, data: { stage: "phong_van" } });
        getDetailCompanyById.mockResolvedValue({ errCode: 0, data: { name: "Example Company", address: "12 Nguyễn Huệ, TP. Hồ Chí Minh" } });
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

    it("keeps the selected job's board when the initial all-jobs response arrives late", async () => {
        let releaseInitial;
        const allJobs = { errCode: 0, data: { total: 2, columns: [{ stage: "applied", label: "Mới ứng tuyển", count: 2,
            items: [{ ...candidate }, { ...candidate, id: 2, candidate_name: "Other Job Person" }] }] } };
        getApplicationBoard.mockImplementation((jobId) => (jobId
            ? Promise.resolve(boardResponse())
            : new Promise((resolve) => { releaseInitial = () => resolve(allJobs); })));
        render(<KanbanBoard />);
        await waitFor(() => expect(getApplicationBoard).toHaveBeenCalledWith(""));
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "12" } });
        expect(await screen.findByText("Lan Nguyen")).toBeInTheDocument();
        await act(async () => { releaseInitial(); });
        expect(screen.queryByText("Other Job Person")).not.toBeInTheDocument();
        expect(screen.getByText(/Tổng cộng/)).toHaveTextContent("Tổng cộng 1 hồ sơ.");
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

        fireEvent.click(within(modal).getByRole("button", { name: "Gửi không trúng tuyển" }));
        expect(sendApplicationDecision).not.toHaveBeenCalled();
        fireEvent.click(within(modal).getByRole("button", { name: "Gửi không trúng tuyển" }));
        await waitFor(() => expect(sendApplicationDecision).toHaveBeenCalledWith(1, "rejected", "Cảm ơn bạn"));
        expect(confirm).toHaveBeenLastCalledWith("Gửi email thông báo không trúng tuyển đến lan@candidate.vn?");
        expect(toast.success).toHaveBeenCalledWith("Đã xếp hàng gửi email thông báo không trúng tuyển");
        await waitFor(() => expect(getApplicationBoard).toHaveBeenCalledTimes(2));
        confirm.mockRestore();
    });

    it("explains and safely labels a demo recipient before queuing email", async () => {
        getApplicationDetail.mockResolvedValue({
            ...detailResponse,
            data: { ...detailResponse.data, candidate_email: "example@gmail.com" },
        });
        await renderLoadedBoard();
        fireEvent.click(screen.getByText("Lan Nguyen"));
        const modal = await screen.findByRole("dialog", { name: "Chi tiết hồ sơ Lan Nguyen" });
        expect(within(modal).getByText(/dữ liệu mẫu/)).toHaveTextContent(
            "development sẽ chuyển nếu có hộp thư demo; production sẽ chặn"
        );

        const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
        fireEvent.click(within(modal).getByRole("button", { name: "Gửi không trúng tuyển" }));
        await waitFor(() => expect(confirm).toHaveBeenCalledWith(
            "Gửi email thông báo không trúng tuyển đến hộp thư demo (nếu đã cấu hình)?"
        ));
        confirm.mockRestore();
    });

    it('previews and sends the complete offer once, preserving it after a failed send', async () => {
        const offer = { companyName: 'Example Company', startDate: '2099-10-20', startTime: '08:30', timeZone: 'Asia/Ho_Chi_Minh',
            workMode: 'onsite', location: '12 Nguyễn Huệ', responseDeadline: '2099-10-18T17:00', contactName: 'Hà', contactEmail: 'hr@example.com' };
        getApplicationDetail.mockResolvedValue({ ...detailResponse, data: { ...detailResponse.data, latestDecision: { decision: 'accepted', offer } } });
        sendApplicationDecision.mockRejectedValueOnce(new Error('Network'));
        const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
        await renderLoadedBoard();
        fireEvent.click(screen.getByText('Lan Nguyen'));
        const modal = await screen.findByRole('dialog', { name: 'Chi tiết hồ sơ Lan Nguyen' });
        fireEvent.click(within(modal).getByRole('button', { name: 'Gửi trúng tuyển' }));
        fireEvent.click(within(modal).getByRole('button', { name: 'Xem trước thư mời' }));
        expect(sendApplicationDecision).not.toHaveBeenCalled();
        const send = within(modal).getByRole('button', { name: 'Xác nhận gửi thư mời' });
        fireEvent.click(send);
        fireEvent.click(send);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('kiểm tra lịch sử')));
        expect(sendApplicationDecision).toHaveBeenCalledTimes(1);
        expect(sendApplicationDecision).toHaveBeenCalledWith(1, 'accepted', '', expect.objectContaining(offer));
        expect(send).not.toBeDisabled();
        expect(within(modal).getByText('12 Nguyễn Huệ')).toBeInTheDocument();
        confirm.mockRestore();
    });

    it("opens the interview invitation instead of moving a card dropped into Phỏng vấn, then sends it", async () => {
        getApplicationBoard.mockImplementation(async () => pipelineBoard());
        getApplicationDetail.mockResolvedValue({ ...detailResponse, data: { ...detailResponse.data, stage: "dang_xem_xet" } });
        const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
        await renderLoadedBoard();
        expect(getDetailCompanyById).toHaveBeenCalledWith(9);
        fireEvent.dragStart(screen.getByRole("button", { name: "Hồ sơ Lan Nguyen" }));
        fireEvent.drop(screen.getByRole("region", { name: "Phỏng vấn" }));

        const form = await screen.findByRole("region", { name: "Soạn thư mời phỏng vấn" });
        expect(moveApplicationStage).not.toHaveBeenCalled();
        expect(within(screen.getByRole("region", { name: "Đang xem xét" })).getByText("Lan Nguyen")).toBeInTheDocument();
        expect(within(form).getByLabelText("Tên công ty *")).toHaveValue("Example Company");
        expect(within(form).getByLabelText("Địa điểm phỏng vấn cụ thể *")).toHaveValue("12 Nguyễn Huệ, TP. Hồ Chí Minh");
        for (const [label, value] of [["Ngày phỏng vấn *", "2099-10-15"], ["Giờ bắt đầu *", "09:30"],
            ["Người liên hệ HR *", "Hà"], ["Email HR nhận phản hồi *", "hr@example.com"]]) {
            fireEvent.change(within(form).getByLabelText(label), { target: { value } });
        }
        fireEvent.click(within(form).getByRole("button", { name: "Xem trước thư mời phỏng vấn" }));
        expect(sendInterviewInvitation).not.toHaveBeenCalled();
        fireEvent.click(within(form).getByRole("button", { name: "Xác nhận gửi thư mời phỏng vấn" }));

        await waitFor(() => expect(sendInterviewInvitation).toHaveBeenCalledWith(1, "", {
            companyName: "Example Company", interviewDate: "2099-10-15", interviewTime: "09:30", durationMinutes: "60",
            timeZone: "Asia/Ho_Chi_Minh", interviewMode: "onsite", location: "12 Nguyễn Huệ, TP. Hồ Chí Minh",
            contactName: "Hà", contactEmail: "hr@example.com",
        }));
        expect(confirm).toHaveBeenCalledWith("Gửi email thư mời phỏng vấn đến lan@candidate.vn?");
        expect(toast.success).toHaveBeenCalledWith("Đã xếp hàng gửi email thư mời phỏng vấn");
        await waitFor(() => expect(getApplicationBoard).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole("region", { name: "Soạn thư mời phỏng vấn" })).not.toBeInTheDocument();
        confirm.mockRestore();
    });

    it("shows stage names and the saved interview invitation in the recruitment history", async () => {
        getApplicationBoard.mockImplementation(async () => pipelineBoard());
        getApplicationDetail.mockResolvedValue({ ...detailResponse, data: { ...detailResponse.data, stage: "phong_van", timeline: [{
            id: 2, from_stage: "dang_xem_xet", to_stage: "phong_van", reason: "Đã yêu cầu gửi thư mời phỏng vấn", created_at: "2026-08-22T10:00:00Z",
            decision_snapshot: { decision: "interview", message: null, interview: { companyName: "Example Company", interviewDate: "2099-10-15",
                interviewTime: "09:30", timeZone: "Asia/Ho_Chi_Minh", interviewMode: "online", meetingUrl: "https://meet.example.com/abc",
                contactName: "Hà", contactEmail: "hr@example.com" } },
        }] } });
        await renderLoadedBoard();
        fireEvent.click(screen.getByText("Lan Nguyen"));
        const modal = await screen.findByRole("dialog", { name: "Chi tiết hồ sơ Lan Nguyen" });
        expect(within(modal).getByText(/Đang xem xét →/)).toBeInTheDocument();
        expect(within(modal).queryByText(/dang_xem_xet|phong_van/)).not.toBeInTheDocument();
        expect(within(modal).getByText("https://meet.example.com/abc")).toBeInTheDocument();
        expect(within(modal).getByText("Thứ Năm, 15/10/2099 lúc 09:30 (giờ Việt Nam, UTC+7)")).toBeInTheDocument();
        expect(within(modal).getByRole("button", { name: "Gửi lại / đổi lịch phỏng vấn" })).toBeEnabled();
    });

    it("thanks an interviewed candidate in the rejection unless the employer says they did not attend", async () => {
        getApplicationDetail.mockResolvedValue({ ...detailResponse, data: { ...detailResponse.data, stage: "phong_van" } });
        const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
        await renderLoadedBoard();
        fireEvent.click(screen.getByText("Lan Nguyen"));
        const modal = await screen.findByRole("dialog", { name: "Chi tiết hồ sơ Lan Nguyen" });
        const attended = within(modal).getByRole("checkbox", { name: /đã tham gia phỏng vấn/ });
        expect(attended).toBeChecked();

        fireEvent.click(within(modal).getByRole("button", { name: "Gửi không trúng tuyển" }));
        await waitFor(() => expect(sendApplicationDecision).toHaveBeenCalledWith(1, "rejected", "", undefined, true));
        expect(confirm).toHaveBeenLastCalledWith("Gửi email cảm ơn đã tham gia phỏng vấn (không trúng tuyển) đến lan@candidate.vn?");
        await waitFor(() => expect(getApplicationBoard).toHaveBeenCalledTimes(2));

        fireEvent.click(within(modal).getByRole("checkbox", { name: /đã tham gia phỏng vấn/ }));
        fireEvent.click(within(modal).getByRole("button", { name: "Gửi không trúng tuyển" }));
        await waitFor(() => expect(sendApplicationDecision).toHaveBeenLastCalledWith(1, "rejected", "", undefined, false));
        expect(confirm).toHaveBeenLastCalledWith("Gửi email thông báo không trúng tuyển đến lan@candidate.vn?");
        confirm.mockRestore();
    });

    it("keeps hired candidates out of interview invitations", async () => {
        getApplicationBoard.mockImplementation(async () => ({ errCode: 0, data: { total: 1, columns: [
            { stage: "nhan_viec", label: "Đã nhận việc", count: 1, items: [{ ...candidate, stage: "nhan_viec" }] },
            { stage: "phong_van", label: "Phỏng vấn", count: 0, items: [] },
        ] } }));
        getApplicationDetail.mockResolvedValue({ ...detailResponse, data: { ...detailResponse.data, stage: "nhan_viec" } });
        await renderLoadedBoard();
        fireEvent.dragStart(screen.getByRole("button", { name: "Hồ sơ Lan Nguyen" }));
        fireEvent.drop(screen.getByRole("region", { name: "Phỏng vấn" }));
        expect(toast.error).toHaveBeenCalledWith("Ứng viên đã nhận việc nên không gửi thư mời phỏng vấn");
        expect(getApplicationDetail).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Lan Nguyen"));
        const modal = await screen.findByRole("dialog", { name: "Chi tiết hồ sơ Lan Nguyen" });
        expect(within(modal).getByRole("button", { name: "Mời phỏng vấn" })).toBeDisabled();
        expect(moveApplicationStage).not.toHaveBeenCalled();
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
