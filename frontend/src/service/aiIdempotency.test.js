import axios from "../axios";
import { createAiRequestOptions, parseResumeAi, matchCvAi, coverLetterAi } from "./aiSearchService";

jest.mock("../axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
beforeAll(() => { Object.defineProperty(globalThis, "crypto", { value: require("crypto").webcrypto, configurable: true }); });
beforeEach(() => { axios.post.mockReset().mockResolvedValue({ errCode: 0, taskId: "task-1" }); });

test.each([
    [parseResumeAi, ["PDF", "cv.pdf"], "/api/ai/parse-resume", { fileBase64: "PDF", fileName: "cv.pdf" }],
    [matchCvAi, ["CV", 7], "/api/ai/match-cv", { resumeText: "CV", jobId: 7 }],
    [coverLetterAi, ["CV", 7, "vi"], "/api/ai/cover-letter", { resumeText: "CV", jobId: 7, language: "vi" }]
])("reuses one explicit action key for overlapping calls and later retries", async (handler, args, path, body) => {
    const options = createAiRequestOptions();
    const responses = await Promise.all([handler(...args, options), handler(...args, options)]);
    const later = await handler(...args, options);
    expect(axios.post).toHaveBeenCalledTimes(3);
    for (const call of axios.post.mock.calls) expect(call).toEqual([path, body, { headers: { "Idempotency-Key": options.idempotencyKey } }]);
    for (const result of [...responses, later]) expect(result).toEqual({ errCode: 0, taskId: "task-1", idempotencyKey: options.idempotencyKey });
});

test("exposes the original key on a normalized network/server error for manual retry", async () => {
    axios.post.mockResolvedValueOnce({ errCode: -1, errMessage: "Network unavailable" });
    const failed = await parseResumeAi("PDF", "cv.pdf");
    expect(failed.errCode).toBe(-1);
    expect(failed.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const retried = await parseResumeAi("PDF", "cv.pdf", { idempotencyKey: failed.idempotencyKey });
    expect(axios.post.mock.calls[1][2]).toEqual(axios.post.mock.calls[0][2]);
    expect(retried.taskId).toBe("task-1");
});

test("preserves a key on rejected calls without silently retrying", async () => {
    const options = createAiRequestOptions();
    const failure = new Error("connection lost");
    axios.post.mockRejectedValueOnce(failure);
    await expect(matchCvAi("CV", 7, options)).rejects.toMatchObject({ idempotencyKey: options.idempotencyKey });
    expect(axios.post).toHaveBeenCalledTimes(1);
});

test("keeps intentional new submissions distinct without remembering CV content", async () => {
    const first = await parseResumeAi("PDF", "cv.pdf");
    const second = await parseResumeAi("PDF", "cv.pdf");
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(Object.keys(createAiRequestOptions())).toEqual(["idempotencyKey"]);
});

test.each(["", "invalid,key", "x".repeat(129)])("rejects invalid explicit keys without sending", async (idempotencyKey) => {
    await expect(parseResumeAi("PDF", "cv.pdf", { idempotencyKey })).rejects.toThrow("không hợp lệ");
    expect(axios.post).not.toHaveBeenCalled();
});
