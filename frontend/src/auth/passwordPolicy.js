export const PASSWORD_HINT = 'Ít nhất 8 ký tự; dùng được dấu, khoảng trắng và ký tự đặc biệt (tối đa 72 byte).';
// Same rule as backend/src/utils/accountValidation.js: spaces inside a passphrase are fine,
// a password made only of blanks or invisible characters is not.
const BLANK_PASSWORD = /^[\s\p{Cf}]*$/u;

export const validatePassword = value => {
  if (typeof value !== 'string' || [...value].length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.';
  if (BLANK_PASSWORD.test(value)) return 'Mật khẩu không được chỉ gồm khoảng trắng hoặc ký tự vô hình.';
  // Count UTF-8 bytes without relying on TextEncoder in older browsers/test runners.
  const bytes = [...value].reduce((total, character) => {
    const code = character.codePointAt(0);
    return total + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);
  }, 0);
  return bytes > 72 ? 'Mật khẩu vượt quá 72 byte. Vui lòng rút ngắn mật khẩu.' : '';
};
