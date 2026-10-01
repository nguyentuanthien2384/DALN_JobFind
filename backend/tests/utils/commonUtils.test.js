const mockSign = jest.fn(() => 'signed-token');
const mockExtractBuffer = jest.fn();
const mockExtractKeywords = jest.fn();
const TEST_JWT_SECRET = 'unit-test-jwt-secret-2026-with-entropy';

jest.mock('jsonwebtoken', () => ({ sign: mockSign }));
jest.mock('pdf.js-extract', () => ({
  PDFExtract: jest.fn(() => ({ extractBuffer: mockExtractBuffer }))
}));
jest.mock('keyword-extractor', () => ({ extract: mockExtractKeywords }));

describe('CommonUtils', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSign.mockClear();
    mockExtractBuffer.mockReset();
    mockExtractKeywords.mockReset();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  test('encodes identity and authorisation claims into a signed token', () => {
    const { encodeToken } = require('../../src/utils/CommonUtils');
    expect(encodeToken(12, 'ADMIN', 9)).toBe('signed-token');
    expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({
      sub: 12, roleCode: 'ADMIN', companyId: 9
    }), TEST_JWT_SECRET, { algorithm: 'HS256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 });
    const claims = mockSign.mock.calls[0][0];
    expect(claims).not.toHaveProperty('iat');
    expect(claims).not.toHaveProperty('exp');
  });

  test('creates NumericDate claims in seconds with an exact fifteen-minute lifetime', () => {
    const realJwt = jest.requireActual('jsonwebtoken');
    mockSign.mockImplementation((...args) => realJwt.sign(...args));
    const before = Math.floor(Date.now() / 1000);
    const { encodeToken } = require('../../src/utils/CommonUtils');
    const token = encodeToken(12, 'ADMIN', 9);
    const after = Math.floor(Date.now() / 1000);
    const claims = realJwt.verify(token, TEST_JWT_SECRET);

    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(after);
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims.iss).toBe('jobfind-auth');
    expect(claims.aud).toBe('jobfind-api');
  });

  test('extracts PDF data from a base64 data URI', async () => {
    const pdfResult = { pages: [{ content: [] }] };
    mockExtractBuffer.mockResolvedValue(pdfResult);
    const { pdfToString } = require('../../src/utils/CommonUtils');
    const uri = `data:application/pdf;base64,${Buffer.from('pdf').toString('base64')}`;
    expect(await pdfToString(Buffer.from(uri).toString('base64'))).toBe(pdfResult);
    expect(mockExtractBuffer).toHaveBeenCalledWith(expect.any(Buffer), {});
  });

  test('returns null rather than rejecting when PDF parsing fails', async () => {
    mockExtractBuffer.mockRejectedValue(new Error('invalid pdf'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { pdfToString } = require('../../src/utils/CommonUtils');
    expect(await pdfToString(Buffer.from('data:x;base64,eA==').toString('base64'))).toBeNull();
  });

  test('reads a CV stored as a raw BLOB buffer holding the data URI', async () => {
    const pdfResult = { pages: [] };
    mockExtractBuffer.mockResolvedValue(pdfResult);
    const { pdfToString } = require('../../src/utils/CommonUtils');
    const blob = Buffer.from(`data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}`);
    expect(await pdfToString(blob)).toBe(pdfResult);
    expect(mockExtractBuffer.mock.calls[0][0].toString()).toBe('%PDF-1.7');
  });

  test.each([
    ['a missing file', null],
    ['an undefined file', undefined],
    ['a value that is not a data URI', Buffer.from('plain text without separator').toString('base64')],
    ['a data URI without payload', Buffer.from('data:application/pdf;base64,').toString('base64')]
  ])('returns null for %s without calling the PDF parser', async (_label, file) => {
    const { pdfToString } = require('../../src/utils/CommonUtils');
    await expect(pdfToString(file)).resolves.toBeNull();
    expect(mockExtractBuffer).not.toHaveBeenCalled();
  });

  test('maps extracted keywords by stable numeric indexes', () => {
    mockExtractKeywords.mockReturnValue(['node', 'react']);
    const { getAllKeyWords } = require('../../src/utils/CommonUtils');
    expect([...getAllKeyWords('Node React')]).toEqual([[0, 'node'], [1, 'react']]);
    expect(mockExtractKeywords).toHaveBeenCalledWith('Node React', expect.objectContaining({
      language: 'english', remove_duplicates: true
    }));
  });

  test('flattens Vietnamese text for accent-insensitive matching', () => {
    const { flatAllString } = require('../../src/utils/CommonUtils');
    expect(flatAllString('Đặng Văn Lâm 2026!')).toBe('dangvanlam');
  });

  test.each([
    ['ĐÀ NẴNG', 'danang'],
    ['Node.js / React', 'nodejsreact'],
    ['Kỹ năng giao tiếp', 'kynanggiaotiep'],
    ['  ', ''],
    ['2026 - 100%', '']
  ])('flattens %p to %p', (input, expected) => {
    const { flatAllString } = require('../../src/utils/CommonUtils');
    expect(flatAllString(input)).toBe(expected);
  });

  test('returns an empty keyword map when no keyword is found', () => {
    mockExtractKeywords.mockReturnValue([]);
    const { getAllKeyWords } = require('../../src/utils/CommonUtils');
    expect(getAllKeyWords('').size).toBe(0);
  });
});
