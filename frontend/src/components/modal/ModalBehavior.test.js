import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { createNewCv } from "../../service/cvService";
import { getDetailUserById } from "../../service/userService";
import CommonUtils from "../../util/CommonUtils";
import NoteModal from "./NoteModal";
import ReupPostModal from "./ReupPostModal";
import SendCvModal from "./SendCvModal";
import PdfPreviewButton from '../documents/PdfPreviewButton';
const samplePdf = 'data:application/pdf;base64,JVBERi0xLjcKZml4dHVyZQ==';
const fillApplication = async () => {
    fireEvent.change(screen.getByLabelText('Lời giới thiệu'), { target: { value: 'Tôi muốn ứng tuyển' } });
    fireEvent.change(screen.getByLabelText('Chọn tệp CV'), { target: { files: [new File(['pdf'], 'cv.pdf', { type: 'application/pdf' })] } });
    await screen.findByRole('button', { name: 'Xem trước CV' });
};

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
jest.mock('../documents/PdfPreviewButton', () => jest.fn(), { virtual: true });
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
    // A deadline one year from the real clock, as the date input value and the local-midnight timestamp it submits.
    const futureDay = () => {
        const day = new Date(); day.setHours(0, 0, 0, 0); day.setFullYear(day.getFullYear() + 1);
        const pad = (n) => String(n).padStart(2, "0");
        return { value: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, time: day.getTime() };
    };
    it.each([['core', 'AI kiểm duyệt qua Job Core'], ['legacy', 'duyệt thủ công qua backend cũ']])('explains the selected %s moderation path before confirming', (reviewMode, message) => {
        render(<ReupPostModal isOpen reviewMode={reviewMode} handleFunc={jest.fn()} onHide={jest.fn()} />);
        expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
        expect(screen.getByText(/không dùng phần đang sửa/)).toBeInTheDocument();
    });
    it('restores the submitted date after remount and keeps it on a rejection instead of resetting to tomorrow', async () => {
        const deadline = futureDay().time, onHide = jest.fn(), handleFunc = jest.fn().mockResolvedValue(false);
        const first = render(<ReupPostModal isOpen initialTimeEnd={deadline} handleFunc={handleFunc} onHide={onHide} />);
        expect(screen.getByLabelText('Ngày kết thúc').value).toBe(new Date(deadline).toISOString().slice(0, 10));
        first.unmount(); render(<ReupPostModal isOpen initialTimeEnd={deadline} handleFunc={handleFunc} onHide={onHide} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' })); await screen.findByRole('alert');
        expect(handleFunc).toHaveBeenCalledWith(deadline); expect(onHide).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Ngày kết thúc').value).toBe(new Date(deadline).toISOString().slice(0, 10));
    });
    it('does not confirm a restored past date or a parent-blocked unresolved attempt', async () => {
        const handleFunc = jest.fn(); const { rerender } = render(<ReupPostModal isOpen initialTimeEnd={1577836800000} handleFunc={handleFunc} onHide={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' })); expect(handleFunc).not.toHaveBeenCalled();
        rerender(<ReupPostModal isOpen initialTimeEnd={1924992000000} blocked feedback="Đối chiếu cùng mã" handleFunc={handleFunc} onHide={jest.fn()} />);
        expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('Đối chiếu cùng mã');
    });
    it('awaits submission, blocks two clicks and retains the selected date on a definite failure', async () => {
        let finish; const handleFunc = jest.fn(() => new Promise(resolve => { finish = resolve; })); const onHide = jest.fn();
        render(<ReupPostModal isOpen handleFunc={handleFunc} onHide={onHide} />);
        const date = screen.getByLabelText('Ngày kết thúc'); fireEvent.change(date, { target: { value: futureDay().value } });
        const chosen = date.value;
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' })); fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
        expect(handleFunc).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
        await act(async () => finish(false)); expect(date.value).toBe(chosen); expect(onHide).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeEnabled();
    });
    it('keeps the modal and blocks another call on a thrown uncertain failure', async () => {
        const handleFunc = jest.fn().mockRejectedValue(new Error('transport')), onHide = jest.fn();
        render(<ReupPostModal isOpen handleFunc={handleFunc} onHide={onHide} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' })); await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeDisabled(); expect(onHide).not.toHaveBeenCalled();
    });
    it.each([undefined, null, {}])('does not interpret an unexpected completion %j as a safe-to-retry rejection', async result => {
        const onHide = jest.fn(); render(<ReupPostModal isOpen handleFunc={jest.fn().mockResolvedValue(result)} onHide={onHide} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' })); await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeDisabled(); expect(onHide).not.toHaveBeenCalled();
    });
    it('rejects a past deadline locally and respects a parent conflict/outcome guard', async () => {
        const handleFunc = jest.fn(), onHide = jest.fn(); const { rerender } = render(<ReupPostModal isOpen handleFunc={handleFunc} onHide={onHide} />);
        fireEvent.change(screen.getByLabelText('Ngày kết thúc'), { target: { value: '2020-01-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' })); expect(handleFunc).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('sau thời điểm hiện tại');
        rerender(<ReupPostModal isOpen blocked feedback='Tin gốc đã thay đổi' handleFunc={handleFunc} onHide={onHide} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Tin gốc đã thay đổi');
        expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeDisabled();
    });
    it("submits the selected end-date timestamp and closes after confirmed success", async () => {
        const handleFunc = jest.fn().mockResolvedValue(true);
        const onHide = jest.fn();
        render(<ReupPostModal isOpen handleFunc={handleFunc} onHide={onHide} />);
        const deadline = futureDay();
        fireEvent.change(screen.getByLabelText("Ngày kết thúc"), { target: { value: deadline.value } });
        fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
        expect(handleFunc).toHaveBeenCalledWith(deadline.time);
        await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
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
        localStorage.setItem('token_user', 'candidate-token');
        jest.clearAllMocks();
        PdfPreviewButton.mockImplementation(({ label, disabled }) => <button type="button" disabled={disabled}>{label}</button>);
        createNewCv.mockResolvedValue({ errCode: 0 });
        CommonUtils.getBase64.mockResolvedValue(samplePdf);
    });

    it("offers only the CV file picker, without CV source choices", () => {
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);
        expect(screen.getByLabelText("Chọn tệp CV")).toBeInTheDocument();
        expect(screen.queryByRole("radio")).not.toBeInTheDocument();
        expect(screen.queryByText("CV online")).not.toBeInTheDocument();
        expect(getDetailUserById).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Gửi hồ sơ" })).toBeDisabled();
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
        const file = new File([new Uint8Array(2097153)], "large.pdf", { type: "application/pdf" });
        fireEvent.change(screen.getByLabelText("Chọn tệp CV"), { target: { files: [file] } });
        expect(toast.error).toHaveBeenCalledWith("Tệp CV vượt quá 2 MiB. Vui lòng chọn tệp nhỏ hơn.");
        expect(screen.getByRole('alert')).toHaveTextContent('vượt quá 2 MiB');
        expect(screen.getByRole('button', { name: 'Gửi hồ sơ' })).toBeDisabled();
        expect(CommonUtils.getBase64).not.toHaveBeenCalled();
    });

    it("encodes, previews and submits a selected PDF", async () => {
        jest.useFakeTimers();
        const onHide = jest.fn();
        const onSubmitted = jest.fn();
        render(<SendCvModal isOpen postId={22} onHide={onHide} onSubmitted={onSubmitted} />);
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
            resolveBase64(samplePdf);
        });
        await waitFor(() => expect(CommonUtils.getBase64).toHaveBeenCalledWith(file));
        expect(await screen.findByRole("button", { name: 'Xem trước CV' })).toBeEnabled();
        expect(screen.getByRole('region', { name: 'CV sẽ gửi' })).toHaveTextContent('cv.pdf');
        expect(PdfPreviewButton).toHaveBeenLastCalledWith(expect.objectContaining({ source: samplePdf, fileName: 'cv.pdf' }), expect.anything());

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" })); });
        await waitFor(() => expect(createNewCv).toHaveBeenCalledWith({
            userId: 8,
            file: samplePdf,
            postId: 22,
            description: "Tôi có 5 năm kinh nghiệm",
        }));
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        expect(toast.success).toHaveBeenCalledWith("Đã gửi thành công");
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(onSubmitted).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    it('accepts a PDF with a BOM and generic MIME, then previews and sends the same bytes', async () => {
        const binary = '\xef\xbb\xbf \r\n%PDF-1.7\nExported CV';
        const normalized = `data:application/pdf;base64,${btoa(binary)}`;
        CommonUtils.getBase64.mockResolvedValueOnce(`data:application/octet-stream;base64,${btoa(binary)}`);
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);
        await fillApplication();
        expect(await screen.findByRole('button', { name: 'Xem trước CV' })).toBeEnabled();
        expect(PdfPreviewButton).toHaveBeenLastCalledWith(expect.objectContaining({ source: normalized }), expect.anything());
        fireEvent.click(screen.getByRole('button', { name: 'Gửi hồ sơ' }));
        await waitFor(() => expect(createNewCv).toHaveBeenCalledWith(expect.objectContaining({ file: normalized })));
    });

    it('clears a previous CV on invalid replacement and explains the error next to the input', async () => {
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);
        await fillApplication();
        await screen.findByRole('button', { name: 'Xem trước CV' });
        CommonUtils.getBase64.mockResolvedValueOnce(`data:application/pdf;base64,${btoa('not a PDF')}`);
        fireEvent.change(screen.getByLabelText('Chọn tệp CV'), { target: { files: [new File(['not a PDF'], 'wrong.pdf')] } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Tệp không phải PDF hợp lệ');
        expect(screen.queryByRole('button', { name: 'Xem trước CV' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Chọn tệp CV')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Gửi hồ sơ' })).toBeDisabled();
        expect(createNewCv).not.toHaveBeenCalled();
    });

    it('ignores an older file read after a newer CV is selected', async () => {
        let resolveOld;
        CommonUtils.getBase64.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
        render(<SendCvModal isOpen postId={22} onHide={jest.fn()} />);
        const input = screen.getByLabelText('Chọn tệp CV');
        fireEvent.change(input, { target: { files: [new File(['old'], 'old.pdf')] } });
        fireEvent.change(input, { target: { files: [new File(['new'], 'new.pdf')] } });
        await screen.findByRole('button', { name: 'Xem trước CV' });
        await act(async () => resolveOld('data:application/pdf;base64,' + btoa('%PDF-1.7\nold')));
        expect(screen.getByRole('region', { name: 'CV sẽ gửi' })).toHaveTextContent('new.pdf');
        expect(PdfPreviewButton).toHaveBeenLastCalledWith(expect.objectContaining({ source: samplePdf, fileName: 'new.pdf' }), expect.anything());
    });

    it("does not submit twice on rapid clicks and explains an existing application", async () => {
        let finish;
        createNewCv.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        render(<SendCvModal isOpen postId={23} onHide={jest.fn()} />);
        await fillApplication();
        fireEvent.click(screen.getByRole('button', {name:'Gửi hồ sơ'}));
        fireEvent.click(screen.getByRole('button', {name:'Gửi hồ sơ'}));
        expect(createNewCv).toHaveBeenCalledTimes(1);
        await act(async () => finish({errCode:5,httpStatus:409}));
        expect(toast.error).toHaveBeenCalledWith('Bạn đã ứng tuyển tin này. Hãy kiểm tra CV trong Công việc đã nộp.');
    });

    it("ignores the submitted result after the modal changes job", async () => {
        const onHide = jest.fn();let finish;
        createNewCv.mockReturnValue(new Promise(resolve => {finish=resolve;}));
        const view=render(<SendCvModal isOpen postId={23} onHide={onHide} />);
        await fillApplication();
        fireEvent.click(screen.getByRole('button', {name:'Gửi hồ sơ'}));
        view.rerender(<SendCvModal isOpen postId={24} onHide={onHide} />);
        await act(async () => finish({errCode:0,cvId:10}));
        expect(onHide).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
    });

    it("shows a send failure and keeps the modal open", async () => {
        jest.useFakeTimers();
        const onHide = jest.fn();
        createNewCv.mockResolvedValue({ errCode: 2 });
        render(<SendCvModal isOpen postId={24} onHide={onHide} />);
        await act(async () => { await Promise.resolve(); });
        await fillApplication();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" })); });
        await waitFor(() => expect(createNewCv).toHaveBeenCalled());
        act(() => jest.advanceTimersByTime(1000));
        expect(toast.error).toHaveBeenCalledWith("Gửi thất bại");
        expect(onHide).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    it("clears local selection and closes on cancel", async () => {
        const onHide = jest.fn();
        render(<SendCvModal isOpen postId={22} onHide={onHide} />);
        fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(createNewCv).not.toHaveBeenCalled();
    });
});
