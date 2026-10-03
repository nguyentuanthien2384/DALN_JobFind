import handleValidate from "./Validation";

describe("handleValidate", () => {
    it.each(["", null])("rejects an empty value (%p) before type checks", (value) => {
        expect(handleValidate(value, "isEmpty")).toBe("Không được để trống");
    });

    it("accepts a non-empty value", () => {
        expect(handleValidate("text", "isEmpty")).toBe(true);
    });

    it.each(["abc12345", "A1b2C3d4", "a".repeat(72), "mật Khẩu!", "😀".repeat(18)])("accepts a valid Unicode password %s", value => {
        expect(handleValidate(value, "password")).toBe(true);
    });
    it.each(["short", "😀".repeat(7)])("requires at least eight codepoints", value => {
        expect(handleValidate(value, "password")).toBe("Mật khẩu cần ít nhất 8 ký tự.");
    });
    it.each(["a".repeat(73), "😀".repeat(19)])("rejects passwords beyond bcrypt's UTF-8 limit", value => {
        expect(handleValidate(value, "password")).toBe("Mật khẩu vượt quá 72 byte. Vui lòng rút ngắn mật khẩu.");
    });

    it.each([
        "user@example.com", "first.last@sub.co", "hr@company.info", "dev@startup.technology",
        "an.nguyen+jobs@gmail.com", "tuyen-dung@fpt.com.vn", " padded@candidate.vn ",
        `${"a".repeat(64)}@x.vn`, `a@${"b".repeat(63)}.vn`,
    ])("accepts valid email %s (same structure the backend accepts)", (value) => {
        expect(handleValidate(value, "email")).toBe(true);
    });

    it.each([
        "missing-at.example.com", "a@b", "a b@example.com", "two@@at.vn", "a@b@c.vn",
        ".lead@dot.vn", "trail.@dot.vn", "dou..ble@dot.vn", "a@-dash.vn", "a@dash-.vn", "a@dot..vn",
        `${"a".repeat(65)}@x.vn`, `a@${"b".repeat(64)}.vn`, `a@${"b.".repeat(126)}vn`,
    ])("rejects invalid email %s", (value) => {
        expect(handleValidate(value, "email")).toBe("Email sai định dạng");
    });

    it("validates hostile long input in linear time instead of freezing the tab", () => {
        const started = Date.now();
        for (const input of ["a".repeat(5000) + "!", "a.".repeat(2500) + "@", `x@${"a-".repeat(2500)}`]) {
            expect(handleValidate(input, "email")).toBe("Email sai định dạng");
        }
        expect(Date.now() - started).toBeLessThan(200);
    });

    it("accepts exactly ten phone digits", () => {
        expect(handleValidate("0912345678", "phone")).toBe(true);
    });

    it.each(["091234567", "09123456789", "09123a5678"])("rejects invalid phone %s", (value) => {
        expect(handleValidate(value, "phone")).toBe("Số điện thoại cần 10 số");
    });

    it("returns the documented sentinel for an unknown validation type", () => {
        expect(handleValidate("value", "unknown")).toBe(2);
    });
});
