const mockSign = jest.fn(() => 'signed-token');
const mockExtractBuffer = jest.fn();
const mockExtractKeywords = jest.fn();

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
    process.env.JWT_SECRET = 'unit-secret';
  });

  test('encodes identity and authorisation claims into a signed token', () => {
    const { encodeToken } = require('../../src/utils/CommonUtils');
    expect(encodeToken(12, 'ADMIN', 9)).toBe('signed-token');
    expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({
      iss: 'Tai Nguyen', sub: 12, roleCode: 'ADMIN', companyId: 9
    }), 'unit-secret', { expiresIn: '3d' });
    const claims = mockSign.mock.calls[0][0];
    expect(claims).not.toHaveProperty('iat');
    expect(claims).not.toHaveProperty('exp');
  });

  test('creates NumericDate claims in seconds with an exact three-day lifetime', () => {
    const realJwt = jest.requireActual('jsonwebtoken');
    mockSign.mockImplementation((...args) => realJwt.sign(...args));
    const before = Math.floor(Date.now() / 1000);
    const { encodeToken } = require('../../src/utils/CommonUtils');
    const token = encodeToken(12, 'ADMIN', 9);
    const after = Math.floor(Date.now() / 1000);
    const claims = realJwt.verify(token, 'unit-secret');

    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(after);
    expect(claims.exp - claims.iat).toBe(3 * 24 * 60 * 60);
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
});
