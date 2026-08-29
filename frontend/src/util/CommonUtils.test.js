import * as XLSX from "xlsx/xlsx.mjs";
import CommonUtils from "./CommonUtils";

jest.mock("xlsx/xlsx.mjs", () => ({
    utils: {
        book_new: jest.fn(),
        json_to_sheet: jest.fn(),
        book_append_sheet: jest.fn(),
    },
    writeFile: jest.fn(),
}));

describe("CommonUtils", () => {
    beforeEach(() => jest.clearAllMocks());

    it("resolves a selected file as a data URL", async () => {
        const original = global.FileReader;
        const reader = {
            result: "data:text/plain;base64,aGVsbG8=",
            readAsDataURL: jest.fn(function read() {
                setTimeout(() => this.onload(), 0);
            }),
        };
        global.FileReader = jest.fn(() => reader);
        const file = new File(["hello"], "hello.txt", { type: "text/plain" });

        await expect(CommonUtils.getBase64(file)).resolves.toBe(reader.result);
        expect(reader.readAsDataURL).toHaveBeenCalledWith(file);
        global.FileReader = original;
    });

    it("rejects when FileReader reports an error", async () => {
        const original = global.FileReader;
        const failure = new Error("read failed");
        const reader = {
            readAsDataURL: jest.fn(function read() {
                setTimeout(() => this.onerror(failure), 0);
            }),
        };
        global.FileReader = jest.fn(() => reader);

        await expect(CommonUtils.getBase64(new Blob(["x"]))).rejects.toBe(failure);
        global.FileReader = original;
    });

    it("returns the signed day difference from today", () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 7, 29, 12));
        expect(CommonUtils.formatDate(new Date(2026, 7, 27, 23, 59).getTime())).toBe(-2);
        expect(CommonUtils.formatDate(new Date(2026, 7, 31, 1).getTime())).toBe(2);
        jest.useRealTimers();
    });

    it("trims and collapses whitespace", () => {
        expect(CommonUtils.removeSpace("  hello   world \n from\tVietnam  ")).toBe("hello world from Vietnam");
    });

    it("normalizes case, Vietnamese accents and spaces for search slugs", () => {
        expect(CommonUtils.replaceCode("  ĐiỆn   tỬ  Việt Nam ")).toBe("dien-tu-viet-nam");
        expect(CommonUtils.replaceCode("a\u0301  o\u031B\u0309")).toBe("a-o");
    });

    it("creates and writes an Excel workbook", async () => {
        const workbook = { SheetNames: [] };
        const sheet = { A1: { v: "Lan" } };
        XLSX.utils.book_new.mockReturnValue(workbook);
        XLSX.utils.json_to_sheet.mockReturnValue(sheet);
        const data = [{ name: "Lan" }];

        await expect(CommonUtils.exportExcel(data, "Candidates", "report")).resolves.toBe("oke");
        expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(data);
        expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(workbook, sheet, "Candidates");
        expect(XLSX.writeFile).toHaveBeenCalledWith(workbook, "report.xlsx");
    });
});
