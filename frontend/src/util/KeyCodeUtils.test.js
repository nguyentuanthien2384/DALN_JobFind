import KeyCodeUtils from "./KeyCodeUtils";

describe("KeyCodeUtils", () => {
    it("exposes the key codes used by keyboard handlers", () => {
        expect(KeyCodeUtils.UP).toBe(38);
        expect(KeyCodeUtils.DOWN).toBe(40);
        expect(KeyCodeUtils.TAB).toBe(9);
        expect(KeyCodeUtils.ENTER).toBe(13);
        expect(KeyCodeUtils.E).toBe(69);
        expect(KeyCodeUtils.ESCAPE).toBe(27);
    });

    it.each([33, 34, 35, 36, 37, 38, 39, 40, 9, 8, 46, 14, 13])("recognizes navigation key %i", (code) => {
        expect(KeyCodeUtils.isNavigation(code)).toBe(true);
    });

    it.each([32, 41, 47, 65])("rejects non-navigation key %i", (code) => {
        expect(KeyCodeUtils.isNavigation(code)).toBe(false);
    });

    it.each([48, 57, 96, 105])("recognizes numeric boundary %i", (code) => {
        expect(KeyCodeUtils.isNumeric(code)).toBe(true);
    });

    it.each([47, 58, 95, 106])("rejects non-numeric boundary %i", (code) => {
        expect(KeyCodeUtils.isNumeric(code)).toBe(false);
    });

    it.each([65, 80, 90])("recognizes alphabetic key %i", (code) => {
        expect(KeyCodeUtils.isAlphabetic(code)).toBe(true);
    });

    it.each([64, 91, 97])("rejects non-uppercase alphabetic key %i", (code) => {
        expect(KeyCodeUtils.isAlphabetic(code)).toBe(false);
    });

    it.each([190, 188, 108, 110])("recognizes decimal key %i", (code) => {
        expect(KeyCodeUtils.isDecimal(code)).toBe(true);
    });

    it.each([109, 189])("recognizes dash key %i", (code) => {
        expect(KeyCodeUtils.isDash(code)).toBe(true);
    });

    it("rejects unrelated decimal and dash keys", () => {
        expect(KeyCodeUtils.isDecimal(191)).toBe(false);
        expect(KeyCodeUtils.isDash(190)).toBe(false);
    });
});
