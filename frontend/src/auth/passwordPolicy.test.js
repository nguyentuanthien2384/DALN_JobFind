import { PASSWORD_HINT, validatePassword } from "./passwordPolicy";

// Mirrors backend/tests/utils/accountValidation.test.js so both sides accept the same passwords.
const ch = (code) => String.fromCharCode(code);
const BLANK = "Mật khẩu không được chỉ gồm khoảng trắng hoặc ký tự vô hình.";

describe("validatePassword", () => {
    it.each([
        ["8 spaces", " ".repeat(8)],
        ["tabs and newlines", [9, 10, 13, 9, 10, 13, 9, 10].map(ch).join("")],
        ["no-break spaces", ch(0xa0).repeat(8)],
        ["ideographic spaces", ch(0x3000).repeat(8)],
        ["zero-width spaces", ch(0x200b).repeat(8)],
        ["a mix of blanks and invisible marks", `${ch(0x200b)} ${ch(0xfeff)}${ch(0xa0)}${ch(0x200d)}  ${ch(0x2060)}`],
    ])("rejects a password made only of %s", (_case, password) => {
        expect(validatePassword(password)).toBe(BLANK);
    });

    it.each(["a       ", "       1", "mật khẩu", "  mật khẩu có khoảng trắng  "])("accepts %p because it has a visible character", (password) => {
        expect(validatePassword(password)).toBe("");
    });

    it("checks the minimum length in Unicode characters before the blank rule", () => {
        expect(validatePassword("   ")).toBe("Mật khẩu cần ít nhất 8 ký tự.");
        expect(validatePassword("😀".repeat(7))).toBe("Mật khẩu cần ít nhất 8 ký tự.");
        expect(validatePassword("😀".repeat(8))).toBe("");
    });

    it("counts UTF-8 bytes for the bcrypt limit", () => {
        expect(validatePassword("a".repeat(72))).toBe("");
        expect(validatePassword("a".repeat(73))).toBe("Mật khẩu vượt quá 72 byte. Vui lòng rút ngắn mật khẩu.");
        expect(validatePassword("á".repeat(36))).toBe("");
        expect(validatePassword("á".repeat(37))).toContain("72 byte");
        expect(validatePassword("ạ".repeat(24))).toBe("");
        expect(validatePassword("ạ".repeat(25))).toContain("72 byte");
    });

    it.each([undefined, null, 12345678, {}])("rejects a non-string value %p", (value) => {
        expect(validatePassword(value)).toBe("Mật khẩu cần ít nhất 8 ký tự.");
    });

    it("still advertises that spaces are allowed inside a passphrase", () => {
        expect(PASSWORD_HINT).toContain("khoảng trắng");
    });
});
