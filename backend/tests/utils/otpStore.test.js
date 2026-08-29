describe('otpStore', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    jest.spyOn(Math, 'random').mockReturnValue(0.123456);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('issues a six-digit OTP, enforces cooldown, and permits resend later', () => {
    const otp = require('../../src/utils/otpStore');
    expect(otp.issueOtp('0901')).toEqual({ code: '211110', waitSeconds: 0 });
    expect(otp.issueOtp('0901')).toEqual({ code: null, waitSeconds: 60 });
    jest.advanceTimersByTime(otp.RESEND_COOLDOWN_MS);
    expect(otp.issueOtp('0901')).toEqual({ code: '211110', waitSeconds: 0 });
  });

  test('accepts a correct OTP exactly once', () => {
    const otp = require('../../src/utils/otpStore');
    const issued = otp.issueOtp('0902');
    expect(otp.verifyOtp('0902', Number(issued.code))).toEqual({ valid: true });
    expect(otp.verifyOtp('0902', issued.code)).toEqual({
      valid: false,
      errMessage: 'Mã xác thực không đúng hoặc đã hết hạn'
    });
  });

  test('rejects expired codes and clears codes explicitly', () => {
    const otp = require('../../src/utils/otpStore');
    const issued = otp.issueOtp('0903');
    jest.advanceTimersByTime(otp.OTP_TTL_MS + 1);
    expect(otp.verifyOtp('0903', issued.code).valid).toBe(false);
    otp.issueOtp('0904');
    expect(otp.clearOtp('0904')).toBe(true);
    expect(otp.verifyOtp('0904', '211110').valid).toBe(false);
  });

  test('invalidates a code after five wrong attempts', () => {
    const otp = require('../../src/utils/otpStore');
    otp.issueOtp('0905');
    for (let i = 0; i < 5; i += 1) {
      expect(otp.verifyOtp('0905', '000000').valid).toBe(false);
    }
    expect(otp.verifyOtp('0905', '211110')).toEqual({
      valid: false,
      errMessage: 'Bạn đã nhập sai quá nhiều lần, vui lòng yêu cầu mã mới'
    });
  });
});
