import { readJsonStorage } from "./storage";

describe("readJsonStorage", () => {
    beforeEach(() => localStorage.clear());

    it("returns parsed data and supports a fallback for a missing key", () => {
        localStorage.setItem("profile", JSON.stringify({ id: 7 }));

        expect(readJsonStorage("profile")).toEqual({ id: 7 });
        expect(readJsonStorage("missing", {})).toEqual({});
    });

    it("removes malformed JSON instead of crashing the page", () => {
        localStorage.setItem("profile", "{not-json");

        expect(readJsonStorage("profile", null)).toBeNull();
        expect(localStorage.getItem("profile")).toBeNull();
    });
});
