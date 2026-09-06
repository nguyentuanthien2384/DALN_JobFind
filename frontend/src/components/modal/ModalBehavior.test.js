import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { createNewCv } from "../../service/cvService";
import { getDetailUserById } from "../../service/userService";
import CommonUtils from "../../util/CommonUtils";
import NoteModal from "./NoteModal";
import ReupPostModal from "./ReupPostModal";
import SendCvModal from "./SendCvModal";

jest.mock("reactstrap", () => {
    const React = require("react");
    const Box = ({ children, isOpen = true }) => isOpen ? React.createElement("div", {}, children) : null;
    const Button = ({ children, onClick, disabled, className }) =>
        React.createElement("button", { type: "button", onClick, disabled, className }, children);
    return {
        Modal: Box,
        ModalHeader: Box,
        ModalFooter: Box,
        ModalBody: Box,
        Button,
        Spinner: () => React.createElement("span", { role: "status" }, "loading"),
    };
});
jest.mock("react-datepicker", () => {
    const React = require("react");
    return (props) => React.createElement("input", {
        "aria-label": "Ngày kết thúc",
        value: props.selected instanceof Date ? props.selected.toISOString().slice(0, 10) : "",
        onChange: (event) => props.onChange(new Date(`${event.target.value}T00:00:00`)),
    });
});
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("../../service/cvService", () => ({ createNewCv: jest.fn() }));
jest.mock("../../service/userService", () => ({ getDetailUserById: jest.fn() }));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { getBase64: jest.fn() },
}));

