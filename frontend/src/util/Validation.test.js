import handleValidate from "./Validation";

describe("handleValidate", () => {
    it.each(["", null])("rejects an empty value (%p) before type checks", (value) => {
        expect(handleValidate(value, "isEmpty")).toBe("Không được để trống");
    });

    it("accepts a non-empty value", () => {
        expect(handleValidate("text", "isEmpty")).toBe(true);
    });

    it.each(["abc123", "A1b2C3", "a".repeat(20)])("accepts valid password %s", (value) => {
        expect(handleValidate(value, "password")).toBe(true);
    });

    it.each(["short", "a".repeat(21), "abc123!", "mậtKhẩu1"])('rejects invalid password "%s"', (value) => {
        expect(handleValidate(value, "password")).toBe(
            "Mật khẩu không có ký tự đặt biệt và 6 ký tự trở lên và tối đa 20 ký tự"
        );
    });

    it.each(["user@example.com", "first.last@sub.co"])("accepts valid email %s", (value) => {
        expect(handleValidate(value, "email")).toBe(true);
    });

    it.each(["missing-at.example.com", "a@b", "a b@example.com"])("rejects invalid email %s", (value) => {
        expect(handleValidate(value, "email")).toBe("Email sai định dạng");
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
