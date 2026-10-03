describe('otpStore', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(211110);
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

// Business rules are asserted with literal values from the specification, never with the
// module's own constants: a test that waits `OTP_TTL_MS + 1` still passes if the TTL drops to 1ms.
describe('otpStore business rules', () => {
  const FIVE_MINUTES = 5 * 60 * 1000;
  const ONE_MINUTE = 60 * 1000;
  let otp;
  let randomInt;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    randomInt = jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(483920);
    otp = require('../../src/utils/otpStore');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('exposes the documented 5 minute lifetime and 60 second resend cooldown', () => {
    expect(otp.OTP_TTL_MS).toBe(FIVE_MINUTES);
    expect(otp.RESEND_COOLDOWN_MS).toBe(ONE_MINUTE);
  });

  test('draws codes uniformly from the six-digit range only', () => {
    otp.issueOtp('0911');
    expect(randomInt).toHaveBeenCalledWith(100000, 1000000);
  });

  test('generates real six-digit codes without mocking randomness', () => {
    randomInt.mockRestore();
    jest.resetModules();
    const fresh = require('../../src/utils/otpStore');
    for (let i = 0; i < 200; i += 1) {
      expect(fresh.issueOtp(`phone-${i}`).code).toMatch(/^[1-9][0-9]{5}$/);
    }
  });

  test('keeps a code valid one millisecond before five minutes and expires it at exactly five minutes', () => {
    otp.issueOtp('0912');
    jest.advanceTimersByTime(FIVE_MINUTES - 1);
    expect(otp.verifyOtp('0912', '483920')).toEqual({ valid: true });

    jest.advanceTimersByTime(ONE_MINUTE);
    otp.issueOtp('0912');
    jest.advanceTimersByTime(FIVE_MINUTES);
    expect(otp.verifyOtp('0912', '483920')).toEqual({ valid: false, errMessage: 'Mã xác thực không đúng hoặc đã hết hạn' });
  });

  test('reports the remaining cooldown rounded up to whole seconds', () => {
    otp.issueOtp('0913');
    jest.advanceTimersByTime(1);
    expect(otp.issueOtp('0913')).toEqual({ code: null, waitSeconds: 60 });
    jest.advanceTimersByTime(1000);
    expect(otp.issueOtp('0913')).toEqual({ code: null, waitSeconds: 59 });
    jest.advanceTimersByTime(ONE_MINUTE - 1002);
    expect(otp.issueOtp('0913')).toEqual({ code: null, waitSeconds: 1 });
    jest.advanceTimersByTime(1);
    expect(otp.issueOtp('0913').code).toBe('483920');
  });

  test('a resend replaces the previous code and resets the wrong-attempt counter', () => {
    otp.issueOtp('0914');
    for (let i = 0; i < 4; i += 1) expect(otp.verifyOtp('0914', '000000').valid).toBe(false);
    jest.advanceTimersByTime(ONE_MINUTE);
    randomInt.mockReturnValue(777111);
    expect(otp.issueOtp('0914').code).toBe('777111');
    expect(otp.verifyOtp('0914', '483920').valid).toBe(false);
    expect(otp.verifyOtp('0914', '777111')).toEqual({ valid: true });
  });

  test('allows the correct code on the fifth try but not after five failures', () => {
    otp.issueOtp('0915');
    for (let i = 0; i < 4; i += 1) otp.verifyOtp('0915', '000000');
    expect(otp.verifyOtp('0915', '483920')).toEqual({ valid: true });
  });

  test.each(['48392', '4839200', '48392a', ' 483920', '', null, undefined])(
    'counts a malformed code %p as a wrong attempt without throwing', (code) => {
      otp.issueOtp('0916');
      expect(otp.verifyOtp('0916', code).valid).toBe(false);
      expect(otp.verifyOtp('0916', '483920')).toEqual({ valid: true });
    });

  test('keeps codes for different phone numbers independent', () => {
    randomInt.mockReturnValueOnce(111111).mockReturnValueOnce(222222);
    otp.issueOtp('0917');
    otp.issueOtp('0918');
    expect(otp.verifyOtp('0917', '222222').valid).toBe(false);
    expect(otp.verifyOtp('0918', '222222')).toEqual({ valid: true });
    expect(otp.verifyOtp('0917', '111111')).toEqual({ valid: true });
  });
});
