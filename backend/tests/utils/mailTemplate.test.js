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

  test('escapes job, company and user text so other accounts cannot inject markup', () => {
    process.env.URL_REACT = 'https://jobfind.example.com';
    const html = render([{
      id: '10"><script>',
      companyData: { name: '<a href="https://phish.example">Acme</a>', thumbnail: 'x" onerror="alert(1)' },
      postDetailData: {
        name: '<img src=x onerror=alert(1)>Backend',
        provincePostData: { value: '<b>Đà Nẵng</b>' },
        workTypePostData: { value: 'Toàn & thời gian' },
        salaryTypePostData: { value: "20' triệu" }
      }
    }], { userSettingData: { firstName: '<i>An</i>', lastName: 'Nguyễn', image: 'a.png onload=alert(1)' } });

    expect(html).not.toMatch(/<(?:script|img src=x|a href="https:\/\/phish|b>|i>)/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Backend');
    expect(html).toContain('&lt;a href=&quot;https://phish.example&quot;&gt;Acme&lt;/a&gt;');
    expect(html).toContain('src="x&quot; onerror=&quot;alert(1)"');
    expect(html).toContain('src="a.png onload=alert(1)"');
    expect(html).toContain('&lt;i&gt;An&lt;/i&gt; Nguyễn');
    expect(html).toContain('&lt;b&gt;Đà Nẵng&lt;/b&gt;');
    expect(html).toContain('Toàn &amp; thời gian');
    expect(html).toContain('20&#039; triệu');
    expect(html).toContain('href="https://jobfind.example.com/detail-job/10%22%3E%3Cscript%3E"');
  });

  test('does not print "null" for a missing last name or catalogue value', () => {
    const html = render([{
      id: 3,
      companyData: { name: 'Acme', thumbnail: null },
      postDetailData: { name: 'Tester', provincePostData: { value: null }, workTypePostData: {}, salaryTypePostData: null }
    }], { userSettingData: { firstName: 'An', lastName: null, image: null } });
    expect(html).toContain('<span>An</span>');
    expect(html).not.toMatch(/>\s*null\b|: null|An null/);
    expect(html).toContain('Địa điểm: Chưa cập nhật');
    expect(html).toContain('Lương: Chưa cập nhật');
    expect(html).toContain('src=""');
  });

  test('renders a valid empty recommendation email', () => {
    const html = render([], { userSettingData: { firstName: 'A', lastName: 'B', image: 'avatar.png' } });
    expect(html).toContain('A B');
    expect(html).toContain('</html>');
  });
});
