const render = require('../../src/utils/mailTemplate');

describe('mailTemplate', () => {
  const originalUrl = process.env.URL_REACT;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.URL_REACT;
    else process.env.URL_REACT = originalUrl;
  });

  test('renders user greeting, every job, escaped-in-source data fields and closing markup', () => {
    process.env.URL_REACT = 'https://jobfind.example.com, http://localhost:3000';
    const html = render([
      {
        id: 10,
        name: 'Backend Engineer',
        addressCompany: 'Đà Nẵng',
        companyData: { name: 'Acme', thumbnail: 'https://img/logo.png' },
        postDetailData: {
          name: 'Backend Engineer',
          description: 'Build APIs',
          salaryTypePostData: { value: '20 triệu' },
          jobTypePostData: { value: 'IT' },
          provincePostData: { value: 'Đà Nẵng' },
          workTypePostData: { value: 'Toàn thời gian' }
        }
      },
      {
        id: 11,
        name: 'Frontend Engineer',
        addressCompany: 'Hà Nội',
        companyData: { name: 'Beta', thumbnail: 'https://img/beta.png' },
        postDetailData: {
          name: 'Frontend Engineer',
          description: 'Build UI',
          salaryTypePostData: { value: '25 triệu' },
          jobTypePostData: { value: 'Software' },
          provincePostData: { value: 'Hà Nội' },
          workTypePostData: { value: 'Từ xa' }
        }
      }
    ], { userSettingData: { firstName: 'An', lastName: 'Nguyễn', image: 'avatar.png' } });

    expect(html).toContain('An Nguyễn');
    expect(html).toContain('Backend Engineer');
    expect(html).toContain('Frontend Engineer');
    expect(html).toContain('https://img/logo.png');
    expect(html).toContain('href="https://jobfind.example.com/detail-job/10"');
    expect(html).toContain('href="https://jobfind.example.com/job"');
    expect(html).not.toContain('example.com, http');
    expect(html).toContain('</html>');
  });

  test('renders a valid empty recommendation email', () => {
    const html = render([], { userSettingData: { firstName: 'A', lastName: 'B', image: 'avatar.png' } });
    expect(html).toContain('A B');
    expect(html).toContain('</html>');
  });
});
