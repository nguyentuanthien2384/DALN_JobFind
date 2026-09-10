import { getJobSections, jobTimestamp, safeJobHtml } from './jobDescription';

test('separates existing editor headings and preserves the actual requirements and benefits', () => {
    const sections = getJobSections({ descriptionHTML: '<div><h2><strong>Mô tả công việc</strong></h2><p>Xây dựng sản phẩm.</p><p><strong>Yêu cầu ứng viên:</strong></p><ul><li>React và TypeScript</li></ul><h2>Quyền lợi</h2><ul><li><strong>Tháng lương 13</strong><br>Thưởng hiệu quả</li><li>Bảo hiểm sức khỏe</li></ul></div>' });
    expect(sections.description).toBe('<p>Xây dựng sản phẩm.</p>');
    expect(sections.requirements).toContain('<li>React và TypeScript</li>');
    expect(sections.benefits).toEqual(['<strong>Tháng lương 13</strong><br>Thưởng hiệu quả', 'Bảo hiểm sức khỏe']);
});

test('supports legacy unsplit text, Markdown and missing content without invented benefits', () => {
    expect(getJobSections({ descriptionHTML: '<p>Thông tin công việc</p>' })).toEqual({ description: '<p>Thông tin công việc</p>', requirements: '', benefits: [] });
    expect(getJobSections({ descriptionMarkdown: '## Yêu cầu ứng viên\n- React\n## Quyền lợi\n- Đào tạo' }).benefits).toEqual(['Đào tạo']);
    expect(getJobSections().benefits).toEqual([]);
});

test('removes executable markup while preserving safe rich text and links', () => {
    const html = safeJobHtml('<script>alert(1)</script><iframe src="bad"></iframe><svg onload="bad()"></svg><p onclick="bad()" style="position:fixed">Nội dung <strong>hợp lệ</strong></p><a href="javascript:alert(1)">x</a><a href="https://example.test" onmouseover="bad()">Công ty</a>');
    expect(html).not.toMatch(/script|iframe|svg|onclick|style=|javascript:|onmouseover/);
    expect(html).toContain('<strong>hợp lệ</strong>');
    expect(html).toContain('href="https://example.test"');
});

test('accepts API millisecond strings and ISO dates but rejects missing dates', () => {
    expect(jobTimestamp('1893456000000')).toBe(1893456000000);
    expect(jobTimestamp('2030-01-01T00:00:00Z')).toBe(1893456000000);
    [null, '', undefined, 'bad', 0].forEach(value => expect(jobTimestamp(value)).toBeNull());
});

test('omits blank legacy benefit rows and preserves encoded text as text', () => {
    const sections = getJobSections({ descriptionHTML: '&lt;strong&gt;literal&lt;/strong&gt;<h2>Quyền lợi</h2><ul><li></li><li> &nbsp; </li><li>Đào tạo</li></ul>' });
    expect(sections.description).toBe('&lt;strong&gt;literal&lt;/strong&gt;');
    expect(sections.benefits).toEqual(['Đào tạo']);
});
