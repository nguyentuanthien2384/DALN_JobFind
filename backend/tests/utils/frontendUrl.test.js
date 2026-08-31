const { getFrontendUrl, getFrontendLink } = require('../../src/utils/frontendUrl');

describe('frontend URL helpers', () => {
  const originalUrl = process.env.URL_REACT;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.URL_REACT;
    else process.env.URL_REACT = originalUrl;
  });

  test('uses only the primary configured origin for links', () => {
    process.env.URL_REACT = ' https://jobfind.example.com/, http://localhost:3000 ';
    expect(getFrontendUrl()).toBe('https://jobfind.example.com');
    expect(getFrontendLink('/detail-job/8')).toBe('https://jobfind.example.com/detail-job/8');
  });

  test('falls back safely and normalizes paths', () => {
    delete process.env.URL_REACT;
    expect(getFrontendUrl()).toBe('http://localhost:3000');
    expect(getFrontendLink('job')).toBe('http://localhost:3000/job');
    expect(getFrontendLink()).toBe('http://localhost:3000');
  });
});
