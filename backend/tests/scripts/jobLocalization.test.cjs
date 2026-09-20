const assert = require('node:assert/strict');
const { localizeJobContent } = require('../../scripts/data/localize-job-content.cjs');
const translations = require('../../scripts/data/job-description-translations.json');

test('localizes reviewed terminology without editing URLs or technology names', () => {
    const result = localizeJobContent({ name: 'Tuyển dụng Backend Developer',
        descriptionHTML: '<p>Product Owner, ReactJS, HTML5, .NET Core; teambuilding</p><a href="https://example.test/Marketing">Trang web</a>',
        descriptionMarkdown: 'Product Owner, ReactJS, HTML5, .NET Core; teambuilding https://example.test/Marketing' });
    assert.match(result.name, /lập trình viên/);
    assert.match(result.descriptionHTML, /người phụ trách sản phẩm, ReactJS, HTML5, .NET Core/);
    assert.match(result.descriptionHTML, /hoạt động gắn kết tập thể/);
    assert.ok(result.descriptionHTML.includes('href="https://example.test/Marketing"'));
    assert.ok(result.descriptionMarkdown.endsWith('https://example.test/Marketing'));
    assert.deepEqual(localizeJobContent(result), result);
});

test('translated templates have all three sections and remain unchanged on rerun', () => {
    for (const template of translations) {
        for (const heading of ['Mô tả công việc', 'Yêu cầu ứng viên', 'Quyền lợi']) {
            assert.ok(template.descriptionHTML.includes(`<h2>${heading}</h2>`));
            assert.ok(template.descriptionMarkdown.includes(`## ${heading}`));
        }
        const row = { name: 'Tin tuyển dụng', descriptionHTML: template.descriptionHTML, descriptionMarkdown: template.descriptionMarkdown };
        assert.deepEqual(localizeJobContent(row), row);
    }
    assert.match(translations[0].descriptionMarkdown, /10–14 triệu đồng\/tháng/);
    assert.match(translations[1].descriptionMarkdown, /14 tháng lương/);
    assert.match(translations[1].descriptionMarkdown, /16 triệu đồng\/năm/);
    assert.match(translations[2].descriptionMarkdown, /35.000.000 đến 50.000.000/);
});

test('sample seeding applies the same translations without changing recruitment fields', async () => {
    const bulkInsert = jest.fn();
    await require('../../src/seeders/20250101000010-demo-detailposts.js').up({ bulkInsert }, {});
    const [table, rows] = bulkInsert.mock.calls[0];
    assert.equal(table, 'DetailPosts');
    assert.equal(rows.length, 28);
    for (const id of [2, 4, 34, 35, 36]) {
        const row = rows.find(item => item.id === id);
        if (row) assert.doesNotMatch(row.descriptionHTML, /Supporting the Sales|Check payments|Set up internal|[\u4e00-\u9fff]/);
    }
    const sales = rows.find(row => row.id === 2);
    assert.equal(sales.amount, 4);
    assert.equal(sales.salaryJobCode, '3-5tr');
    assert.equal(sales.categoryWorktypeCode, 'part-time');
});