describe("NoteModal", () => {
    it('awaits moderation, blocks duplicate submission and retains the note on failure', async () => {
        let finish;
        const handleFunc = jest.fn(() => new Promise(resolve => { finish = resolve; }));
        const onHide = jest.fn();
        const { rerender } = render(<NoteModal isOpen awaitResult id={17} handleFunc={handleFunc} onHide={onHide} />);
        const input = screen.getByPlaceholderText('Giải thích lý do cho nhà tuyển dụng');
        fireEvent.change(input, { target: { value: 'Lý do cần giữ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
        expect(handleFunc).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
        await act(async () => finish(false));
        expect(input).toHaveValue('Lý do cần giữ'); expect(onHide).not.toHaveBeenCalled();
        rerender(<NoteModal isOpen awaitResult feedback='Tin đã thay đổi' id={17} handleFunc={handleFunc} onHide={onHide} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Sao chép ghi chú');
        expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Hủy' })); expect(onHide).toHaveBeenCalledTimes(1);
    });

    it('closes an awaited moderation note only after confirmed success', async () => {
        const onHide = jest.fn();
        render(<NoteModal isOpen awaitResult id={17} handleFunc={jest.fn().mockResolvedValue(true)} onHide={onHide} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
        await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
    });
    it("submits the post id and entered note, then closes", () => {
        const handleFunc = jest.fn();
        const onHide = jest.fn();
        render(<NoteModal isOpen id={17} handleFunc={handleFunc} onHide={onHide} />);
        fireEvent.change(screen.getByPlaceholderText("Giải thích lý do cho nhà tuyển dụng"), {
            target: { value: "Cần bổ sung thông tin" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
        expect(handleFunc).toHaveBeenCalledWith(17, "Cần bổ sung thông tin");
        expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("closes without submitting when cancelled", () => {
        const handleFunc = jest.fn();
        const onHide = jest.fn();
        render(<NoteModal isOpen id={17} handleFunc={handleFunc} onHide={onHide} />);
        fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(handleFunc).not.toHaveBeenCalled();
    });
});

describe("ReupPostModal", () => {
    it("submits the selected end-date timestamp and closes", () => {
        const handleFunc = jest.fn();
        const onHide = jest.fn();
        render(<ReupPostModal isOpen handleFunc={handleFunc} onHide={onHide} />);
        fireEvent.change(screen.getByLabelText("Ngày kết thúc"), { target: { value: "2030-01-02" } });
        fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
        expect(handleFunc).toHaveBeenCalledWith(new Date("2030-01-02T00:00:00").getTime());
        expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("supports cancelling", () => {
        const onHide = jest.fn();
        render(<ReupPostModal isOpen handleFunc={jest.fn()} onHide={onHide} />);
        fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
        expect(onHide).toHaveBeenCalledTimes(1);
    });
});

describe("SendCvModal", () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 8, roleCode: "CANDIDATE" }));
        jest.clearAllMocks();
        URL.createObjectURL = jest.fn(() => "blob:preview");
        getDetailUserById.mockResolvedValue({
            errCode: 0,
            data: { userAccountData: { userSettingData: { file: "" } } },
        });
        createNewCv.mockResolvedValue({ errCode: 0 });
        CommonUtils.getBase64.mockResolvedValue("data:application/pdf;base64,UERG");
    });

    it("loads the candidate profile and warns when no online CV exists", async () => {
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);
        await waitFor(() => expect(getDetailUserById).toHaveBeenCalledWith(8));
        fireEvent.click(screen.getByLabelText("CV online"));
        expect(toast.error).toHaveBeenCalledWith("Hiện chưa đăng CV online cho chúng tôi");
        expect(screen.getByLabelText("Tự chọn CV")).toBeChecked();
        expect(screen.getByLabelText("Tự chọn CV")).toBeChecked();
    });

    it("does not expose the application modal to a non-candidate account", () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 9,
            roleCode: "EMPLOYER",
            companyId: 3,
            companyStatusCode: "S1",
            companyCensorCode: "CS1",
        }));
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);

        expect(screen.queryByText("NỘP CV CỦA BẠN CHO NHÀ TUYỂN DỤNG")).not.toBeInTheDocument();
        expect(getDetailUserById).not.toHaveBeenCalled();
        expect(createNewCv).not.toHaveBeenCalled();
    });

    it("rejects files larger than 2 MB", async () => {
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);
        await waitFor(() => expect(getDetailUserById).toHaveBeenCalled());
        const file = new File([new Uint8Array(2097153)], "large.pdf", { type: "application/pdf" });
        fireEvent.change(screen.getByLabelText("Chọn tệp CV"), { target: { files: [file] } });
        expect(toast.error).toHaveBeenCalledWith("File của bạn quá lớn. Chỉ gửi file dưới 2MB");
        expect(CommonUtils.getBase64).not.toHaveBeenCalled();
    });

    it("encodes, previews and submits a selected PDF", async () => {
        jest.useFakeTimers();
        const onHide = jest.fn();
        render(<SendCvModal isOpen postId={22} onHide={onHide} />);
        await act(async () => { await Promise.resolve(); });
        fireEvent.change(screen.getByPlaceholderText("Giới thiệu sơ lược về bản thân để tăng sự yêu thích đối với nhà tuyển dụng"), {
            target: { value: "Tôi có 5 năm kinh nghiệm" },
        });
        const file = new File(["pdf"], "cv.pdf", { type: "application/pdf" });
        let resolveBase64;
        CommonUtils.getBase64.mockImplementationOnce(() => new Promise((resolve) => {
            resolveBase64 = resolve;
        }));
        fireEvent.change(screen.getByLabelText("Chọn tệp CV"), { target: { files: [file] } });
        await act(async () => {
            resolveBase64("data:application/pdf;base64,UERG");
        });
        await waitFor(() => expect(CommonUtils.getBase64).toHaveBeenCalledWith(file));
        expect(await screen.findByRole("link", { name: /xem lại CV/ })).toHaveAttribute("href", "blob:preview");

        fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
        await waitFor(() => expect(createNewCv).toHaveBeenCalledWith({
            userId: 8,
            file: "data:application/pdf;base64,UERG",
            postId: 22,
            description: "Tôi có 5 năm kinh nghiệm",
        }));
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        expect(toast.success).toHaveBeenCalledWith("Đã gửi thành công");
        expect(onHide).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    it("can submit the saved online CV", async () => {
        jest.useFakeTimers();
        getDetailUserById.mockResolvedValue({
            errCode: 0,
            data: { userAccountData: { userSettingData: { file: "data:application/pdf;base64,QQ==" } } },
        });
        render(<SendCvModal isOpen postId={23} onHide={jest.fn()} />);
        await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
        fireEvent.click(screen.getByLabelText("CV online"));
        expect(screen.getByRole("link", { name: /xem lại CV/ })).toHaveAttribute("href", "blob:preview");
        fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
        await waitFor(() => expect(createNewCv).toHaveBeenCalledWith(expect.objectContaining({
            userId: 8,
            postId: 23,
            file: "data:application/pdf;base64,QQ==",
        })));
        act(() => jest.advanceTimersByTime(1000));
        jest.useRealTimers();
    });

    it("shows a send failure and keeps the modal open", async () => {
        jest.useFakeTimers();
        const onHide = jest.fn();
        createNewCv.mockResolvedValue({ errCode: 2 });
        render(<SendCvModal isOpen postId={24} onHide={onHide} />);
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
        await waitFor(() => expect(createNewCv).toHaveBeenCalled());
        act(() => jest.advanceTimersByTime(1000));
        expect(toast.error).toHaveBeenCalledWith("Gửi thất bại");
        expect(onHide).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    it("clears local selection and closes on cancel", async () => {
        const onHide = jest.fn();
        render(<SendCvModal isOpen postId={22} onHide={onHide} />);
        await waitFor(() => expect(getDetailUserById).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(createNewCv).not.toHaveBeenCalled();
    });
});
