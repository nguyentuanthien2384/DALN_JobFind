import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useScreenings, ScreeningBadge, ScreeningPanel, AiMessageDraft, needsScreening } from "./KanbanAi";
import { getJobScreenings, screenApplicationAi, candidateMessageAi, getAiTask } from "../../../service/aiSearchService";

jest.mock("../../../service/aiSearchService", () => ({
    createAiRequestOptions: () => ({ idempotencyKey: "s".repeat(32) }),
    getJobScreenings: jest.fn(), screenApplicationAi: jest.fn(), candidateMessageAi: jest.fn(), getAiTask: jest.fn(),
}));

const doneRow = { cvId: 21, taskId: "t1", status: "done", createdAt: new Date().toISOString(), score: 84, verdict: "rat_phu_hop",
    summary: "Có kinh nghiệm React", matchedSkills: ["React"], missingSkills: ["Docker"], strengths: ["Dự án thật"], concerns: [] };
const detail = { id: 1, job_id: 7, legacy_cv_id: 21, candidate_name: "Lan Nguyen" };

function Harness({ jobIds }) {
    const { byCv, refresh, screen: run } = useScreenings();
    return <div>
        <button onClick={() => refresh(jobIds)}>refresh</button>
        <button onClick={() => run(22, 7)}>screen</button>
        {Object.values(byCv).map((item) => <div key={item.cvId} data-testid={`cv-${item.cvId}`}><ScreeningBadge item={item} /></div>)}
    </div>;
}

beforeEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });

test("loads the latest results and polls only while a screening is pending", async () => {
    jest.useFakeTimers();
    getJobScreenings.mockResolvedValueOnce({ errCode: 0, data: [doneRow] })
        .mockResolvedValueOnce({ errCode: 0, data: [doneRow, { cvId: 22, taskId: "t2", status: "done", createdAt: new Date().toISOString(), score: 40, summary: "", matchedSkills: [], missingSkills: [], strengths: [], concerns: [] }] });
    screenApplicationAi.mockResolvedValue({ errCode: 0, taskId: "t2" });
    render(<Harness jobIds={[7, 7, null]} />);
    await act(async () => { fireEvent.click(screen.getByText("refresh")); });
    expect(getJobScreenings).toHaveBeenCalledTimes(1);
    expect(screen.getByText("AI 84")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText("screen")); });
    expect(screenApplicationAi).toHaveBeenCalledWith(22, expect.objectContaining({ idempotencyKey: "s".repeat(32) }));
    expect(screen.getByText("AI đang chấm…")).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(4000); });
    await waitFor(() => expect(screen.getByText("AI 40")).toBeInTheDocument());
    expect(getJobScreenings).toHaveBeenCalledTimes(2);
    await act(async () => { jest.advanceTimersByTime(8000); });
    expect(getJobScreenings).toHaveBeenCalledTimes(2);
});

test("shows loaded results under React StrictMode double mounting", async () => {
    getJobScreenings.mockResolvedValue({ errCode: 0, data: [doneRow] });
    render(<React.StrictMode><Harness jobIds={[7]} /></React.StrictMode>);
    await act(async () => { fireEvent.click(screen.getByText("refresh")); });
    expect(screen.getByText("AI 84")).toBeInTheDocument();
});

test("prefers the model verdict over score bands", async () => {
    getJobScreenings.mockResolvedValue({ errCode: 0, data: [{ ...doneRow, score: 70, verdict: "can_can_nhac" }] });
    render(<Harness jobIds={[7]} />);
    await act(async () => { fireEvent.click(screen.getByText("refresh")); });
    expect(screen.getByText("AI 70")).toHaveAttribute("title", "AI: Cần cân nhắc");
});

test("marks invalid stored results as failed instead of showing them", async () => {
    getJobScreenings.mockResolvedValue({ errCode: 0, data: [{ ...doneRow, score: 140 }] });
    render(<Harness jobIds={[7]} />);
    await act(async () => { fireEvent.click(screen.getByText("refresh")); });
    expect(screen.getByText("AI lỗi")).toBeInTheDocument();
});

test("decides which applications still need screening", () => {
    expect(needsScreening(undefined)).toBe(true);
    expect(needsScreening({ status: "failed" })).toBe(true);
    expect(needsScreening({ status: "pending", createdAt: new Date().toISOString() })).toBe(false);
    expect(needsScreening({ status: "pending", createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() })).toBe(true);
    expect(needsScreening({ status: "done", result: { score: 1 } })).toBe(false);
});

test("shows a screening and asks before a paid re-screen", async () => {
    const onScreen = jest.fn().mockResolvedValue(undefined);
    const item = { cvId: 21, jobId: 7, status: "done", createdAt: doneRow.createdAt,
        result: { score: 84, verdict: null, summary: "Có kinh nghiệm React", matchedSkills: ["React"], missingSkills: ["Docker"], strengths: [], concerns: [] } };
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<ScreeningPanel detail={detail} item={item} onScreen={onScreen} />);
    expect(screen.getByText("84")).toBeInTheDocument();
    expect(screen.getByText(/Rất phù hợp/)).toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chấm lại bằng AI" }));
    expect(onScreen).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Chấm lại bằng AI" })); });
    expect(onScreen).toHaveBeenCalledWith(21, 7);
    confirm.mockRestore();
});

test("explains when an application has no submitted CV file", () => {
    render(<ScreeningPanel detail={{ ...detail, legacy_cv_id: null }} item={undefined} onScreen={jest.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("drafts an email note from the recruiter's key points without sending it", async () => {
    candidateMessageAi.mockResolvedValue({ errCode: 0, taskId: "t9" });
    getAiTask.mockResolvedValue({ errCode: 0, data: { id: "t9", type: "write_assist", status: "done", result: { suggestions: ["Cảm ơn Lan đã tham gia phỏng vấn."] } } });
    const onUse = jest.fn();
    render(<AiMessageDraft detail={detail} composer={null} notes=" thiếu kinh nghiệm Docker " interviewed onUse={onUse} />);
    expect(screen.getByRole("combobox", { name: "Loại thư cần soạn" })).toHaveValue("rejection");
    fireEvent.click(screen.getByRole("button", { name: "AI soạn lời nhắn" }));
    expect(candidateMessageAi).toHaveBeenCalledWith({ jobId: 7, emailType: "rejection", candidateName: "Lan Nguyen",
        recruiterNotes: "thiếu kinh nghiệm Docker", interviewed: true }, expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "Dùng nội dung này" }));
    expect(onUse).toHaveBeenCalledWith("Cảm ơn Lan đã tham gia phỏng vấn.");
});

test("follows the open composer for the email type", () => {
    const { rerender } = render(<AiMessageDraft detail={detail} composer="interview" notes="" interviewed={false} onUse={jest.fn()} />);
    expect(screen.getByRole("combobox", { name: "Loại thư cần soạn" })).toHaveValue("interview");
    rerender(<AiMessageDraft detail={detail} composer="offer" notes="" interviewed={false} onUse={jest.fn()} />);
    expect(screen.getByRole("combobox", { name: "Loại thư cần soạn" })).toHaveValue("offer");
});
