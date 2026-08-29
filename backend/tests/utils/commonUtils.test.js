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
    }), 'unit-secret');
    const claims = mockSign.mock.calls[0][0];
    expect(claims.exp).toBeGreaterThan(claims.iat);
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
